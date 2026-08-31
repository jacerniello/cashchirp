"""Search endpoint — powers the navbar omni-search (SearchModal). Matches the
contract in web/src/hooks/useSearch.ts:

    GET /search/?q=<query>[&type=stock|fund|entity]
        -> { results: SearchResult[], query: <q> }

Each result carries the fields the modal renders — `ticker`, `name`, `exchange`,
`cik`, and a precomputed `url` — plus `permaticker` and `sector` so the row can
link to /company/<permaticker>. Results map `securities.search(...)`, keyed on the
stable permaticker (never ticker alone). `type` mirrors the modal's filter tabs:
`fund` narrows to funds/ETFs, anything else returns companies.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from core.api.serialize import json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.securities import securities

router = APIRouter(prefix="/search", tags=["search"])


def _result(rec: dict[str, Any]) -> dict[str, Any]:
    """One security row -> the StockResult shape SearchModal expects."""
    perma = rec.get("permaticker")
    perma_str = str(perma) if perma is not None else None
    # Funds/ETFs get the dedicated fund page; everything else the equity company page.
    is_fund = rec.get("category") == "ETF"
    base = "/etf" if is_fund else "/company"
    return {
        "ticker": rec.get("ticker"),
        "name": rec.get("name"),
        "exchange": rec.get("exchange"),
        "sector": rec.get("sector"),
        "category": rec.get("category"),
        "permaticker": perma_str,
        # `cik` carries the permaticker so existing row links resolve (same as the
        # screener contract); `url` is the precomputed deep-link the modal navigates to.
        "cik": perma_str,
        "url": f"{base}/{perma_str}" if perma_str else None,
    }


@router.get("/")
def search(
    q: str | None = Query(None),
    type: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Omni-search the security master. `q` matches ticker or name (ticker favoured)."""
    if not q or len(q) < 1:
        return {"results": [], "query": q or ""}

    # The `fund` tab narrows to funds/ETFs; everything else is the company universe.
    category = "ETF" if type == "fund" else None
    with session_scope() as s:
        df = securities.search(s, q=q, category=category, limit=limit)

    results = [_result(rec) for rec in df.to_dict("records")]
    return {"results": json_safe(results), "query": q}
