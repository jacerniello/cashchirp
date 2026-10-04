"""Research endpoints — per-stock notes and DD, groups, screener snapshots, free notes.

    GET    /research/                         rankings: every researched stock + rating
    GET    /research/stocks/{pt}              notes, dd, redteam, groups, snapshots for one stock
    PUT    /research/stocks/{pt}/{doc}        write notes | dd | redteam
    DELETE /research/stocks/{pt}/{doc}
    GET    /research/groups                   POST to create
    GET    /research/groups/{id}              PATCH (name/description/add/remove), DELETE
    GET    /research/snapshots                POST to freeze a grid filter or saved screen
    GET    /research/snapshots/{id}           PATCH (name/note/remove/restore), DELETE
    GET    /research/snapshots/{id}/csv
    GET    /research/notes                    GET/PUT/DELETE /research/notes/{path}
    GET    /research/guide                    where the research folder is, for pointing an AI at it

Everything reads and writes files under `settings.research_dir` (see core.backend.research.store);
an AI agent editing those files directly and this API see the same state.
"""
from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from core.api.serialize import json_safe
from core.backend import screens
from core.backend.db.engine import session_scope
from core.backend.queries.discovery import screener as screener_q
from core.backend.research import store

router = APIRouter(prefix="/research", tags=["research"])

# Make sure the folder and the AI guide exist the moment the API starts, so "point Claude at
# the research folder" works before anyone has saved anything. Best-effort: an unwritable
# research_dir must not stop the rest of the API from starting.
try:
    store.ensure_layout()
except OSError as exc:
    import logging
    logging.getLogger("cashchirp.research").warning("research folder setup failed: %s", exc)

# Snapshot columns kept per member: identity plus the metrics a reviewer (human or AI)
# wants without re-querying. Values are as of the snapshot's `asof`.
_SNAP_COLS = {
    "permaticker": "permaticker", "ticker": "ticker", "name": "name", "sector": "sector",
    "industry": "industry", "exchange": "exchange", "marketcap": "market_cap",
    "pe": "pe", "ps": "ps", "pb": "pb", "ev_ebitda": "ev_ebitda", "ev_sales": "ev_sales",
    "p_fcf": "p_fcf", "roe": "roe", "roic": "roic", "gross_margin": "gross_margin",
    "oper_margin": "op_margin", "net_margin": "net_margin", "sales_g_ttm": "revenue_growth",
    "eps_g_ttm": "eps_growth", "sales_g_5y": "sales_g_5y", "debt_equity": "debt_equity",
    "net_cash_pct": "net_cash_pct", "altman_z": "altman_z", "div_yield": "div_yield",
    "pct_below_high": "pct_below_high",
}


def _bad(exc: Exception, code: int = 400):
    raise HTTPException(code, str(exc)) from exc


# ---------------------------------------------------------------------------- rankings

@router.get("/")
def index() -> dict[str, Any]:
    stocks = store.list_stocks()
    return {"root": str(store.root()), "stocks": stocks,
            "groups": len(store.list_groups()), "snapshots": len(store.list_snapshots()),
            "notes": len(store.list_notes())}


@router.get("/guide")
def guide() -> dict[str, Any]:
    return {"root": str(store.root()), "guide": str(store.root() / "CLAUDE.md")}


# ------------------------------------------------------------------------------ stocks

class DocBody(BaseModel):
    content: Any
    ticker: str | None = None
    name: str | None = None


@router.get("/stocks/{pt}")
def stock(pt: str) -> dict[str, Any]:
    try:
        return store.get_stock(pt)
    except ValueError as exc:
        _bad(exc)


@router.put("/stocks/{pt}/{doc}")
def put_doc(pt: str, doc: str, body: DocBody) -> dict[str, Any]:
    try:
        store.save_stock_doc(pt, doc, body.content, body.ticker, body.name)
    except ValueError as exc:
        _bad(exc)
    return {"saved": doc}


@router.delete("/stocks/{pt}/{doc}")
def delete_doc(pt: str, doc: str) -> dict[str, Any]:
    try:
        if not store.delete_stock_doc(pt, doc):
            raise HTTPException(404, f"No {doc} for {pt}.")
    except ValueError as exc:
        _bad(exc)
    return {"deleted": doc}


# ------------------------------------------------------------------------------ groups

class GroupCreate(BaseModel):
    name: str
    description: str = ""


class Member(BaseModel):
    permaticker: str
    ticker: str | None = None
    name: str | None = None
    note: str = ""


class GroupPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    add: list[Member] = []
    remove: list[str] = []


@router.get("/groups")
def groups() -> dict[str, Any]:
    return {"groups": store.list_groups()}


@router.post("/groups")
def create_group(body: GroupCreate) -> dict[str, Any]:
    try:
        return store.create_group(body.name, body.description)
    except ValueError as exc:
        _bad(exc)


@router.get("/groups/{gid}")
def group(gid: str) -> dict[str, Any]:
    g = store.get_group(gid)
    if g is None:
        raise HTTPException(404, f"No group {gid!r}.")
    ratings = {s["permaticker"]: s["rating"] for s in store.list_stocks()}
    for m in g.get("members", []):
        m["rating"] = ratings.get(str(m.get("permaticker")))
    return g


