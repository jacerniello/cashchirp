"""Daily valuation (`daily`) and trading metrics (`metrics`) panels, plus the
cross-sectional screener.

`daily`   — mktcap / EV / PE / PS / PB per (ticker, date).
`metrics` — beta, 52w hi/lo, moving averages, returns per (ticker, date).
Lookups by permaticker. The screener joins the latest `daily` row per security to the
master for cross-sectional filtering/sorting.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df, rows


def daily_series(session: Session, permaticker: int | str) -> pd.DataFrame:
    return query_df(
        session,
        "SELECT date, marketcap, ev, pe, ps, pb, evebit, evebitda "
        "FROM daily WHERE permaticker = :pt ORDER BY date",
        {"pt": int(permaticker)},
    )


def metrics_series(session: Session, permaticker: int | str) -> pd.DataFrame:
    return query_df(
        session,
        "SELECT date, price, beta1y, beta5y, high52w, low52w, ma50d, ma200d, "
        "return1y, return5y, returnytd, dividendyieldtrailing, "
        "volume, volumeavg3m FROM metrics WHERE permaticker = :pt ORDER BY date",
        {"pt": int(permaticker)},
    )


def latest_metrics(session: Session, permaticker: int | str) -> dict | None:
    res = rows(
        session,
        "SELECT * FROM metrics WHERE permaticker = :pt ORDER BY date DESC LIMIT 1",
        {"pt": int(permaticker)},
    )
    return res[0] if res else None


def latest_daily(session: Session, permaticker: int | str) -> dict | None:
    res = rows(
        session,
        "SELECT * FROM daily WHERE permaticker = :pt ORDER BY date DESC LIMIT 1",
        {"pt": int(permaticker)},
    )
    return res[0] if res else None


# The cross-sectional screener now lives in `repositories/screener.py` (Finviz-style,
# served from the precomputed `screener_snapshot` table).
