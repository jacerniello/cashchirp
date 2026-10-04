"""The research store: plain files under `settings.research_dir`, readable by people and AI.

The apparatus (this module, the DD standard, the AI prompts) lives in the repo; the research
itself does not. `research_dir` defaults to `<repo>/research/`, which git ignores, so notes
and reports stay on the machine that wrote them and never ride along with a push.

    research/
      stocks/<permaticker>/   meta.json · notes.md — the living notes on a stock (yours)
      reports/<id>/           one analysis run: report.json + stocks/<pt>/dd.json · redteam.md
      groups/<id>.json        a named, editable set of stocks, with a change log
      snapshots/<id>.json     a screener result frozen at a moment, trimmable
      notes/**.md             free-form notes not tied to one stock

Stocks are keyed by permaticker, never ticker: tickers get recycled. Files are written
atomically (temp file + rename), so a reader — a page, or an AI agent editing the same
folder — never sees half a file. Everything here tolerates hand edits: a file someone broke
is reported, not fatal.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.config import settings

_ID_RE = re.compile(r"[^a-z0-9]+")


def root() -> Path:
    return Path(settings.research_dir).expanduser().resolve()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slug(text: str, fallback: str = "item") -> str:
    s = _ID_RE.sub("-", (text or "").lower()).strip("-")[:60]
    return s or fallback


def _unique_id(folder: Path, base: str) -> str:
    candidate, n = base, 2
    while (folder / f"{candidate}.json").exists():
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _write_json(path: Path, data: Any) -> None:
    _write(path, json.dumps(data, indent=2, default=str) + "\n")


def _read_json(path: Path) -> tuple[Any, str | None]:
    """(data, error). A hand-broken file comes back as (None, reason) instead of raising."""
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as exc:
        return None, f"{path.name}: {exc}"


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def _mtime(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    except FileNotFoundError:
        return None


def _pt(permaticker: Any) -> str:
    s = str(permaticker).strip()
    if not s.isdigit():
        raise ValueError(f"permaticker must be digits, got {permaticker!r}")
    return s


# ------------------------------------------------------------------------------- stocks
#
# A stock's own folder holds only the living documents: meta.json and the owner's notes.md.
# Analyses (DD + red team) are dated and belong to a report: reports/<id>/stocks/<pt>/.

STOCK_DOCS = {"notes": "notes.md"}


def stock_dir(permaticker: Any) -> Path:
    return root() / "stocks" / _pt(permaticker)


def touch_stock(permaticker: Any, ticker: str | None = None, name: str | None = None) -> dict:
    """Create or refresh a stock's meta.json, keeping what it already knew."""
    d = stock_dir(permaticker)
    meta, _ = _read_json(d / "meta.json")
    meta = meta if isinstance(meta, dict) else {"permaticker": _pt(permaticker), "created_at": _now()}
    if ticker:
        meta["ticker"] = ticker.upper()
    if name:
        meta["name"] = name
    meta["updated_at"] = _now()
    _write_json(d / "meta.json", meta)
    return meta


def _rating(dd: Any) -> dict | None:
    if not isinstance(dd, dict):
        return None
    r = dd.get("rating") if isinstance(dd.get("rating"), dict) else {}
    p = dd.get("price") if isinstance(dd.get("price"), dict) else {}
    return {"score": r.get("score"), "label": r.get("label"), "confidence": r.get("confidence"),
            "one_liner": r.get("one_liner"), "upside_base_pct": p.get("upside_base_pct"),
            "asof": dd.get("asof")}


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN is not a number here


def _score(rating: dict | None) -> float | None:
    return _num((rating or {}).get("score"))


def _group_memberships() -> dict[str, list[dict]]:
    """permaticker -> [{id, name}] of every group it is in."""
    out: dict[str, list[dict]] = {}
    for g in list_groups():
        for m in g.get("members", []):
            out.setdefault(str(m.get("permaticker")), []).append({"id": g["id"], "name": g["name"]})
    return out


def _all_analyses() -> dict[str, list[dict]]:
    """permaticker -> every analysis of it across all reports, newest first.

    "Newest" is by the DD's `asof`, falling back to the report's `created_at`; ties go to
    the later report. Unreadable DDs are kept (with `dd_error`) so they can be reported,
    but never count as the latest rating."""
    out: dict[str, list[dict]] = {}
    for rep in _read_reports():
        for pt, a in _report_analyses(rep).items():
            out.setdefault(pt, []).append(a)
    for xs in out.values():
        xs.sort(key=lambda a: (a["sort_key"], a["report_created_at"] or ""), reverse=True)
    return out


