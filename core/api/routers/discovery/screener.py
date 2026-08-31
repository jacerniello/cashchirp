"""Screener endpoints — serve the precomputed `screener_snapshot` to the `/screener` and
`/screener/ideas` pages.

    GET /screener/          -> { results: ScreenerCompany[], total, page,
                                 per_page, total_pages, available_sectors,
                                 available_industries }
    GET /screener/stats/    -> column min/max for slider bounds
    GET /screener/sectors/  -> sector breakdown
    GET /screener/ideas/    -> the ACTIVE screen, run live, plus watchlist annotations
    GET /screener/screens/  -> every screen defined in config/screens/, and the active one

`/screener/` is a free-form grid (the user filters interactively); `/ideas/` runs a *saved*
screen spec — see `core.backend.screens`. Keyed on permaticker; `cik` carries the
permaticker so row links resolve until company routes are re-keyed.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.api.serialize import json_safe
from core.backend import screens, watchlist
from core.backend.db.engine import session_scope
from core.backend.queries.discovery import screener
from core.backend.queries.discovery.screener import BIOTECH_INDUSTRIES, COMMODITY_SECTORS
from core.config import settings

router = APIRouter(prefix="/screener", tags=["screener"])

# snapshot column -> ScreenerCompany field (the React contract). Extra fields
# (permaticker, altman_z) ride along; unmapped contract fields are filled null.
# Mirrors the Dash screener's RESULT_COLS (core/frontend/pages/screener.py) so the
# React results grid can show the same column set.
_OUT = {
    "ticker": "ticker", "name": "name", "sector": "sector", "industry": "industry",
    "exchange": "exchange", "marketcap": "market_cap",
    "pe": "pe_ratio", "ps": "ps_ratio", "pb": "pb_ratio",
    "ev_ebitda": "ev_ebitda", "ev_sales": "ev_sales",
    "roe": "roe", "roic": "roic",
    "gross_margin": "gross_margin", "oper_margin": "op_margin",
    "net_margin": "profit_margin",
    "eps_g_ttm": "eps_growth", "sales_g_ttm": "revenue_growth", "eps_g_5y": "eps_g_5y",
    "debt_equity": "debt_equity", "current_ratio": "current_ratio",
    "div_yield": "div_yield", "net_cash_pct": "net_cash_pct", "altman_z": "altman_z",
    "pct_below_high": "pct_below_high", "years_public": "years_public",
    "inst_holders": "inst_holders", "permaticker": "permaticker",
}
# filter/sort param name -> snapshot column. Mirrors the Dash screener's metric set
# (core/frontend/pages/screener.py). Unknown columns are skipped in the filter loop, so
# this is safe even if the snapshot lacks one. Percent columns store decimals.
_FILT = {
    "market_cap": "marketcap",
    # valuation
    "pe": "pe", "ps": "ps", "pb": "pb", "p_cash": "p_cash", "p_fcf": "p_fcf",
    "ev_ebitda": "ev_ebitda", "ev_sales": "ev_sales", "div_yield": "div_yield",
    "div_growth": "div_growth",
    # profitability & returns
    "roe": "roe", "roa": "roa", "roic": "roic",
    "gross_margin": "gross_margin", "op_margin": "oper_margin",
    "profit_margin": "net_margin", "payout": "payout",
    # financial health
    "debt_equity": "debt_equity", "ltde": "ltde", "current_ratio": "current_ratio",
    "quick_ratio": "quick_ratio", "net_cash_pct": "net_cash_pct", "altman_z": "altman_z",
    # growth
    "revenue_growth": "sales_g_ttm", "eps_growth": "eps_g_ttm",
    "sales_g_qoq": "sales_g_qoq", "eps_g_qoq": "eps_g_qoq",
    "sales_g_yr": "sales_g_yr", "eps_g_yr": "eps_g_yr",
    "sales_g_3y": "sales_g_3y", "eps_g_3y": "eps_g_3y",
    "sales_g_5y": "sales_g_5y", "eps_g_5y": "eps_g_5y",
    # market / ownership
    "inst_holders": "inst_holders", "years_public": "years_public",
    "pct_below_high": "pct_below_high", "pct_above_low": "pct_above_low",
}
_CAP_RANGE = {  # market_cap_range preset -> (min, max) in USD
    "mega": (2e11, None), "large": (1e10, 2e11), "mid": (2e9, 1e10),
    "small": (3e8, 2e9), "micro": (5e7, 3e8), "nano": (None, 5e7),
}


def _num(qp, key):
    v = qp.get(key)
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


@router.get("/")
def list_companies(request: Request) -> dict[str, Any]:
    qp = request.query_params
    with session_scope() as s:
        df = screener.snapshot(s)
    df = df.copy()

    # range filters
    for name, col in _FILT.items():
        if col not in df.columns:
            continue
        lo, hi = _num(qp, f"{name}_min"), _num(qp, f"{name}_max")
        if lo is not None:
            df = df[df[col] >= lo]
        if hi is not None:
            df = df[df[col] <= hi]
    if (rng := qp.get("market_cap_range")) in _CAP_RANGE:
        lo, hi = _CAP_RANGE[rng]
        if lo is not None:
            df = df[df["marketcap"] >= lo]
        if hi is not None:
            df = df[df["marketcap"] < hi]
    if sector := qp.get("sector"):
        df = df[df["sector"] == sector]
    if industry := qp.get("industry"):
        df = df[df["industry"] == industry]
    if exchange := qp.get("exchange"):
        df = df[df["exchange"] == exchange]
    # Sector/industry exclusion toggles ("Excl. commodities" / "Excl. biotech").
    if qp.get("exclude_commodities") == "true":
        df = df[~df["sector"].isin(COMMODITY_SECTORS)]
    if qp.get("exclude_biotech") == "true":
        df = df[~df["industry"].isin(BIOTECH_INDUSTRIES)]
    # `include_delisted` is the "Incl. delisted" toggle; otherwise we keep the
    # legacy `is_active` contract (True ⇒ listed only). include_delisted wins when set.
    if qp.get("include_delisted") == "true":
        pass  # keep delisted rows
    elif (active := qp.get("is_active")) in ("true", "false"):
        want = active == "true"
        df = df[(df["isdelisted"] != "Y") == want]

    # sort (Django style: leading "-" = desc). `name` sorts the company name; every
    # other key resolves through _FILT to its snapshot column (Dash SORTS set).
    sort = qp.get("sort") or "-market_cap"
    desc = sort.startswith("-")
    key = sort.lstrip("-")
    col = "name" if key == "name" else _FILT.get(key, "marketcap")
    if col in df.columns:
        df = df.sort_values(col, ascending=not desc, na_position="last")

    total = len(df)
    page = max(int(qp.get("page") or 1), 1)
    per_page = min(max(int(qp.get("per_page") or 50), 1), 200)
    page_df = df.iloc[(page - 1) * per_page: page * per_page]

    results = []
    for rec in page_df.to_dict("records"):
        row = {out: rec.get(src) for src, out in _OUT.items()}
        row["cik"] = str(rec.get("permaticker")) if rec.get("permaticker") else None
        row["location"] = rec.get("location")
        row["is_active"] = rec.get("isdelisted") != "Y"
        # contract fields the snapshot doesn't carry
        row.setdefault("peg_ratio", None)
        row["piotroski_f_score"] = None
        row["inst_ownership_latest"] = None
        row["inst_ownership_prev"] = None
        results.append(row)

    return {
        "results": json_safe(results),
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "available_sectors": sorted(df["sector"].dropna().unique().tolist()),
        "available_industries": sorted(df["industry"].dropna().unique().tolist()),
        "available_exchanges": sorted(df["exchange"].dropna().unique().tolist()),
    }


_RANGE_LABELS = {
    "mega": "> $200B", "large": "$10B – $200B", "mid": "$2B – $10B",
    "small": "$300M – $2B", "micro": "$50M – $300M", "nano": "< $50M",
}


@router.get("/stats/")
def stats() -> dict[str, Any]:
    """Per-market-cap-range counts + labels — the ScreenerStats contract."""
    with session_scope() as s:
        df = screener.snapshot(s)
    mc = pd.to_numeric(df["marketcap"], errors="coerce")
    ranges = {}
    for key, (lo, hi) in _CAP_RANGE.items():
        mask = mc.notna()
        if lo is not None:
            mask &= mc >= lo
        if hi is not None:
            mask &= mc < hi
        ranges[key] = int(mask.sum())
    return {"ranges": ranges, "range_definitions": _RANGE_LABELS}


@router.get("/sectors/")
def sectors() -> dict[str, Any]:
    """Distinct sectors + industries + exchanges — the SectorsResponse contract."""
    with session_scope() as s:
        df = screener.snapshot(s)
    return {
        "sectors": sorted(df["sector"].dropna().unique().tolist()),
        "industries": sorted(df["industry"].dropna().unique().tolist()),
        "exchanges": sorted(df["exchange"].dropna().unique().tolist()),
    }


# --- Idea board ------------------------------------------------------------
# The screen itself is a user-owned YAML spec (`config/screens/`, see core.backend.screens);
# the per-name judgement layered on top is a user-owned JSON file
# (`research/watchlist/annotations.json`, see core.backend.watchlist). Neither is hardcoded
# here: this endpoint runs whatever screen is active and annotates it with whatever notes
# exist, so a fresh clone gets a working idea board with no notes rather than someone
# else's opinions.


@router.get("/ideas/")
def ideas(screen: str | None = None) -> dict[str, Any]:
    """Idea board — one saved screen run live on the snapshot, enriched with the user's
    own watchlist notes.

    `screen` picks which saved screen to run; omitted, it is `ACTIVE_SCREEN`. Being able
    to switch is the point of saving several: comparing what two filters surface *right
    now* is the cheapest way to tell a real difference in selectivity from a difference
    you imagined when you wrote them.

    Returns every survivor as a ScreenerCompany row (so a UI can reuse the `/screener` grid),
    plus `thesis` + `why_unloved` for annotated names and `caution` for names the screen
    catches but the user has flagged. Annotated names sort first, then cheapest
    (EV/EBITDA) first; flagged names sink to the bottom. With no annotations file, every
    row simply comes back unannotated in cheapest-first order."""
    try:
        spec = screens.load_screen(screen) if screen else screens.active_screen()
    except screens.ScreenSpecError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ann = watchlist.load_annotations()
    notes, cautions = ann["notes"], ann["cautions"]
    with session_scope() as s:
        df = screener.snapshot(s)
    cand = screener.screen_candidates(df, spec=spec)
    results = []
    for rec in cand.to_dict("records"):
        pt = rec.get("permaticker")
        pt = int(pt) if pt is not None else None
        row = {out: rec.get(src) for src, out in _OUT.items()}
        row["cik"] = str(pt) if pt is not None else None
        row["location"] = rec.get("location")
        row["is_active"] = rec.get("isdelisted") != "Y"
        row["peg_ratio"] = None
        row["piotroski_f_score"] = None
        row["inst_ownership_latest"] = None
        row["inst_ownership_prev"] = None
        note = notes.get(pt) or {}
        row["thesis"] = note.get("thesis")
        row["why_unloved"] = note.get("why_unloved")
        row["caution"] = cautions.get(pt)
        results.append(row)
    # Annotated names first, flagged names last, cheapest within each group.
    def _rank(r):
        bucket = 0 if r["thesis"] else (2 if r["caution"] else 1)
        ev = r["ev_ebitda"]
        return (bucket, ev if ev is not None else 1e9)
    results.sort(key=_rank)
    asof = df["asof"].iloc[0] if "asof" in df.columns and len(df) else None
    return {
        "results": json_safe(results),
        "total": len(results),
        "ideas": sum(r["thesis"] is not None for r in results),
        "flagged": sum(r["caution"] is not None for r in results),
        "asof": str(asof) if asof is not None else None,
        "screen": {"id": spec.get("id"), "title": spec.get("title"),
                   "description": (spec.get("description") or "").strip(),
                   "is_active": spec.get("id") == settings.active_screen},
        "available": [{k: v for k, v in x.items() if k != "path"}
                      for x in screens.list_screens()],
        "criteria": spec.get("criteria") or [],
    }


@router.get("/screens/")
def screens_index() -> dict[str, Any]:
    """Every screen defined in `config/screens/`, and which one is active. Lets a UI offer
    the user's own screens by name instead of assuming one built-in filter."""
    active = settings.active_screen
    return {"active": active,
            "screens": [{k: v for k, v in s.items() if k != "path"}
                        for s in screens.list_screens()]}


