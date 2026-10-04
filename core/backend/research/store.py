"""The research store: plain files under `settings.research_dir`, readable by people and AI.

The apparatus (this module, the DD standard, the AI prompts) lives in the repo; the research
itself does not. `research_dir` defaults to `<repo>/research/`, which git ignores, so
reports and their notes stay on the machine that wrote them and never ride along with a push.

    research/
      reports/<id>/           one analysis run — reports are how research is organised:
        report.json           name, thesis, source, status, members, a short `notes` summary
        notes/**              the report's own notes (Markdown; other files kept alongside)
        stocks/<pt>/          dd.json · redteam.md · notes.md — one stock within this run
      snapshots/<id>.json     a screener result frozen at a moment, trimmable
      stocks/<permaticker>/   meta.json only (ticker/name); notes and analyses live in reports

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
# A stock has no documents of its own: its analyses (DD, red team) and notes are dated and
# belong to a report — reports/<id>/stocks/<pt>/. `stocks/<pt>/meta.json` may remain from
# earlier layouts and is read for the ticker/name only.

def stock_dir(permaticker: Any) -> Path:
    return root() / "stocks" / _pt(permaticker)


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


def _all_stock_notes() -> dict[str, list[dict]]:
    """permaticker -> every report holding notes on it (reports/<id>/stocks/<pt>/notes.md)."""
    out: dict[str, list[dict]] = {}
    for rep in _read_reports():
        base = _reports_dir() / rep["id"] / "stocks"
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if d.is_dir() and d.name.isdigit() and (d / "notes.md").is_file():
                out.setdefault(d.name, []).append({
                    "report_id": rep["id"], "report_name": rep.get("name"),
                    "created_at": rep.get("created_at"), "updated_at": _mtime(d / "notes.md")})
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
        "notes_in": _all_stock_notes().get(pt, []),
        "snapshots": [{"id": s["id"], "name": s["name"], "created_at": s.get("created_at")}
                      for s in list_snapshots(full=True)
                      if any(str(m.get("permaticker")) == pt for m in s.get("members", []))],
    }


def list_stocks() -> list[dict]:
    """Every stock with an analysis or notes in some report, with its LATEST analysis across
    all reports — the research status the snapshot pages show beside each member."""
    analyses = _all_analyses()
    noted = _all_stock_notes()
    base = root() / "stocks"
    out = []
    for pt in sorted(set(noted) | set(analyses), key=int):
        d = base / pt
        meta, _ = _read_json(d / "meta.json")
        meta = meta if isinstance(meta, dict) else {}
        xs = analyses.get(pt, [])
        good = [a for a in xs if a["has_dd"]]
        latest = good[0] if good else None
        out.append({
            "permaticker": pt,
            "ticker": meta.get("ticker") or (latest or {}).get("ticker")
            or next((a["ticker"] for a in xs if a.get("ticker")), None),
            "name": meta.get("name") or (latest or {}).get("name")
            or next((a["name"] for a in xs if a.get("name")), None),
            "has_notes": pt in noted,
            "has_dd": latest is not None,
            "dd_error": next((a["dd_error"] for a in xs if a["dd_error"]), None) if not good else None,
            "has_redteam": bool(latest and latest["has_redteam"]),
            "rating": latest["rating"] if latest else None,
            "asof": latest["asof"] if latest else None,
            "report": None if latest is None else {
                "id": latest["report_id"], "name": latest["report_name"],
                "created_at": latest["report_created_at"]},
            "analyses": len(good),
            "updated_at": max(filter(None, [latest and latest["dd_updated"],
                                            *(n["updated_at"] for n in noted.get(pt, []))]), default=None),
        })
    return out


# ------------------------------------------------------------------------------ reports
#
# A report is one analysis run, built at a particular time: a set of stocks analysed
# together, a DD (+ optional red team) per stock done as of that report, its own ranking,
# and its notes (report-level under notes/, per-stock as stocks/<pt>/notes.md). Analyses
# are never overwritten by later work — re-analysing means a new report — but a report can
# be expanded, annotated and completed over time.

REPORT_DOCS = {"dd": "dd.json", "redteam": "redteam.md", "notes": "notes.md"}
#: The documents that make an analysis (notes alone do not).
ANALYSIS_DOCS = ("dd", "redteam")
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
    sdir = _reports_dir() / rep["id"] / "stocks"
    for m in members:
        a = analyses.get(str(m["permaticker"]))
        m["has_notes"] = (sdir / str(m["permaticker"]) / "notes.md").is_file()
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
    return _report_view(rep, _report_analyses(rep))


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
    """The candidate members a report's source offers: a snapshot's kept members. Any other
    source (hand-picked, or a legacy one such as a group) offers none."""
    if source.get("kind") == "snapshot" and source.get("snapshot_id"):
        s = get_snapshot(source["snapshot_id"]) or {}
        return [m for m in s.get("members", []) if not m.get("removed")]
    return []


def create_report(name: str, *, thesis: str = "", snapshot_id: str | None = None,
                  permatickers: list[str] | None = None, members: list[dict] | None = None,
                  by: str = "human") -> dict:
    """Start a report from a snapshot (its kept members, or the `permatickers` subset of
    it), or by hand (`members`, plus any `permatickers`)."""
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
    """(content, error) — dd as a dict, redteam/notes as text; (None, None) when absent."""
    if doc not in REPORT_DOCS:
        raise ValueError(f"doc must be one of {list(REPORT_DOCS)}")
    path = _report_stock_dir(rid, permaticker) / REPORT_DOCS[doc]
    if doc == "dd":
        return _read_json(path)
    return _read_text(path), None


def save_report_doc(rid: str, permaticker: Any, doc: str, content: Any,
                    ticker: str | None = None, name: str | None = None, by: str = "human") -> None:
    """Write a DD, red team or notes into a report; the stock becomes a member if it was not."""
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


def _report_notes_dir(rid: str) -> Path:
    return _reports_dir() / _rid(rid) / "notes"


def _note_path(base: Path, rel: str) -> Path:
    """A Markdown file under `base`, from a relative path; never escapes it."""
    base = base.resolve()
    rel = rel.strip().lstrip("/")
    if not rel.endswith(".md"):
        rel += ".md"
    p = (base / rel).resolve()
    if base not in p.parents:
        raise ValueError("note path must stay inside the report's notes/ folder")
    return p


def list_report_notes(rid: str) -> list[dict]:
    """The report's Markdown notes. Other files under notes/ (data, scripts) are kept but
    not listed — they are part of the record, not documents to edit here."""
    base = _report_notes_dir(rid)
    if not base.is_dir():
        return []
    return [{"path": str(p.relative_to(base)), "updated_at": _mtime(p), "bytes": p.stat().st_size}
            for p in sorted(base.rglob("*.md")) if p.is_file()]


def read_report_note(rid: str, rel: str) -> str | None:
    return _read_text(_note_path(_report_notes_dir(rid), rel))


def write_report_note(rid: str, rel: str, text: str) -> str:
    if _read_report(rid) is None:
        raise KeyError(rid)
    base = _report_notes_dir(rid)
    p = _note_path(base, rel)
    _write(p, text)
    return str(p.relative_to(base.resolve()))


def delete_report_note(rid: str, rel: str) -> bool:
    p = _note_path(_report_notes_dir(rid), rel)
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


# -------------------------------------------------------------------------------- guide

_GUIDE_SRC = Path(__file__).resolve().parent / "guide"


def ensure_layout() -> None:
    """Create the folder skeleton and refresh the AI guide from the repo copy.

    The guide is apparatus, not research: `CLAUDE.md` at the root (so an agent started in
    this folder reads it automatically) and the standards under `_guide/`. They are
    overwritten whenever they differ from the repo, so improving the standard means editing
    `core/backend/research/guide/` and redeploying — never the copies."""
    base = root()
    for sub in ("reports", "snapshots", "backtests", "_guide"):
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
    migrate_legacy_research()


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


def migrate_legacy_research() -> dict:
    """Move research left in the old layouts into one report, "Recovered research":
    DDs, red teams and notes from `stocks/<pt>/` into its `stocks/<pt>/`, and everything
    under the old global `notes/` folder (Markdown and any other files, subpaths kept) into
    its `notes/`. Idempotent: nothing to move means nothing happens, and a later run adds to
    the same report. A file whose destination already exists is left where it is and logged
    — a migration never overwrites research."""
    # The API runs several workers, and each calls this at start-up. Without a lock two of
    # them move different files and each saves its own partial member list — the last write
    # wins and analyses end up "not in members list". One migrator at a time.
    import fcntl
    root().mkdir(parents=True, exist_ok=True)
    with open(root() / ".migration.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _migrate_legacy_locked()


def _move(src: Path, dest: Path) -> bool:
    """Move one file unless `dest` exists (then log and leave it). True when it moved."""
    if dest.exists():
        _log.warning("research migration: %s already exists; left %s in place", dest, src)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.replace(src, dest)
    except FileNotFoundError:  # another worker moved it first
        return False
    return True


def _prune_empty_dirs(base: Path) -> None:
    """Remove `base` and the folders under it once the migration has emptied them."""
    for d in sorted((p for p in base.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass
    try:
        base.rmdir()
    except OSError:
        pass


def _migrate_legacy_locked() -> dict:
    base = root() / "stocks"
    legacy = [d for d in base.iterdir() if d.is_dir() and d.name.isdigit()
              and any((d / f).is_file() for f in REPORT_DOCS.values())] if base.is_dir() else []
    notes_base = root() / "notes"
    loose_notes = sorted(p for p in notes_base.rglob("*") if p.is_file()) if notes_base.is_dir() else []
    if not legacy and not loose_notes:
        if notes_base.is_dir():
            _prune_empty_dirs(notes_base)
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
            _log.warning("research migration: %s/report.json is unreadable; legacy research left in place", rid)
            return {"moved": 0, "skipped": len(legacy) + len(loose_notes)}
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
            if not src.is_file():
                continue
            if _move(src, dest / fname):
                moved += 1
                took = True
            elif src.exists():
                skipped += 1
        if took and d.name not in members:
            meta, _ = _read_json(d / "meta.json")
            dd, _ = _read_json(dest / "dd.json")
            meta = meta if isinstance(meta, dict) else {}
            dd = dd if isinstance(dd, dict) else {}
            members[d.name] = _report_member({"permaticker": d.name,
                                              "ticker": meta.get("ticker") or dd.get("ticker"),
                                              "name": meta.get("name") or dd.get("company"),
                                              "added_at": rep["created_at"]}, "migration")
    notes_dest = rdir / rid / "notes"
    for src in loose_notes:
        if _move(src, notes_dest / src.relative_to(notes_base)):
            moved += 1
        elif src.exists():
            skipped += 1
    if notes_base.is_dir():
        _prune_empty_dirs(notes_base)
    rep["members"] = list(members.values())
    if moved:
        _save_report(rep)
        _log.info("research migration: moved %d legacy file(s) into reports/%s", moved, rid)
    return {"moved": moved, "skipped": skipped, "report": rid}