def get_stock(permaticker: Any) -> dict:
    pt = _pt(permaticker)
    d = stock_dir(pt)
    meta, _ = _read_json(d / "meta.json")
    analyses = _all_analyses().get(pt, [])
    good = [a for a in analyses if a["has_dd"]]
    latest = good[0] if good else (analyses[0] if analyses else None)
    dd = dd_err = rt = None
    dd_upd = rt_upd = None
    if latest:
        sdir = _report_stock_dir(latest["report_id"], pt)
        dd, dd_err = _read_json(sdir / "dd.json")
        dd_upd, rt, rt_upd = _mtime(sdir / "dd.json"), _read_text(sdir / "redteam.md"), _mtime(sdir / "redteam.md")
    in_reports = [{"id": r["id"], "name": r.get("name"), "created_at": r.get("created_at")}
                  for r in _read_reports()
                  if any(str(m.get("permaticker")) == pt for m in r.get("members", []))
                  and not any(a["report_id"] == r["id"] for a in analyses)]
    return {
        "permaticker": pt,
        "meta": meta if isinstance(meta, dict) else None,
        "notes": _read_text(d / "notes.md"),
        "notes_updated": _mtime(d / "notes.md"),
        "dd": dd if isinstance(dd, dict) else None,
        "dd_error": dd_err,
        "dd_updated": dd_upd,
        "redteam": rt,
        "redteam_updated": rt_upd,
        "latest": None if latest is None else {
            "report_id": latest["report_id"], "report_name": latest["report_name"],
            "created_at": latest["report_created_at"], "asof": latest["asof"]},
        "analyses": [{"report_id": a["report_id"], "report_name": a["report_name"],
                      "created_at": a["report_created_at"], "asof": a["asof"], "rating": a["rating"],
                      "has_dd": a["has_dd"], "dd_error": a["dd_error"], "has_redteam": a["has_redteam"],
                      "price_at_analysis": a["price_at_analysis"]} for a in analyses],
        "pending_reports": in_reports,
        "groups": _group_memberships().get(pt, []),
        "snapshots": [{"id": s["id"], "name": s["name"], "created_at": s.get("created_at")}
                      for s in list_snapshots(full=True)
                      if any(str(m.get("permaticker")) == pt for m in s.get("members", []))],
    }


def save_stock_doc(permaticker: Any, doc: str, content: Any, ticker: str | None = None,
                   name: str | None = None) -> None:
    if doc not in STOCK_DOCS:
        raise ValueError(f"A stock's own folder holds only {list(STOCK_DOCS)}; DD and red team "
                         "belong to a report (PUT /research/reports/{id}/stocks/{pt}/{doc}).")
    touch_stock(permaticker, ticker, name)
    _write(stock_dir(permaticker) / STOCK_DOCS[doc], str(content))


def delete_stock_doc(permaticker: Any, doc: str) -> bool:
    if doc not in STOCK_DOCS:
        raise ValueError(f"doc must be one of {list(STOCK_DOCS)}")
    path = stock_dir(permaticker) / STOCK_DOCS[doc]
    if not path.exists():
        return False
    path.unlink()
    return True


def list_stocks() -> list[dict]:
    """The rankings: every stock with notes or an analysis, carrying its LATEST analysis
    (across all reports) and the rating of the one before it. Prices "now" are added by
    the API, which has the database."""
    analyses = _all_analyses()
    groups = _group_memberships()
    base = root() / "stocks"
    noted = {p.name for p in base.iterdir() if p.is_dir() and p.name.isdigit()} if base.is_dir() else set()
    out = []
    for pt in sorted(noted | set(analyses), key=int):
        d = base / pt
        meta, _ = _read_json(d / "meta.json")
        meta = meta if isinstance(meta, dict) else {}
        xs = analyses.get(pt, [])
        good = [a for a in xs if a["has_dd"]]
        latest = good[0] if good else None
        prev = good[1] if len(good) > 1 else None
        out.append({
            "permaticker": pt,
            "ticker": meta.get("ticker") or (latest or {}).get("ticker")
            or next((a["ticker"] for a in xs if a.get("ticker")), None),
            "name": meta.get("name") or (latest or {}).get("name")
            or next((a["name"] for a in xs if a.get("name")), None),
            "has_notes": (d / "notes.md").exists(),
            "has_dd": latest is not None,
            "dd_error": next((a["dd_error"] for a in xs if a["dd_error"]), None) if not good else None,
            "has_redteam": bool(latest and latest["has_redteam"]),
            "rating": latest["rating"] if latest else None,
            "asof": latest["asof"] if latest else None,
            "report": None if latest is None else {
                "id": latest["report_id"], "name": latest["report_name"],
                "created_at": latest["report_created_at"]},
            "price_at_analysis": latest["price_at_analysis"] if latest else None,
            "previous": None if prev is None else {
                "rating": prev["rating"], "asof": prev["asof"], "report_id": prev["report_id"],
                "report_name": prev["report_name"], "created_at": prev["report_created_at"]},
            "analyses": len(good),
            "groups": groups.get(pt, []),
            "updated_at": max(filter(None, [_mtime(d / "meta.json"), _mtime(d / "notes.md"),
                                            latest and latest["dd_updated"]]), default=None),
        })
    return out