@router.patch("/groups/{gid}")
def patch_group(gid: str, body: GroupPatch) -> dict[str, Any]:
    try:
        return store.update_group(
            gid, name=body.name, description=body.description,
            add=[m.model_dump() for m in body.add], remove=body.remove)
    except KeyError:
        raise HTTPException(404, f"No group {gid!r}.") from None
    except ValueError as exc:
        _bad(exc)


@router.delete("/groups/{gid}")
def delete_group(gid: str) -> dict[str, Any]:
    if not store.delete_group(gid):
        raise HTTPException(404, f"No group {gid!r}.")
    return {"deleted": gid}


# --------------------------------------------------------------------------- snapshots

class SnapshotCreate(BaseModel):
    """Freeze either the `/screener` grid's current filter (`params`) or a saved screen
    (`screen_id`). Every matching row is stored, not just one page."""
    name: str = ""
    note: str = ""
    params: dict[str, Any] | None = None
    screen_id: str | None = None


class SnapshotPatch(BaseModel):
    name: str | None = None
    note: str | None = None
    remove: list[str] = []
    restore: list[str] = []


@router.get("/snapshots")
def snapshots() -> dict[str, Any]:
    return {"snapshots": store.list_snapshots()}


@router.post("/snapshots")
def create_snapshot(body: SnapshotCreate) -> dict[str, Any]:
    from core.api.routers.discovery.screener import filter_grid, params_to_query

    with session_scope() as s:
        df = screener_q.snapshot(s)
    asof = str(df["asof"].iloc[0]) if "asof" in df.columns and len(df) else None
    if body.screen_id:
        try:
            spec = screens.load_screen(body.screen_id)
        except screens.ScreenSpecError as exc:
            raise HTTPException(404, str(exc)) from exc
        rows = screener_q.screen_candidates(df, spec=spec)
        source = {"kind": "screen", "screen_id": body.screen_id, "title": spec.get("title"),
                  "spec": spec}
        name = body.name or spec.get("title") or body.screen_id
    else:
        params = {k: v for k, v in (body.params or {}).items() if k not in ("page", "per_page")}
        rows = filter_grid(df, params_to_query(params))
        source = {"kind": "grid", "params": params}
        name = body.name or "Screener filter"
    if len(rows) > 5000:
        raise HTTPException(400, f"That filter matches {len(rows):,} stocks — narrow it below "
                                 "5,000 before snapshotting.")
    cols = [c for c in _SNAP_COLS if c in rows.columns]
    members = [{_SNAP_COLS[c]: v for c, v in rec.items()}
               for rec in json_safe(rows[cols].to_dict("records"))]
    snap = store.create_snapshot(name, body.note, source, asof, members)
    return {"id": snap["id"], "count": len(snap["members"]), "open": f"/screener/snapshots/{snap['id']}"}


@router.get("/snapshots/{sid}")
def snapshot(sid: str) -> dict[str, Any]:
    s = store.get_snapshot(sid)
    if s is None:
        raise HTTPException(404, f"No snapshot {sid!r}.")
    stocks = {x["permaticker"]: x for x in store.list_stocks()}
    for m in s.get("members", []):
        r = stocks.get(str(m.get("permaticker")))
        m["research"] = None if r is None else {
            "rating": r["rating"], "has_notes": r["has_notes"], "has_dd": r["has_dd"],
            "has_redteam": r["has_redteam"], "groups": r["groups"]}
    return s


@router.patch("/snapshots/{sid}")
def patch_snapshot(sid: str, body: SnapshotPatch) -> dict[str, Any]:
    try:
        return store.update_snapshot(sid, name=body.name, note=body.note,
                                               remove=body.remove, restore=body.restore)
    except KeyError:
        raise HTTPException(404, f"No snapshot {sid!r}.") from None
    except ValueError as exc:
        _bad(exc)


@router.delete("/snapshots/{sid}")
def delete_snapshot(sid: str) -> dict[str, Any]:
    if not store.delete_snapshot(sid):
        raise HTTPException(404, f"No snapshot {sid!r}.")
    return {"deleted": sid}


@router.get("/snapshots/{sid}/csv", response_class=PlainTextResponse)
def snapshot_csv(sid: str) -> PlainTextResponse:
    s = store.get_snapshot(sid)
    if s is None:
        raise HTTPException(404, f"No snapshot {sid!r}.")
    members = [m for m in s.get("members", []) if not m.get("removed")]
    cols = list(dict.fromkeys(k for m in members for k in m if k not in ("removed", "research")))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(members)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="{s["id"]}.csv"'})


# ------------------------------------------------------------------------------- notes

class NoteBody(BaseModel):
    text: str


@router.get("/notes")
def notes() -> dict[str, Any]:
    return {"notes": store.list_notes()}


@router.get("/notes/{path:path}")
def note(path: str) -> dict[str, Any]:
    try:
        text = store.read_note(path)
    except ValueError as exc:
        _bad(exc)
    if text is None:
        raise HTTPException(404, f"No note {path!r}.")
    return {"path": path, "text": text}


@router.put("/notes/{path:path}")
def put_note(path: str, body: NoteBody) -> dict[str, Any]:
    try:
        return {"saved": store.write_note(path, body.text)}
    except ValueError as exc:
        _bad(exc)


@router.delete("/notes/{path:path}")
def delete_note(path: str) -> dict[str, Any]:
    try:
        if not store.delete_note(path):
            raise HTTPException(404, f"No note {path!r}.")
    except ValueError as exc:
        _bad(exc)
    return {"deleted": path}
