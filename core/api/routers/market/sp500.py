"""S&P 500 concentration & sector-composition endpoints, over the `sp500` repository.

    GET /sp500/concentration
        -> { asof, series: [{ date, n_constituents, top1_weight, …, top50_weight,
                              hhi, effective_n, top1_ticker, top1_name }] }
    GET /sp500/sectors
        -> { asof, sectors: [...], series: [{ date, <sector>: weight_pct, … }] }
    GET /sp500/constituents[?limit=25]
        -> { asof, constituents: [{ rank, ticker, name, sector, marketcap, weight }] }

All three read the small precomputed tables (`sp500_concentration`,
`sp500_sector_weights`) — point-in-time, full-cap-weighted (see the repository
docstring). The `/sectors` series is pivoted to one row per date with a column per
sector so the page can stack it directly.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Query

from core.api.serialize import df_records, json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.market import index_lab, sp500

router = APIRouter(prefix="/sp500", tags=["sp500"])


def _asof(df: pd.DataFrame) -> str | None:
    if df.empty or "asof" not in df:
        return None
    return str(df["asof"].iloc[0])


def _fmt_dates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    return df


@router.get("/concentration")
def concentration() -> dict[str, Any]:
    """Index concentration time series — top-N cap-weights, HHI, effective N."""
    with session_scope() as s:
        df = sp500.concentration(s)
    if df.empty:
        return {"asof": None, "series": []}
    asof = _asof(df)
    out = _fmt_dates(df.drop(columns=["asof"], errors="ignore"))
    return {"asof": asof, "series": df_records(out)}


@router.get("/sectors")
def sectors() -> dict[str, Any]:
    """S&P 500 sector cap-weights over time, pivoted to one row per date (a column
    per sector) so the page can render a stacked area directly."""
    with session_scope() as s:
        df = sp500.sector_weights(s)
    if df.empty:
        return {"asof": None, "sectors": [], "series": []}
    asof = _asof(df)
    df = _fmt_dates(df)
    # Sector order: largest by latest weight first (stable, legible stacking).
    latest = df[df["date"] == df["date"].max()]
    order = latest.sort_values("weight", ascending=False)["sector"].tolist()
    wide = df.pivot_table(index="date", columns="sector", values="weight").reset_index()
    wide = wide[["date"] + [c for c in order if c in wide.columns]]
    return {"asof": asof, "sectors": order, "series": json_safe(wide.to_dict("records"))}


@router.get("/constituents")
def constituents(limit: int = Query(25, ge=1, le=100)) -> dict[str, Any]:
    """The largest current constituents with their index cap-weight."""
    with session_scope() as s:
        df = sp500.latest_constituents(s, limit)
    return {"constituents": df_records(df) if not df.empty else []}


# --- Index lab: counterfactual "S&P 500 without X" -------------------------

@router.get("/lab/options")
def lab_options() -> dict[str, Any]:
    """Controls for the index lab: sector list, largest constituents (the company
    picker), and the available month range."""
    with session_scope() as s:
        return index_lab.options(s)


@router.get("/lab/backtest")
def lab_backtest(
    exclude_sectors: list[str] = Query(default=[]),
    exclude_tickers: list[int] = Query(default=[]),
    weighting: str = Query("cap", pattern="^(cap|equal)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
) -> dict[str, Any]:
    """Reconstruct the baseline S&P 500 and a scenario with the given sectors /
    companies (`exclude_tickers` = permatickers) removed, plus the removed-only
    sleeve. `weighting` ∈ {cap, equal}. Returns rebased (=100) level series + stats."""
    with session_scope() as s:
        return index_lab.backtest(
            s,
            exclude_sectors=exclude_sectors or None,
            exclude_permatickers=exclude_tickers or None,
            equal_weight=(weighting == "equal"),
            start=start,
            end=end,
        )