# ------------------------------------------------------------------------------ reports
#
# A report is one analysis run, built at a particular time: a set of stocks analysed
# together, a DD (+ optional red team) per stock done as of that report, and its own
# ranking. Reports are never overwritten by later analysis — re-analysing means a new
# report — but they can be expanded and completed over time.

REPORT_DOCS = {"dd": "dd.json", "redteam": "redteam.md"}
REPORT_STATUSES = ("open", "complete")


def _reports_dir() -> Path:
    return root() / "reports"


_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,120}$")


def _rid(rid: str) -> str:
    """A report id as given — validated, not re-slugged (ids are longer than a slug)."""
    s = str(rid or "").strip().lower()
    if not _SAFE_ID.match(s):
        raise ValueError(f"bad report id {rid!r}")
    return s


def _report_stock_dir(rid: str, permaticker: Any) -> Path:
    return _reports_dir() / _rid(rid) / "stocks" / _pt(permaticker)


def _report_member(m: dict, by: str) -> dict:
    return {"permaticker": _pt(m["permaticker"]),
            "ticker": (m.get("ticker") or "").upper() or None, "name": m.get("name") or None,
            "added_at": m.get("added_at") or _now(), "added_by": m.get("added_by") or by}


def _read_report(rid: str) -> dict | None:
    d = _reports_dir() / _rid(rid)
    if not d.is_dir():
        return None
    r, err = _read_json(d / "report.json")
    if not isinstance(r, dict):
        r = {"name": d.name, "members": [], "error": err or "report.json is missing"}
    r["id"] = d.name
    r.setdefault("name", d.name)
    r.setdefault("status", "open")
    r.setdefault("source", {"kind": "manual"})
    if not isinstance(r.get("members"), list):
        r["members"] = []
    return r


def _read_reports() -> list[dict]:
    base = _reports_dir()
    if not base.is_dir():
        return []
    out = [r for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")
           if (r := _read_report(p.name)) is not None]
    out.sort(key=lambda r: (r.get("created_at") or "", r["id"]), reverse=True)
    return out


def _report_analyses(rep: dict) -> dict[str, dict]:
    """permaticker -> what is on disk for it in this report (dd and/or red team)."""
    base = _reports_dir() / rep["id"] / "stocks"
    if not base.is_dir():
        return {}
    out = {}
    for d in base.iterdir():
        if not (d.is_dir() and d.name.isdigit()):
            continue
        has_dd_file, has_rt = (d / "dd.json").exists(), (d / "redteam.md").exists()
        if not (has_dd_file or has_rt):
            continue
        dd, err = _read_json(d / "dd.json")
        dd = dd if isinstance(dd, dict) else None
        price = dd.get("price") if dd and isinstance(dd.get("price"), dict) else {}
        asof = str(dd.get("asof")) if dd and dd.get("asof") else None
        created = rep.get("created_at")
        out[d.name] = {
            "report_id": rep["id"], "report_name": rep.get("name"), "report_created_at": created,
            "has_dd": dd is not None, "dd_error": err, "has_redteam": has_rt,
            "rating": _rating(dd), "asof": asof, "price_at_analysis": _num(price.get("current")),
            "ticker": (dd or {}).get("ticker"), "name": (dd or {}).get("company"),
            "dd_updated": _mtime(d / "dd.json"), "redteam_updated": _mtime(d / "redteam.md"),
            "sort_key": (asof or (created or "")[:10]),
        }
    return out


