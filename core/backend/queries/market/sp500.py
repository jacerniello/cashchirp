"""S&P 500 index concentration & sector composition, over time.

Two small precomputed tables drive the `/sp500` page, both derived from the
`sp500` membership log + `daily` market caps + `tickers` sectors:

- ``sp500_concentration`` — one row per index snapshot date (quarter-ends from
  the SP500 **historical** action, plus the latest **current** snapshot) with the
  headline concentration measures: the cap-weight of the top 1/3/5/10/25/50
  constituents, the Herfindahl-Hirschman Index (HHI), and the *effective number
  of constituents* (1/Σwᵢ², the count of equal-weight names the index "acts
  like"). This is the "how top-heavy is the index" series — today's ~38% top-10
  weight vs. ~18% a decade ago.
- ``sp500_sector_weights`` — one row per ``(date, sector)`` with that GICS-style
  sector's cap-weight and constituent count at each snapshot, so the page can
  show how the index's sector mix has rotated (e.g. Technology's rise).

**Point-in-time by construction.** Membership is taken from the SP500 log as it
stood at each snapshot date (never today's members projected backwards), and each
constituent's market cap is its `daily.marketcap` as of that date (latest close in
a 10-day lookback to clear holidays). Weights are cap-weighted on **full** market
cap — Sharadar carries no float, so this is full-cap weighting, a close but not
exact proxy for the float-adjusted weights S&P actually uses (documented, not
faked: see the data-fidelity standard).

Built by ``python -m core.setup.bootstrap --dataset derived:sp500_concentration`` (and the
`update_all` orchestrator). Pure caches — drop and rebuild freely, never hand-edit.
Nothing rebuilds them at app startup; refresh them through the builder above.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.backend.db.engine import engine
from core.backend.queries._common import query_df, scalar
from core.backend.queries._rebuild import (
    LOCK_SP500_CONCENTRATION,
    NEW,
    live_count,
    single_flight,
    swap_in,
)

_CONC_TABLE = "sp500_concentration"
_SECTOR_TABLE = "sp500_sector_weights"

# Top-N cohorts reported on the concentration series.
_TOP_NS = (1, 3, 5, 10, 25, 50)

# Per-security market cap as of one snapshot date: the latest `daily` close in a
# 10-day lookback (clears weekends/holidays so a quarter-end on a market holiday
# still resolves). `ix_daily_date` makes the bounded-window scan cheap; one query
# per snapshot date (~113) keeps the planner on the index instead of a 39M-row join.
_CAPS_AT = """
    WITH members AS (
        SELECT permaticker FROM sp500
        WHERE action = :action AND date = CAST(:d AS date)
    )
    SELECT DISTINCT ON (d.permaticker)
           d.permaticker, d.marketcap
    FROM daily d
    JOIN members m ON m.permaticker = d.permaticker
    WHERE d.date BETWEEN CAST(:d AS date) - 10 AND CAST(:d AS date)
      AND d.marketcap > 0
    ORDER BY d.permaticker, d.date DESC
"""

# Stable per-permaticker reference (sector, ticker, name), preferring the SEP row —
# mirrors the screener's `_MASTER` so sectors match the rest of the app.
_REF = """
    SELECT DISTINCT ON (permaticker) permaticker::bigint AS permaticker,
           ticker, name, COALESCE(sector, 'Unknown') AS sector
    FROM tickers WHERE permaticker IS NOT NULL
    ORDER BY permaticker,
        CASE "table" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 ELSE 2 END
