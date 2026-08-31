"""13F institutional-holdings endpoints — Sharadar SF3/SF3A over the
`institutional` repository, keyed on permaticker (the stable issuer id).

    GET /institutional?perma_ticker=<pt>
        -> { aggregate: [...], ownership: [...] }
    GET /institutional/timeseries?perma_ticker=<pt>&page=0&page_size=10
        -> { total, page, page_size, holders: [...] }   (THE paginated one)
    GET /institutional/top-holders?perma_ticker=<pt>
        -> { holders: [...] }
    GET /institutional/holdings-timeseries?name=<name>&page=0&page_size=10
        -> { total, page, page_size, holdings: [...] }  (investor's holdings paginated)
    GET /institutional/investor-holdings?name=<name>&calendardate=<d>&page=0&page_size=25
        -> { name, calendardate, quarters, total, page, page_size, holdings: [...] }
    GET /institutional/co-held?perma_ticker=<pt>
        -> { securities: [] }
    GET /institutional/investor/<name>
        -> { name, book: [...], holdings: [...], sectors: [...] }  (investor page)

The timeseries route is a fast indexed range scan on `holder_timeseries(permaticker,
rank)` — it returns ONE page, never the whole holder set. The old Dash page built the
entire per-holder bubble figure server-side and took ~86s; paginating fixes that.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Query

from core.api.serialize import df_records
from core.backend.db.engine import session_scope
from core.backend.queries.ownership import institutional

router = APIRouter(prefix="/institutional", tags=["institutional"])


@router.get("")
@router.get("/")
def institutional_overview(perma_ticker: str | None = Query(None)) -> dict[str, Any]:
    """SF3A aggregate (holders/value/units over time) + ownership-% time series."""
    if not perma_ticker:
        return {"aggregate": [], "ownership": []}
    pt = int(perma_ticker)
    with session_scope() as s:
        aggregate = institutional.aggregate_for_security(s, pt)
        ownership = institutional.ownership_timeseries(s, pt)
    return {"aggregate": df_records(aggregate), "ownership": df_records(ownership)}


@router.get("/timeseries")
@router.get("/timeseries/")
def institutional_timeseries(
    perma_ticker: str | None = Query(None),
    page: int = Query(0),
    page_size: int = Query(10),
) -> dict[str, Any]:
    """One page of a security's 13F holders + their quarterly positions (indexed
    range scan on `holder_timeseries`). Never loads all holders — this is what
    fixes the 86s render."""
    if not perma_ticker:
        return {"total": 0, "page": page, "page_size": page_size, "holders": []}
    pt = int(perma_ticker)
    with session_scope() as s:
        total = institutional.holder_count(s, pt)
        holders = institutional.holder_timeseries_page(s, pt, page=page, page_size=page_size)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "holders": df_records(holders),
    }


@router.get("/top-holders")
@router.get("/top-holders/")
def institutional_top_holders(perma_ticker: str | None = Query(None)) -> dict[str, Any]:
    """Largest 13F holders of a security in its latest quarter."""
    if not perma_ticker:
        return {"holders": []}
    pt = int(perma_ticker)
    with session_scope() as s:
        holders = institutional.top_holders(s, pt)
    return {"holders": df_records(holders)}


@router.get("/holdings-timeseries")
@router.get("/holdings-timeseries/")
def institutional_holdings_timeseries(
    name: str | None = Query(None),
    page: int = Query(0),
    page_size: int = Query(10),
) -> dict[str, Any]:
    """One page of a 13F filer's held securities + their quarterly positions (the
    inverse of `/timeseries`). Keyed on `investorname` via query param; each row
    carries permaticker for company links. Powers the investor page's holdings-
    over-time bubble chart."""
    if not name:
        return {"total": 0, "page": page, "page_size": page_size, "holdings": []}
    name = unquote(name).strip()
    with session_scope() as s:
        total = institutional.investor_holding_count(s, name)
        holdings = institutional.investor_holdings_timeseries_page(
            s, name, page=page, page_size=page_size
        )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "holdings": df_records(holdings),
    }


@router.get("/investor-holdings")
@router.get("/investor-holdings/")
def institutional_investor_holdings(
    name: str | None = Query(None),
    calendardate: str | None = Query(None),
    page: int = Query(0),
    page_size: int = Query(25),
) -> dict[str, Any]:
    """One page of a 13F filer's reported positions for a chosen quarter, plus the
    list of all quarters it has filed (for the period selector). `calendardate`
    defaults to the most recent quarter. Keyed on `investorname` via query param;
    each row carries permaticker for company links."""
    empty = {
        "name": name, "calendardate": None, "quarters": [],
        "total": 0, "page": page, "page_size": page_size, "holdings": [],
    }
    if not name:
        return empty
    name = unquote(name).strip()
    with session_scope() as s:
        quarters = institutional.investor_holding_quarters(s, name)
        if not quarters:
            return {**empty, "name": name}
        cd = calendardate if calendardate in quarters else quarters[0]
        total = institutional.investor_holdings_count(s, name, cd)
        holdings = institutional.investor_holdings_page(
            s, name, cd, page=page, page_size=page_size
        )
    return {
        "name": name,
        "calendardate": cd,
        "quarters": quarters,
        "total": total,
        "page": page,
        "page_size": page_size,
        "holdings": df_records(holdings),
    }


@router.get("/co-held")
def institutional_co_held(perma_ticker: str | None = Query(None)) -> dict[str, Any]:
    """Securities commonly co-held with this one. No repo function exists for this
    yet, so this returns an empty list rather than inventing one."""
    return {"securities": []}


@router.get("/investor/{name:path}")
def institutional_investor(name: str) -> dict[str, Any]:
    """One 13F filer's book over time, holdings-by-sector history, and latest
    reported holdings (mirrors the Dash /institutional/<name> page). Keyed on
    `investorname`; positions carry permaticker for company links."""
    # `{name:path}` captures the trailing slash the Next proxy appends to every
    # /api/v1 path, so strip it (and stray whitespace) before matching investorname.
    name = unquote(name).strip().rstrip("/").strip()
    with session_scope() as s:
        book = institutional.investor_book(s, name)
        holdings = institutional.investor_holdings(s, name)
        sectors = institutional.investor_sector_history(s, name)
    return {
        "name": name,
        "book": df_records(book),
        "holdings": df_records(holdings),
        "sectors": df_records(sectors),
    }