def _ranking_key(m: dict) -> tuple:
    """Analysed first, then score desc, then base upside desc."""
    r = (m.get("analysis") or {}).get("rating") if m.get("analysis") else None
    s, u = _score(r), _num((r or {}).get("upside_base_pct"))
    return (0 if r else 1, -(s if s is not None else -1e9), -(u if u is not None else -1e9),
            m.get("ticker") or "")


def _report_view(rep: dict, analyses: dict[str, dict]) -> dict:
    listed = {str(m.get("permaticker")) for m in rep["members"]}
    members = [dict(m) for m in rep["members"] if m.get("permaticker") is not None]
    # Analyses written into the folder without a members entry still belong to the report.
    for pt in sorted(set(analyses) - listed, key=int):
        a = analyses[pt]
        members.append({"permaticker": pt, "ticker": a.get("ticker"), "name": a.get("name"),
                        "listed": False})
    for m in members:
        a = analyses.get(str(m["permaticker"]))
        m["analysis"] = None if a is None else {k: v for k, v in a.items() if k not in (
            "report_id", "report_name", "report_created_at", "sort_key", "ticker", "name")}
        if a and not m.get("ticker"):
            m["ticker"] = a.get("ticker")
        if a and not m.get("name"):
            m["name"] = a.get("name")
    members.sort(key=_ranking_key)
    return {**rep, "members": members}


def list_reports() -> list[dict]:
    out = []
    for rep in _read_reports():
        view = _report_view(rep, _report_analyses(rep))
        ms = view["members"]
        top = [{"permaticker": m["permaticker"], "ticker": m.get("ticker"),
                "rating": m["analysis"]["rating"]}
               for m in ms if m["analysis"] and m["analysis"]["has_dd"]][:3]
        out.append({k: v for k, v in rep.items() if k != "members"} | {
            "member_count": len(ms),
            "analysed_count": sum(1 for m in ms if m["analysis"] and m["analysis"]["has_dd"]),
            "redteam_count": sum(1 for m in ms if m["analysis"] and m["analysis"]["has_redteam"]),
            "top": top})
    return out


def get_report(rid: str) -> dict | None:
    rep = _read_report(rid)
    if rep is None:
        return None
    groups = _group_memberships()
    view = _report_view(rep, _report_analyses(rep))
    for m in view["members"]:
        m["groups"] = groups.get(str(m["permaticker"]), [])
    return view


def _save_report(rep: dict) -> None:
    rep["updated_at"] = _now()
    _write_json(_reports_dir() / rep["id"] / "report.json",
                {k: v for k, v in rep.items() if k not in ("error",)})


def _unique_dir(folder: Path, base: str) -> str:
    candidate, n = base, 2
    while (folder / candidate).exists():
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def report_source_members(source: dict) -> list[dict]:
    """The candidate members a report's source offers: a snapshot's kept members, or a
    group's members. Manual reports have none."""
    if source.get("kind") == "snapshot" and source.get("snapshot_id"):
        s = get_snapshot(source["snapshot_id"]) or {}
        return [m for m in s.get("members", []) if not m.get("removed")]
    if source.get("kind") == "group" and source.get("group_id"):
        return (get_group(source["group_id"]) or {}).get("members", [])
    return []


def create_report(name: str, *, thesis: str = "", snapshot_id: str | None = None,
                  group_id: str | None = None, permatickers: list[str] | None = None,
                  members: list[dict] | None = None, by: str = "human") -> dict:
    """Start a report from a snapshot (its kept members, or the `permatickers` subset of
    it), a group (its members, or a subset), or by hand (`members`)."""
    pick = {_pt(p) for p in permatickers} if permatickers else None
    if snapshot_id:
        snap = get_snapshot(snapshot_id)
        if snap is None:
            raise KeyError(f"snapshot {snapshot_id}")
        if snap.get("error"):
            raise ValueError(f"snapshot file is unreadable ({snap['error']})")
        src = snap.get("source") if isinstance(snap.get("source"), dict) else {}
        source = {"kind": "snapshot", "snapshot_id": snap["id"], "snapshot_name": snap.get("name")}
        if src.get("kind") == "screen":
            source.update(screen_id=src.get("screen_id"), screen_title=src.get("title"))
        pool = snap.get("members", [])
        cand = ([m for m in pool if str(m.get("permaticker")) in pick] if pick is not None
                else [m for m in pool if not m.get("removed")])
        default_name, thesis = snap.get("name") or snap["id"], thesis or snap.get("note") or ""
    elif group_id:
        g = get_group(group_id)
        if g is None:
            raise KeyError(f"group {group_id}")
        source = {"kind": "group", "group_id": g["id"], "group_name": g.get("name")}
        cand = [m for m in g.get("members", []) if pick is None or str(m.get("permaticker")) in pick]
        default_name, thesis = g.get("name") or g["id"], thesis or g.get("description") or ""
    else:
        source = {"kind": "manual"}
        cand = list(members or []) + [{"permaticker": p} for p in (pick or set())
                                      if not any(str(m.get("permaticker")) == p for m in members or [])]
        default_name = "Report"
    d = _reports_dir()
    rid = _unique_dir(d, f"{time.strftime('%Y%m%d-%H%M')}-{_slug(name or default_name, 'report')}")
    seen: dict[str, dict] = {}
    for m in cand:
        if m.get("permaticker") is not None:
            mm = _report_member({"permaticker": m["permaticker"], "ticker": m.get("ticker"),
                                 "name": m.get("name")}, by)
            seen.setdefault(mm["permaticker"], mm)
    rep = {"id": rid, "name": (name or "").strip() or default_name, "thesis": thesis,
           "created_at": _now(), "created_by": by, "status": "open", "source": source,
           "members": list(seen.values()), "notes": ""}
    _save_report(rep)
    return rep


