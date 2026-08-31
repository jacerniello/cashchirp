"""Sector cross-section endpoint, over the `sectors` repository.

    GET /sectors/overview
        -> { sectors: [{ sector, n, total_mktcap, weight, median_mktcap,
                         pe, ps, pb, ev_ebitda, net_margin, gross_margin,
                         roe, roic, sales_g_ttm, div_yield }] }

A read-time roll-up of `screener_snapshot` by GICS-style sector (count, total /
median market cap, sector weight, and median valuation/quality metrics). Instant —
the snapshot is ~17k rows. The S&P 500 sector mix *over time* lives on the `/sp500`
router (`/sp500/sectors`).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from core.api.serialize import df_records
from core.backend.db.engine import session_scope
from core.backend.queries.securities import sectors

router = APIRouter(prefix="/sectors", tags=["sectors"])


@router.get("/overview")
def overview(min_mktcap: float = Query(0.0, ge=0)) -> dict[str, Any]:
    """Per-sector cross-section of the equity universe (members with market cap ≥
    `min_mktcap`, in absolute USD). Cap-weighted aggregate ratios + % profitable."""
    with session_scope() as s:
        df = sectors.overview(s, min_mktcap=min_mktcap)
    return {"sectors": df_records(df) if not df.empty else [], "min_mktcap": min_mktcap}
