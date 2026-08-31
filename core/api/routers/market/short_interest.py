"""Short-interest endpoint — FINRA Consolidated Equity Short Interest for one
security, over the `short_interest` repository:

    GET /short-interest?perma_ticker=<pt>  ->  { rows: [<timeseries records>] }

Keyed on permaticker (the stable issuer id). The repository restates the as-filed
short count onto sf1's split-adjusted share basis before computing
`short_pct_shares` (see short_interest.py). Securities with no resolved FINRA rows
(OTC names outside Sharadar's universe, or no reported short interest) return an
empty `rows` list, which is fine.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Query

from core.api.serialize import df_records
from core.backend.db.engine import session_scope
from core.backend.queries.market import short_interest

router = APIRouter(tags=["short-interest"])


@router.get("/short-interest")
@router.get("/short-interest/")
def get_short_interest(perma_ticker: str | None = Query(None)) -> dict[str, Any]:
    """Bi-monthly short-interest time series for one security (by permaticker):
    settlementdate, current/previous short, change_pct, avg_daily_vol,
    days_to_cover, sharesbas, split_factor, adj_short, short_pct_shares."""
    if not perma_ticker:
        return {"rows": []}
    with session_scope() as s:
        df = short_interest.short_interest_timeseries(s, perma_ticker)
    if df.empty:
        return {"rows": []}
    df = df.copy()
    if "settlementdate" in df.columns:
        df["settlementdate"] = pd.to_datetime(df["settlementdate"]).dt.strftime("%Y-%m-%d")
    return {"rows": df_records(df)}