def update_report(rid: str, *, name: str | None = None, thesis: str | None = None,
                  status: str | None = None, notes: str | None = None,
                  add: list[dict] | None = None, add_from_source: bool = False,
                  remove: list[str] | None = None, by: str = "human") -> dict:
    rep = _read_report(rid)
    if rep is None:
        raise KeyError(rid)
    if rep.get("error"):
        raise ValueError(f"report file is unreadable ({rep['error']}); fix it by hand first")
    if name is not None:
        rep["name"] = name.strip() or rep["name"]
    if thesis is not None:
        rep["thesis"] = thesis
    if notes is not None:
        rep["notes"] = notes
    if status is not None:
        if status not in REPORT_STATUSES:
            raise ValueError(f"status must be one of {list(REPORT_STATUSES)}")
        rep["status"] = status
    members = {str(m["permaticker"]): m for m in rep["members"] if m.get("permaticker") is not None}
    extra = list(add or []) + (report_source_members(rep["source"]) if add_from_source else [])
    for m in extra:
        mm = _report_member({"permaticker": m["permaticker"], "ticker": m.get("ticker"),
                             "name": m.get("name")}, by)
        members.setdefault(mm["permaticker"], mm)
    analysed = _report_analyses(rep)
    for pt in remove or []:
        pt = _pt(pt)
        if pt in analysed:
            raise ValueError(f"{members.get(pt, {}).get('ticker') or pt} has an analysis in this "
                             "report; delete its DD and red team first (analyses are never "
                             "dropped silently).")
        members.pop(pt, None)
    rep["members"] = list(members.values())
    _save_report(rep)
    return rep


def delete_report(rid: str) -> bool:
    import shutil
    d = _reports_dir() / _rid(rid)
    if not d.is_dir():
        return False
    shutil.rmtree(d)
    return True


def read_report_doc(rid: str, permaticker: Any, doc: str) -> tuple[Any, str | None]:
    """(content, error) — dd as a dict, redteam as text; (None, None) when absent."""
    if doc not in REPORT_DOCS:
        raise ValueError(f"doc must be one of {list(REPORT_DOCS)}")
    path = _report_stock_dir(rid, permaticker) / REPORT_DOCS[doc]
    if doc == "dd":
        return _read_json(path)
    return _read_text(path), None


def save_report_doc(rid: str, permaticker: Any, doc: str, content: Any,
                    ticker: str | None = None, name: str | None = None, by: str = "human") -> None:
    """Write a DD or red team into a report; the stock becomes a member if it was not."""
    if doc not in REPORT_DOCS:
        raise ValueError(f"doc must be one of {list(REPORT_DOCS)}")
    rep = _read_report(rid)
    if rep is None:
        raise KeyError(rid)
    pt = _pt(permaticker)
    path = _report_stock_dir(rid, pt) / REPORT_DOCS[doc]
    if doc == "dd":
        if not isinstance(content, dict):
            raise ValueError("dd must be a JSON object")
        _write_json(path, content)
        ticker = ticker or content.get("ticker")
        name = name or content.get("company")
    else:
        _write(path, str(content))
    if not rep.get("error") and not any(str(m.get("permaticker")) == pt for m in rep["members"]):
        rep["members"].append(_report_member({"permaticker": pt, "ticker": ticker, "name": name}, by))
        _save_report(rep)


