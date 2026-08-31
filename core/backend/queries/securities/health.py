"""Financial-health metrics — Altman Z-score (distance to bankruptcy).

The classic Altman (1968) Z-score for public manufacturers:

    Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5
      X1 = working capital / total assets        (liquidity)
      X2 = retained earnings / total assets      (cumulative profitability / age)
      X3 = EBIT / total assets                   (operating productivity)
      X4 = market value of equity / total liabs  (solvency cushion)
      X5 = revenue / total assets                (asset turnover)

Zones: **> 2.99 safe · 1.81–2.99 grey · < 1.81 distress.**

This operationalises DFV's "does it survive?" gate (see
a deep-value screen): the fundamental half of the
heavily-shorted-but-survivable setup the short-interest data flags. It is a crude
proxy, **not** credit analysis — it can't see refinancing walls, covenant breaches
or who holds the paper (that needs the bond-yield/ratings feed we don't have).

Two correctness rules:
- **Flows must be trailing-twelve-month** (Sharadar `ART`/`ARY`), never a single
  quarter, or X3/X5 understate ~4×.
- **Calibrated for non-financial manufacturers.** Banks/insurers/REITs need other
  variants, so callers exclude or flag financials (the screener already does).
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df


def altman_z(
    working_capital, retained_earnings, ebit, market_value_equity,
    total_liabilities, total_assets, revenue,
) -> pd.Series:
    """Vectorised Altman Z-score. Inputs are pandas Series (aligned). NaN where a
    denominator is non-positive — propagates to Z, so junk rows drop out rather
    than producing a misleading number.

    A missing **numerator** component (commonly `retained_earnings`, which Sharadar
    leaves blank for many non-US / long-listed issuers) is floored to
    0 rather than voiding the whole score: otherwise a single blank field silently
    drops an otherwise-healthy company from screens (a false negative). Flooring is
    conservative — a zeroed term only *lowers* Z, so it can never manufacture a false
    "safe". The ta/tl denominator guard still gates genuinely empty rows to NaN."""
    ta = total_assets.where(total_assets > 0)
    tl = total_liabilities.where(total_liabilities > 0)
    x1 = working_capital.fillna(0) / ta
    x2 = retained_earnings.fillna(0) / ta
    x3 = ebit.fillna(0) / ta
    x4 = market_value_equity.fillna(0) / tl
    x5 = revenue.fillna(0) / ta
    return 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5


def z_zone(z) -> str:
    """Label a Z-score: Safe / Grey / Distress (or — when unknown)."""
    if z is None or pd.isna(z):
        return "—"
    if z >= 2.99:
        return "Safe"
    if z >= 1.81:
        return "Grey"
    return "Distress"


def altman_z_timeseries(session: Session, permaticker: int | str) -> pd.DataFrame:
    """Per-period Altman Z over time from `sf1` ART (TTM flows + point-in-time
    balance sheet). Returns calendardate + the Z components + altman_z. Empty if
    the security has no usable ART fundamentals."""
    df = query_df(
        session,
        """
        SELECT calendardate, workingcapital, retearn, ebit, marketcap,
               liabilities, assets, revenue
        FROM sf1
        WHERE permaticker = :pt AND dimension = 'ART' AND assets > 0
        ORDER BY calendardate
        """,
        {"pt": int(permaticker)},
    )
    if df.empty:
        return df
    df["altman_z"] = altman_z(
        df["workingcapital"], df["retearn"], df["ebit"], df["marketcap"],
        df["liabilities"], df["assets"], df["revenue"],
    )
    return df.dropna(subset=["altman_z"]).reset_index(drop=True)
