"""The research store: plain files under `settings.research_dir`, readable by people and AI.

The apparatus (this module, the DD standard, the AI prompts) lives in the repo; the research
itself does not. `research_dir` defaults to `<repo>/research/`, which git ignores, so notes
and reports stay on the machine that wrote them and never ride along with a push.

    research/
      stocks/<permaticker>/   meta.json · notes.md (yours) · dd.json · redteam.md (AI)
      groups/<id>.json        a named, editable set of stocks
      snapshots/<id>.json     a screener result frozen at a moment, trimmable
      notes/**.md             free-form notes not tied to one stock

Stocks are keyed by permaticker, never ticker: tickers get recycled. Files are written
atomically (temp file + rename), so a reader — a page, or an AI agent editing the same
folder — never sees half a file. Everything here tolerates hand edits: a file someone broke
is reported, not fatal.
"""
from __future__ import annotations

import json
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

STOCK_DOCS = {"notes": "notes.md", "dd": "dd.json", "redteam": "redteam.md"}


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


def get_stock(permaticker: Any) -> dict:
    d = stock_dir(permaticker)
    meta, _ = _read_json(d / "meta.json")
    dd, dd_err = _read_json(d / "dd.json")
    pt = _pt(permaticker)
    return {
        "permaticker": pt,
        "meta": meta if isinstance(meta, dict) else None,
        "notes": _read_text(d / "notes.md"),
        "notes_updated": _mtime(d / "notes.md"),
        "dd": dd if isinstance(dd, dict) else None,
        "dd_error": dd_err,
        "dd_updated": _mtime(d / "dd.json"),
        "redteam": _read_text(d / "redteam.md"),
        "redteam_updated": _mtime(d / "redteam.md"),
        "groups": [{"id": g["id"], "name": g["name"]} for g in list_groups()
                   if any(str(m.get("permaticker")) == pt for m in g.get("members", []))],
        "snapshots": [{"id": s["id"], "name": s["name"], "created_at": s.get("created_at")}
                      for s in list_snapshots(full=True)
                      if any(str(m.get("permaticker")) == pt for m in s.get("members", []))],
    }


def save_stock_doc(permaticker: Any, doc: str, content: Any, ticker: str | None = None,
                   name: str | None = None) -> None:
    if doc not in STOCK_DOCS:
        raise ValueError(f"doc must be one of {list(STOCK_DOCS)}")
    touch_stock(permaticker, ticker, name)
    path = stock_dir(permaticker) / STOCK_DOCS[doc]
    if doc == "dd":
        if not isinstance(content, dict):
            raise ValueError("dd must be a JSON object")
        _write_json(path, content)
    else:
        _write(path, str(content))


def delete_stock_doc(permaticker: Any, doc: str) -> bool:
    if doc not in STOCK_DOCS:
        raise ValueError(f"doc must be one of {list(STOCK_DOCS)}")
    path = stock_dir(permaticker) / STOCK_DOCS[doc]
    if not path.exists():
        return False
    path.unlink()
    return True


def list_stocks() -> list[dict]:
    """Every researched stock, with its rating — the rankings view."""
    base = root() / "stocks"
    if not base.is_dir():
        return []
    memberships: dict[str, list[dict]] = {}
    for g in list_groups():
        for m in g.get("members", []):
            memberships.setdefault(str(m.get("permaticker")), []).append({"id": g["id"], "name": g["name"]})
    out = []
    for d in sorted(p for p in base.iterdir() if p.is_dir() and p.name.isdigit()):
        meta, _ = _read_json(d / "meta.json")
        meta = meta if isinstance(meta, dict) else {}
        dd, dd_err = _read_json(d / "dd.json")
        out.append({
            "permaticker": d.name,
            "ticker": meta.get("ticker") or (dd or {}).get("ticker") if isinstance(dd, dict) else meta.get("ticker"),
            "name": meta.get("name") or ((dd or {}).get("company") if isinstance(dd, dict) else None),
            "has_notes": (d / "notes.md").exists(),
            "has_dd": isinstance(dd, dict),
            "dd_error": dd_err,
            "has_redteam": (d / "redteam.md").exists(),
            "rating": _rating(dd),
            "groups": memberships.get(d.name, []),
            "updated_at": max(filter(None, [_mtime(d / f) for f in ("meta.json", *STOCK_DOCS.values())]),
                              default=None),
        })
    return out


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
         "created_at": _now(), "updated_at": _now(), "members": []}
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
    if name is not None:
        g["name"] = name.strip() or g["name"]
    if description is not None:
        g["description"] = description
    members = {str(m["permaticker"]): m for m in g.get("members", []) if m.get("permaticker")}
    for m in add or []:
        new = _member(m, by)
        old = members.get(new["permaticker"])
        if old:  # keep the original provenance; refresh the note if one was given
            new = {**old, "note": new["note"] or old.get("note", "")}
        members[new["permaticker"]] = new
    for pt in remove or []:
        members.pop(str(pt), None)
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
    s, err = _read_json(_snaps_dir() / f"{_slug(sid)}.json")
    if s is None and err is None:
        return None
    if not isinstance(s, dict):
        return {"id": sid, "name": sid, "members": [], "error": err}
    s["id"] = _slug(sid)
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
    p = _snaps_dir() / f"{_slug(sid)}.json"
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
    for sub in ("stocks", "groups", "snapshots", "notes", "backtests", "_guide"):
        (base / sub).mkdir(parents=True, exist_ok=True)
    copies = {"CLAUDE.md": base / "CLAUDE.md"}
    copies.update({p.name: base / "_guide" / p.name for p in _GUIDE_SRC.iterdir()
                   if p.is_file() and p.name != "CLAUDE.md"})
    for name, dest in copies.items():
        src = (_GUIDE_SRC / name).read_text(encoding="utf-8")
        if _read_text(dest) != src:
            _write(dest, src)