def delete_report_doc(rid: str, permaticker: Any, doc: str) -> bool:
    if doc not in REPORT_DOCS:
        raise ValueError(f"doc must be one of {list(REPORT_DOCS)}")
    path = _report_stock_dir(rid, permaticker) / REPORT_DOCS[doc]
    if not path.exists():
        return False
    path.unlink()
    return True


# ------------------------------------------------------------------------------- groups

def _groups_dir() -> Path:
    return root() / "groups"


def _member(m: dict, by: str) -> dict:
    return {"permaticker": _pt(m["permaticker"]), "ticker": (m.get("ticker") or "").upper() or None,
            "name": m.get("name"), "note": m.get("note") or "", "added_by": m.get("added_by") or by,
            "added_at": m.get("added_at") or _now()}


def list_groups() -> list[dict]:
    d = _groups_dir()
    if not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.json")):
        g, err = _read_json(p)
        if isinstance(g, dict):
            g["id"] = p.stem
            g.setdefault("name", p.stem)
            g.setdefault("members", [])
            out.append(g)
        else:
            out.append({"id": p.stem, "name": p.stem, "members": [], "error": err})
    return out


def get_group(gid: str) -> dict | None:
    g, err = _read_json(_groups_dir() / f"{_slug(gid)}.json")
    if g is None and err is None:
        return None
    if not isinstance(g, dict):
        return {"id": gid, "name": gid, "members": [], "error": err}
    g["id"] = _slug(gid)
    g.setdefault("members", [])
    return g


def create_group(name: str, description: str = "", by: str = "human") -> dict:
    if not name.strip():
        raise ValueError("A group needs a name.")
    d = _groups_dir()
    gid = _unique_id(d, _slug(name, "group"))
    g = {"id": gid, "name": name.strip(), "description": description, "created_by": by,
         "created_at": _now(), "updated_at": _now(), "members": [],
         "history": [{"at": _now(), "action": "create", "by": by}]}
    _write_json(d / f"{gid}.json", g)
    return g


def update_group(gid: str, *, name: str | None = None, description: str | None = None,
                 add: list[dict] | None = None, remove: list[str] | None = None,
                 by: str = "human") -> dict:
    g = get_group(gid)
    if g is None:
        raise KeyError(gid)
    if g.get("error"):
        raise ValueError(f"group file is unreadable ({g['error']}); fix it by hand first")
    history = g.get("history") if isinstance(g.get("history"), list) else []
    now = _now()

    def log(action: str, m: dict | None = None, note: str | None = None) -> None:
        e: dict[str, Any] = {"at": now, "action": action, "by": by}
        if m is not None:
            e.update(permaticker=str(m.get("permaticker")), ticker=m.get("ticker"))
        if note:
            e["note"] = note
        history.append(e)

    if name is not None and (name.strip() or g["name"]) != g["name"]:
        log("rename", note=f"{g['name']} → {name.strip()}")
        g["name"] = name.strip()
    if description is not None and description != g.get("description", ""):
        log("describe", note=description[:200])
        g["description"] = description
    members = {str(m["permaticker"]): m for m in g.get("members", []) if m.get("permaticker")}
    for m in add or []:
        new = _member(m, by)
        old = members.get(new["permaticker"])
        if old:  # keep the original provenance; refresh the note if one was given
            new = {**old, "note": new["note"] or old.get("note", "")}
            if new["note"] != old.get("note", ""):
                log("note", new, new["note"][:200])
        else:
            log("add", new, new["note"][:200] or None)
        members[new["permaticker"]] = new
    for pt in remove or []:
        gone = members.pop(str(pt), None)
        if gone is not None:
            log("remove", gone)
    g["history"] = history
    g["members"] = list(members.values())
    g["updated_at"] = _now()
    _write_json(_groups_dir() / f"{g['id']}.json", {k: v for k, v in g.items() if k != "error"})
    return g


def delete_group(gid: str) -> bool:
    p = _groups_dir() / f"{_slug(gid)}.json"
    if not p.exists():
        return False
    p.unlink()
    return True


# ---------------------------------------------------------------------------- snapshots

def _snaps_dir() -> Path:
    return root() / "snapshots"