"""


def _membership_asof(session: Session):
    """The latest membership date driving the build (its freshness watermark)."""
    return scalar(session, "SELECT max(date) FROM sp500 WHERE action IN ('historical','current')")


def _build_frames(session: Session, asof) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Compute the concentration + sector-weight frames in pandas.

    One light SQL per snapshot date (membership × market cap), assembled into a
    long frame, then grouped to the two output tables. Cheap (~57k rows total)."""
    ref = query_df(session, _REF).set_index("permaticker")

    # Snapshot dates: every historical quarter-end, plus the single latest current
    # snapshot so the series runs right up to the most recent membership.
    hist_dates = [
        r[0] for r in session.execute(
            text("SELECT DISTINCT date FROM sp500 WHERE action='historical' ORDER BY date")
        )
    ]
    cur_date = scalar(session, "SELECT max(date) FROM sp500 WHERE action='current'")
    plan = [(d, "historical") for d in hist_dates]
    if cur_date is not None and cur_date not in set(hist_dates):
        plan.append((cur_date, "current"))

    conc_rows: list[dict] = []
    sector_rows: list[dict] = []
    for d, action in plan:
        caps = query_df(session, _CAPS_AT, {"d": str(d), "action": action})
        if caps.empty:
            continue
        caps = caps.join(ref, on="permaticker")
        total = float(caps["marketcap"].sum())
        if total <= 0:
            continue
        caps = caps.sort_values("marketcap", ascending=False).reset_index(drop=True)
        weights = caps["marketcap"] / total          # fractional index weights
        hhi = float((weights ** 2).sum())            # 0..1 (×10000 for the classic scale)

        row: dict = {
            "date": d,
            "n_constituents": int(len(caps)),
            "total_mktcap": total,                   # USD millions (daily.marketcap unit)
            "hhi": hhi * 10_000.0,                   # classic HHI points
            "effective_n": (1.0 / hhi) if hhi > 0 else np.nan,
            "top1_ticker": caps.at[0, "ticker"],
            "top1_name": caps.at[0, "name"],
        }
        for n in _TOP_NS:
            row[f"top{n}_weight"] = float(weights.iloc[:n].sum()) * 100.0  # percent
        conc_rows.append(row)

        by_sector = caps.groupby("sector")["marketcap"].agg(["sum", "count"])
        for sector, srow in by_sector.iterrows():
            sector_rows.append({
                "date": d,
                "sector": sector,
                "weight": float(srow["sum"]) / total * 100.0,
                "n": int(srow["count"]),
                "mktcap": float(srow["sum"]),
            })

    conc = pd.DataFrame(conc_rows)
    sectors = pd.DataFrame(sector_rows)
    conc["asof"] = asof
    sectors["asof"] = asof
    return conc, sectors


def refresh_concentration(session: Session) -> int:
    """Rebuild both `sp500_concentration` and `sp500_sector_weights`; return the
    concentration row count. Idempotent — safe after every SP500/DAILY load.

    Single-flight + atomic swap (like the other derived tables): one process builds
    into `…__new` off the live tables, then swaps both in under brief metadata locks
    so readers never block. The frames are tiny, so the whole build is ~45s (one
    bounded `daily` scan per snapshot date)."""
    asof = _membership_asof(session)
    with single_flight(LOCK_SP500_CONCENTRATION) as mine:
        if not mine:  # another worker is rebuilding — don't stampede
            return live_count(_CONC_TABLE)
        conc, sectors = _build_frames(session, asof)
        conc.to_sql(f"{_CONC_TABLE}{NEW}", engine, if_exists="replace", index=False)
        sectors.to_sql(f"{_SECTOR_TABLE}{NEW}", engine, if_exists="replace", index=False)
        with engine.begin() as conn:
            conn.execute(text(f"CREATE INDEX ix_{_SECTOR_TABLE}_date{NEW} "
                              f"ON {_SECTOR_TABLE}{NEW} (date)"))
            swap_in(conn, _CONC_TABLE)
            swap_in(conn, _SECTOR_TABLE,
                    ((f"ix_{_SECTOR_TABLE}_date{NEW}", f"ix_{_SECTOR_TABLE}_date"),))
        return len(conc)


# --- read side -------------------------------------------------------------

def concentration(session: Session) -> pd.DataFrame:
    """The full concentration time series (one row per snapshot date), oldest first."""
    return query_df(session, f"SELECT * FROM {_CONC_TABLE} ORDER BY date")


def sector_weights(session: Session) -> pd.DataFrame:
    """The full sector-weight time series (one row per date × sector), oldest first."""
    return query_df(session, f"SELECT * FROM {_SECTOR_TABLE} ORDER BY date, sector")


def latest_constituents(session: Session, limit: int = 25) -> pd.DataFrame:
    """The largest current constituents with their index cap-weight, for the page's
    'who's on top now' table. Reads the latest snapshot's caps directly (cheap)."""
    d = scalar(session, f"SELECT max(date) FROM {_CONC_TABLE}")
    if d is None:
        return pd.DataFrame()
    action = scalar(
        session,
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM sp500 WHERE action='current' AND date=:d)"
        " THEN 'current' ELSE 'historical' END",
        {"d": d},
    )
    caps = query_df(session, _CAPS_AT, {"d": str(d), "action": action})
    if caps.empty:
        return caps
    ref = query_df(session, _REF).set_index("permaticker")
    caps = caps.join(ref, on="permaticker")
    total = float(caps["marketcap"].sum())
    caps = caps.sort_values("marketcap", ascending=False).reset_index(drop=True)
    caps["weight"] = caps["marketcap"] / total * 100.0
    caps["rank"] = caps.index + 1
    return caps.head(limit)[["rank", "permaticker", "ticker", "name", "sector",
                             "marketcap", "weight"]]
