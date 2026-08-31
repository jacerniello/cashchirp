"""Insider-transaction endpoints — Sharadar SF2 (SEC Form 3/4/5) over the
`insiders` repository.

    GET /insiders?perma_ticker=<pt>
        -> { totals: {...}, top: [...], transactions: [...] }   (company tab)
    GET /insider/{owner_id}
        -> { owner: {...}, companies: [...], transactions: [...] }  (people page)

A company is keyed on permaticker (the stable issuer id; int in equity tables); an
insider is keyed on the opaque surrogate `owner_id` (md5 of the upper-cased name),
since SF2 carries no owner CIK.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from core.api.serialize import df_records, json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.ownership import insiders

router = APIRouter(tags=["insiders"])


@router.get("/insiders")
@router.get("/insiders/")
def company_insiders(perma_ticker: str | None = Query(None)) -> dict[str, Any]:
    """Insider activity for one company: stat-card totals, top insiders, and recent
    transactions. Pulls up to 5000 rows (matching the Dash page) so the monthly
    net-flow / type-mix charts see full history, not just the latest 200 — fast now
    that sep is indexed on (permaticker, date)."""
    if not perma_ticker:
        return {"totals": {}, "top": [], "transactions": []}
    pt = int(perma_ticker)
    with session_scope() as s:
        totals = insiders.company_insider_totals(s, pt) or {}
        top = insiders.company_top_insiders(s, pt)
        transactions = insiders.for_security(s, pt, limit=5000)
        monthly_flow = insiders.company_monthly_flow(s, pt)
    return {
        "totals": json_safe([dict(totals)])[0] if totals else {},
        "top": df_records(top),
        "transactions": df_records(transactions),
        "monthly_flow": json_safe(monthly_flow),
    }


@router.get("/insiders/holdings")
@router.get("/insiders/holdings/")
def company_insider_holdings(
    perma_ticker: str | None = Query(None),
    top: int = Query(12, ge=1, le=30),
) -> dict[str, Any]:
    """Per-insider split-adjusted holdings-over-time series for a company's top insiders
    (line-per-insider chart on the Company → Insiders tab)."""
    if not perma_ticker:
        return {"series": []}
    with session_scope() as s:
        series = insiders.company_insider_holdings(s, int(perma_ticker), top_n=top)
    return {"series": series}


@router.get("/insider/{owner_id}")
def insider_person(owner_id: str) -> dict[str, Any]:
    """One insider (people page): their profile, cross-company totals, the companies
    they've traded, and their full transaction history across all companies."""
    with session_scope() as s:
        owner = insiders.resolve_owner(s, owner_id)
        if not owner:
            return {"owner": None, "totals": {}, "companies": [], "transactions": []}
        totals = insiders.owner_totals(s, owner_id) or {}
        companies = insiders.owner_companies(s, owner_id)
        transactions = insiders.owner_transactions(s, owner_id, limit=8000)
    return {
        "owner": json_safe([dict(owner)])[0],
        "totals": json_safe([dict(totals)])[0] if totals else {},
        "companies": df_records(companies),
        "transactions": df_records(transactions),
    }


@router.get("/insider/{owner_id}/holdings")
@router.get("/insider/{owner_id}/holdings/")
def insider_company_holdings(
    owner_id: str, permaticker: str | None = Query(None),
) -> dict[str, Any]:
    """Split-adjusted direct common-stock holdings-over-time for one insider in one of
    their companies (the insider page's per-company holdings chart). `permaticker` picks
    the company (from the insider's `companies` list)."""
    if not permaticker:
        return {"series": []}
    with session_scope() as s:
        series = insiders.owner_company_holdings(s, owner_id, int(permaticker))
    return {"series": series}