def list_snapshots(full: bool = False) -> list[dict]:
    d = _snaps_dir()
    if not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.json"), reverse=True):
        s, err = _read_json(p)
        if not isinstance(s, dict):
            out.append({"id": p.stem, "name": p.stem, "error": err, "members": [], "count": 0})
            continue
        s["id"] = p.stem
        members = s.get("members") or []
        s["count"] = sum(1 for m in members if not m.get("removed"))
        s["removed_count"] = sum(1 for m in members if m.get("removed"))
        if not full:
            s = {k: v for k, v in s.items() if k != "members"}
        out.append(s)
    out.sort(key=lambda s: s.get("created_at") or "", reverse=True)
    return out


def get_snapshot(sid: str) -> dict | None:
    try:
        sid = _rid(sid)  # validated as-is: _slug would truncate a long id
    except ValueError:
        return None
    s, err = _read_json(_snaps_dir() / f"{sid}.json")
    if s is None and err is None:
        return None
    if not isinstance(s, dict):
        return {"id": sid, "name": sid, "members": [], "error": err}
    s["id"] = sid
    return s


def create_snapshot(name: str, note: str, source: dict, asof: str | None,
                    rows: list[dict], by: str = "human") -> dict:
    d = _snaps_dir()
    stamp = time.strftime("%Y%m%d-%H%M")
    sid = _unique_id(d, f"{stamp}-{_slug(name, 'snapshot')}")
    snap = {"id": sid, "name": name.strip() or sid, "note": note, "source": source,
            "asof": asof, "created_at": _now(), "created_by": by,
            "members": [{**r, "permaticker": _pt(r["permaticker"]), "removed": False}
                        for r in rows if r.get("permaticker") is not None]}
    _write_json(d / f"{sid}.json", snap)
    return snap


def update_snapshot(sid: str, *, name: str | None = None, note: str | None = None,
                    remove: list[str] | None = None, restore: list[str] | None = None) -> dict:
    """Rename, annotate, or trim. Trimming marks members removed rather than deleting them,
    so a trim can be undone and the record of what the screen originally caught survives."""
    s = get_snapshot(sid)
    if s is None:
        raise KeyError(sid)
    if s.get("error"):
        raise ValueError(f"snapshot file is unreadable ({s['error']}); fix it by hand first")
    if name is not None:
        s["name"] = name.strip() or s["name"]
    if note is not None:
        s["note"] = note
    rm, rs = {str(x) for x in remove or []}, {str(x) for x in restore or []}
    for m in s.get("members", []):
        if str(m.get("permaticker")) in rm:
            m["removed"] = True
        if str(m.get("permaticker")) in rs:
            m["removed"] = False
    s["updated_at"] = _now()
    _write_json(_snaps_dir() / f"{s['id']}.json", s)
    return s


def delete_snapshot(sid: str) -> bool:
    try:
        p = _snaps_dir() / f"{_rid(sid)}.json"
    except ValueError:
        return False
    if not p.exists():
        return False
    p.unlink()
    return True


# -------------------------------------------------------------------------------- notes

def _notes_dir() -> Path:
    return root() / "notes"


def _note_path(rel: str) -> Path:
    base = _notes_dir().resolve()
    rel = rel.strip().lstrip("/")
    if not rel.endswith(".md"):
        rel += ".md"
    p = (base / rel).resolve()
    if base not in p.parents:
        raise ValueError("note path must stay inside research/notes")
    return p


def list_notes() -> list[dict]:
    base = _notes_dir()
    if not base.is_dir():
        return []
    return [{"path": str(p.relative_to(base)), "updated_at": _mtime(p), "bytes": p.stat().st_size}
            for p in sorted(base.rglob("*.md"))]


def read_note(rel: str) -> str | None:
    return _read_text(_note_path(rel))


def write_note(rel: str, text: str) -> str:
    p = _note_path(rel)
    _write(p, text)
    return str(p.relative_to(_notes_dir().resolve()))


def delete_note(rel: str) -> bool:
    p = _note_path(rel)
    if not p.exists():
        return False
    p.unlink()
    return True


# -------------------------------------------------------------------------------- guide

_GUIDE_SRC = Path(__file__).resolve().parent / "guide"


