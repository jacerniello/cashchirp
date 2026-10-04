"""Research endpoints — reports (dated DD runs with their notes) and screener snapshots.

    GET    /research/                         research status per stock (latest analysis) + counts
    GET    /research/stocks/{pt}              a stock across reports: analysis history, latest DD,
                                              reports with notes on it, snapshots
    GET    /research/reports                  POST to start a report (from a snapshot or by hand)
    GET    /research/reports/{id}             the report + its ranking; PATCH, DELETE
    GET    /research/reports/{id}/stocks/{pt}/{doc}   dd | redteam | notes within a report; PUT, DELETE
    GET    /research/reports/{id}/notes       the report's notes; GET/PUT/DELETE .../notes/{path}
    GET    /research/snapshots                POST to freeze a grid filter or saved screen
    GET    /research/snapshots/{id}           PATCH (name/note/remove/restore), DELETE
    GET    /research/snapshots/{id}/csv
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
from core.backend.queries.securities.prices import latest_closes
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


def _with_prices(items: list[dict]) -> str | None:
    """Stamp `price_now` / `price_date` (latest sep close) onto each item, in ONE query.
    Research is files and must still render when the database is down, so a failure
    leaves the prices null and comes back as an error string instead of raising."""
    pts = [i["permaticker"] for i in items if i.get("permaticker")]
    for i in items:
        i["price_now"] = i["price_date"] = None
    if not pts:
        return None
    try:
        with session_scope() as s:
            px = latest_closes(s, pts)
    except Exception as exc:  # noqa: BLE001 — degrade, don't fail the page
        return f"current prices unavailable: {type(exc).__name__}"
    for i in items:
        p = px.get(int(i["permaticker"]))
        if p:
            i["price_now"] = float(p["close"]) if p["close"] is not None else None
            i["price_date"] = str(p["date"])
    return None


# ------------------------------------------------------------------------------- index

@router.get("/")
def index() -> dict[str, Any]:
    """Every researched stock with its latest analysis, and how much research there is."""
    return {"root": str(store.root()), "stocks": store.list_stocks(),
            "reports": len(store.list_reports()), "snapshots": len(store.list_snapshots())}


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


# ----------------------------------------------------------------------------- reports

class ReportMember(BaseModel):
    permaticker: str
    ticker: str | None = None
    name: str | None = None


class ReportCreate(BaseModel):
    """Start a report. From a snapshot its kept members (or `permatickers`, the selected
    rows); without one, `members` by hand."""
    name: str = ""
    thesis: str = ""
    snapshot_id: str | None = None
    permatickers: list[str] | None = None
    members_from: str | None = None  # "kept" | "selected" (selected = use `permatickers`)
    members: list[ReportMember] = []


class ReportPatch(BaseModel):
    name: str | None = None
    thesis: str | None = None
    status: str | None = None
    notes: str | None = None
    add: list[ReportMember] = []
    add_from_source: bool = False
    remove: list[str] = []


def _report_404(rid: str):
    raise HTTPException(404, f"No report {rid!r}.")


@router.get("/reports")
def reports() -> dict[str, Any]:
    return {"reports": store.list_reports()}


@router.post("/reports")
def create_report(body: ReportCreate) -> dict[str, Any]:
    if body.members_from not in (None, "kept", "selected"):
        raise HTTPException(400, "members_from must be 'kept' or 'selected'.")
    if body.members_from == "selected" and not body.permatickers:
        raise HTTPException(400, "members_from='selected' needs permatickers.")
    pick = body.permatickers if body.members_from != "kept" else None
    try:
        rep = store.create_report(
            body.name, thesis=body.thesis, snapshot_id=body.snapshot_id, permatickers=pick,
            members=[m.model_dump() for m in body.members])
    except KeyError as exc:
        raise HTTPException(404, f"No {exc.args[0]}.") from None
    except ValueError as exc:
        _bad(exc)
    return {"id": rep["id"], "count": len(rep["members"]), "open": f"/research/reports/{rep['id']}"}


@router.get("/reports/{rid}")
def report(rid: str) -> dict[str, Any]:
    try:
        rep = store.get_report(rid)
    except ValueError as exc:
        _bad(exc)
    if rep is None:
        _report_404(rid)
    rep["prices_error"] = _with_prices(rep["members"])
    return rep


@router.patch("/reports/{rid}")
def patch_report(rid: str, body: ReportPatch) -> dict[str, Any]:
    try:
        return store.update_report(
            rid, name=body.name, thesis=body.thesis, status=body.status, notes=body.notes,
            add=[m.model_dump() for m in body.add], add_from_source=body.add_from_source,
            remove=body.remove)
    except KeyError:
        _report_404(rid)
    except ValueError as exc:
        _bad(exc)


@router.delete("/reports/{rid}")
def delete_report(rid: str) -> dict[str, Any]:
    try:
        if not store.delete_report(rid):
            _report_404(rid)
    except ValueError as exc:
        _bad(exc)
    return {"deleted": rid}


@router.get("/reports/{rid}/stocks/{pt}/{doc}")
def report_doc(rid: str, pt: str, doc: str) -> dict[str, Any]:
    try:
        if store.get_report(rid) is None:
            _report_404(rid)
        content, err = store.read_report_doc(rid, pt, doc)
    except ValueError as exc:
        _bad(exc)
    if content is None and err is None:
        raise HTTPException(404, f"No {doc} for {pt} in report {rid!r}.")
    return {"report_id": rid, "permaticker": pt, "doc": doc, "content": content, "error": err}


@router.put("/reports/{rid}/stocks/{pt}/{doc}")
def put_report_doc(rid: str, pt: str, doc: str, body: DocBody) -> dict[str, Any]:
    try:
        store.save_report_doc(rid, pt, doc, body.content, body.ticker, body.name)
    except KeyError:
        _report_404(rid)
    except ValueError as exc:
        _bad(exc)
    return {"saved": doc}


@router.delete("/reports/{rid}/stocks/{pt}/{doc}")
def delete_report_doc(rid: str, pt: str, doc: str) -> dict[str, Any]:
    try:
        if not store.delete_report_doc(rid, pt, doc):
            raise HTTPException(404, f"No {doc} for {pt} in report {rid!r}.")
    except ValueError as exc:
        _bad(exc)
    return {"deleted": doc}


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
            "has_redteam": r["has_redteam"]}
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


# ------------------------------------------------------------------------ report notes

class NoteBody(BaseModel):
    text: str


@router.get("/reports/{rid}/notes")
def report_notes(rid: str) -> dict[str, Any]:
    try:
        if store.get_report(rid) is None:
            _report_404(rid)
        return {"report_id": rid, "notes": store.list_report_notes(rid)}
    except ValueError as exc:
        _bad(exc)


@router.get("/reports/{rid}/notes/{path:path}")
def report_note(rid: str, path: str) -> dict[str, Any]:
    try:
        text = store.read_report_note(rid, path)
    except ValueError as exc:
        _bad(exc)
    if text is None:
        raise HTTPException(404, f"No note {path!r} in report {rid!r}.")
    return {"report_id": rid, "path": path, "text": text}


@router.put("/reports/{rid}/notes/{path:path}")
def put_report_note(rid: str, path: str, body: NoteBody) -> dict[str, Any]:
    try:
        return {"saved": store.write_report_note(rid, path, body.text)}
    except KeyError:
        _report_404(rid)
    except ValueError as exc:
        _bad(exc)


@router.delete("/reports/{rid}/notes/{path:path}")
def delete_report_note(rid: str, path: str) -> dict[str, Any]:
    try:
        if not store.delete_report_note(rid, path):
            raise HTTPException(404, f"No note {path!r} in report {rid!r}.")
    except ValueError as exc:
        _bad(exc)
    return {"deleted": path}