class SaveScreenRequest(BaseModel):
    """A filter the user wants to keep, as the `/screener` grid holds it."""

    id: str
    title: str = ""
    description: str = ""
    criteria: list[str] = []
    params: dict[str, Any] = {}
    overwrite: bool = False
    # The screen this filter was loaded FROM, if any. Its grid-invisible constraints
    # (growth rules, exclusive bounds) are carried forward so editing a loaded screen
    # cannot silently delete the parts you were never shown.
    base: str = ""


@router.post("/screens/")
def save_screen(req: SaveScreenRequest) -> dict[str, Any]:
    """Save the current filter as a screen — `config/screens/<id>.yaml`.

    It is written in the SAME format the idea board and the point-in-time backtest read,
    so a filter you built by dragging sliders becomes immediately runnable and
    backtestable rather than being trapped in the UI.

    The response carries `unsupported`: anything in the query that could not be expressed
    as a gate. It is deliberately not an error — the screen still saves — but it must be
    shown, because a saved filter that silently lost a constraint would have you backtest
    a different screen from the one you were looking at."""
    spec, unsupported = screens.spec_from_params(
        req.id.strip().lower(), req.params,
        title=req.title, description=req.description, criteria=req.criteria,
    )
    carried: list[str] = []
    if req.base:
        try:
            base_spec = screens.load_screen(req.base)
        except screens.ScreenSpecError:
            base_spec = {}
        if base_spec:
            spec, carried = screens.merge_unrepresentable(base_spec, spec)

    try:
        path = screens.save_screen(spec, overwrite=req.overwrite)
    except screens.ScreenSpecError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "saved": spec["id"],
        "path": str(path),
        "spec": spec,
        "unsupported": unsupported,
        "carried": carried,
        "run": f"python -m core.scripts.screen.run_screen {spec['id']}",
    }