def ensure_layout() -> None:
    """Create the folder skeleton and refresh the AI guide from the repo copy.

    The guide is apparatus, not research: `CLAUDE.md` at the root (so an agent started in
    this folder reads it automatically) and the standards under `_guide/`. They are
    overwritten whenever they differ from the repo, so improving the standard means editing
    `core/backend/research/guide/` and redeploying — never the copies."""
    base = root()
    for sub in ("stocks", "reports", "groups", "snapshots", "notes", "backtests", "_guide"):
        (base / sub).mkdir(parents=True, exist_ok=True)
    # The repo copy is AGENT_GUIDE.md because the repo's .gitignore excludes every file named
    # CLAUDE.md (that name is reserved for the local project charter). In the research folder
    # it becomes CLAUDE.md, the file Claude Code reads automatically when started there.
    copies = {"AGENT_GUIDE.md": base / "CLAUDE.md"}
    copies.update({p.name: base / "_guide" / p.name for p in _GUIDE_SRC.iterdir()
                   if p.is_file() and p.name != "AGENT_GUIDE.md"})
    for name, dest in copies.items():
        src = (_GUIDE_SRC / name).read_text(encoding="utf-8")
        if _read_text(dest) != src:
            _write(dest, src)
    migrate_legacy_analyses()


# ------------------------------------------------------------------------------ migration

_log = logging.getLogger("cashchirp.research")
RECOVERED_SUFFIX = "-recovered-research"


def _as_utc(v: Any) -> datetime | None:
    s = str(v or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def migrate_legacy_analyses() -> dict:
    """Move DDs and red teams left in `stocks/<pt>/` (the old layout) into one report,
    "Recovered research". Idempotent: nothing to move means nothing happens, and a second
    run adds to the same report. A file whose destination already exists is left where it
    is and logged — a migration never overwrites research."""
    base = root() / "stocks"
    legacy = [d for d in base.iterdir() if d.is_dir() and d.name.isdigit()
              and any((d / f).exists() for f in REPORT_DOCS.values())] if base.is_dir() else []
    if not legacy:
        return {"moved": 0, "skipped": 0}
    stamps: list[datetime] = []
    for d in legacy:
        dd, _ = _read_json(d / "dd.json")
        if isinstance(dd, dict):
            stamps += [t for t in (_as_utc(dd.get("generated_at")), _as_utc(dd.get("asof"))) if t]
    earliest = min(stamps) if stamps else datetime.now(timezone.utc)

    rdir = _reports_dir()
    rdir.mkdir(parents=True, exist_ok=True)
    existing = sorted(p.name for p in rdir.iterdir() if p.is_dir() and p.name.endswith(RECOVERED_SUFFIX))
    rid = existing[0] if existing else f"{earliest:%Y%m%d}{RECOVERED_SUFFIX}"
    rep = _read_report(rid)
    if rep is None or rep.get("error"):
        if rep is not None:  # an unreadable report.json is never overwritten
            _log.warning("research migration: %s/report.json is unreadable; legacy DDs left in place", rid)
            return {"moved": 0, "skipped": len(legacy)}
        rep = {"id": rid, "name": "Recovered research", "thesis": "Imported from the earlier research folder",
               "created_at": earliest.isoformat(timespec="seconds"), "created_by": "migration",
               "status": "complete", "source": {"kind": "manual"}, "members": [], "notes": ""}
    elif stamps and (_as_utc(rep.get("created_at")) or earliest) > earliest:
        rep["created_at"] = earliest.isoformat(timespec="seconds")

    moved = skipped = 0
    members = {str(m.get("permaticker")): m for m in rep["members"]}
    for d in legacy:
        dest = rdir / rid / "stocks" / d.name
        took = False
        for fname in REPORT_DOCS.values():
            src = d / fname
            if not src.exists():
                continue
            if (dest / fname).exists():
                _log.warning("research migration: %s already exists; left %s in place", dest / fname, src)
                skipped += 1
                continue
            dest.mkdir(parents=True, exist_ok=True)
            try:
                os.replace(src, dest / fname)
            except FileNotFoundError:  # another worker moved it first
                continue
            moved += 1
            took = True
        if took and d.name not in members:
            meta, _ = _read_json(d / "meta.json")
            dd, _ = _read_json(dest / "dd.json")
            meta = meta if isinstance(meta, dict) else {}
            dd = dd if isinstance(dd, dict) else {}
            members[d.name] = _report_member({"permaticker": d.name,
                                              "ticker": meta.get("ticker") or dd.get("ticker"),
                                              "name": meta.get("name") or dd.get("company"),
                                              "added_at": rep["created_at"]}, "migration")
    rep["members"] = list(members.values())
    if moved:
        _save_report(rep)
        _log.info("research migration: moved %d legacy file(s) into reports/%s", moved, rid)
    return {"moved": moved, "skipped": skipped, "report": rid}
