"""FINRA Consolidated Equity Short Interest — per-security read views.

The base mirror (`finra_short_interest`) stores FINRA's as-filed fields verbatim;
`finra_short_interest_resolved` adds a point-in-time `permaticker`. This module is
the read layer the Company page uses: a per-security bi-monthly time series with
short-%-of-shares-outstanding computed here (never stored).

Critical split adjustment (same issue as 13F `shrunits`, see `institutional.py`):
FINRA `current_short` is **as-filed (split-unadjusted)** while `sf1.sharesbas` is
**retroactively split-adjusted**. Dividing them directly understates short interest
before any split (GME reads ~22% pre-2022 4:1 split vs. the real ~88%). So we restate
the short count onto the split-adjusted basis — multiply by the cumulative factor of
all splits *after* each settlement date (from `actions`) — before taking the ratio.
This is % of *shares outstanding*, not true free float (Sharadar can't give float).
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df


def short_interest_timeseries(session: Session, permaticker: int | str) -> pd.DataFrame:
    """Bi-monthly short-interest series for one security (via the resolved view).

    Returns: settlementdate, market, current_short, previous_short, change_pct,
    avg_daily_vol, days_to_cover, sharesbas, split_factor, adj_short,
    short_pct_shares. Empty if the security has no resolved FINRA rows (e.g. an
    OTC name outside Sharadar's universe, or no short interest reported).
    """
    pt = int(permaticker)
    # Resolve permaticker -> rows the *fast* way, in two steps. Filtering the
    # resolved view by permaticker is O(table): its per-row LATERAL resolves every
    # one of the 3.8M rows before the filter applies. And an EXISTS join lets the
    # planner pick a full seq-scan of the short-interest table. So instead: (1) get
    # this issuer's ticker symbol(s) + active date window from the tiny `tickers`
    # table, then (2) index-scan `finra_short_interest` by an explicit symbol list,
    # and (3) apply the point-in-time window in pandas (a row counts only if the
    # symbol belonged to this permaticker on that settlement date — handles recycled
    # tickers). One issuer can have several historical symbols, each with its own
    # window; collapse to one [first, last] span per symbol.
    windows = query_df(
        session,
        "SELECT ticker, min(firstpricedate) AS first, "
        "       max(COALESCE(lastpricedate, CURRENT_DATE)) AS last "
        "FROM tickers WHERE permaticker::bigint = :pt "
        "AND ticker IS NOT NULL GROUP BY ticker",
        {"pt": pt},
    )
    if windows.empty:
        return pd.DataFrame()
    symbols = windows["ticker"].tolist()

    df = query_df(
        session,
        """
        SELECT si.symbol, si.settlementdate, si.market, si.current_short,
               si.previous_short, si.change_pct, si.avg_daily_vol, si.days_to_cover,
               (SELECT f.sharesbas FROM sf1 f
                WHERE f.permaticker = :pt AND f.dimension = 'ARQ'
                  AND f.sharesbas IS NOT NULL AND f.datekey <= si.settlementdate
                ORDER BY f.datekey DESC LIMIT 1) AS sharesbas
        FROM finra_short_interest si
        WHERE si.symbol = ANY(:syms)
        ORDER BY si.settlementdate
        """,
        {"pt": pt, "syms": symbols},
    )
    if df.empty:
        return df

    # point-in-time window filter: keep a row only if its settlement date falls in
    # the [first, last] span this permaticker held that symbol.
    span = {r["ticker"]: (pd.Timestamp(r["first"]), pd.Timestamp(r["last"]))
            for _, r in windows.iterrows()}
    sd = pd.to_datetime(df["settlementdate"])
    lo = df["symbol"].map(lambda t: span[t][0])
    hi = df["symbol"].map(lambda t: span[t][1])
    df = df[(sd >= lo.values) & (sd <= hi.values)].reset_index(drop=True)
    if df.empty:
        return df

    splits = query_df(
        session,
        "SELECT date, value FROM actions "
        "WHERE permaticker = :pt AND action ILIKE '%split%' AND value > 0",
        {"pt": pt},
    )
    sd = pd.to_datetime(df["settlementdate"])
    if splits.empty:
        df["split_factor"] = 1.0
    else:
        sdate = pd.to_datetime(splits["date"])
        sval = splits["value"].astype(float)
        # factor(d) = product of split ratios whose split date is after settlement d
        df["split_factor"] = [
            float(sval[sdate > d].prod()) if (sdate > d).any() else 1.0 for d in sd
        ]
    df["adj_short"] = df["current_short"] * df["split_factor"]
    df["short_pct_shares"] = (df["adj_short"] / df["sharesbas"] * 100).where(
        df["sharesbas"] > 0)
    return df