@router.delete("/screens/{screen_id}")
def delete_screen(screen_id: str) -> dict[str, Any]:
    """Delete a saved screen. The active screen is protected — removing the file the app
    is configured to run would break the idea board with no obvious cause."""
    if screen_id == settings.active_screen:
        raise HTTPException(
            status_code=409,
            detail=f"{screen_id!r} is the ACTIVE screen. Point ACTIVE_SCREEN at another "
                   "screen in core/.env before deleting it.",
        )
    if not screens.delete_screen(screen_id):
        raise HTTPException(status_code=404, detail=f"No screen {screen_id!r}.")
    return {"deleted": screen_id}


@router.get("/screens/{screen_id}")
def get_screen(screen_id: str) -> dict[str, Any]:
    """One saved screen: its full spec, plus the `/screener` URL params that reproduce it.

    `url_params` is what makes a saved screen clickable — the grid can load the filter you
    saved instead of just naming it. `lossy` lists constraints the grid has no widget for
    (exclusive bounds, growth rules, multi-value selections); those still apply whenever
    the screen is *run*, they simply aren't shown, and the UI says so rather than implying
    the loaded filter is the whole screen."""
    try:
        spec = screens.load_screen(screen_id)
    except screens.ScreenSpecError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    params, lossy = screens.params_from_spec(spec)
    return {
        "id": spec.get("id", screen_id),
        "title": spec.get("title", screen_id),
        "description": (spec.get("description") or "").strip(),
        "criteria": spec.get("criteria") or [],
        "active": screen_id == settings.active_screen,
        "spec": spec,
        "url_params": params,
        "lossy": lossy,
    }
