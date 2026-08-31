"""Finviz-style fundamental screener.

Builds one per-security **snapshot** DataFrame (latest valuation + trailing fundamentals +
growth + ratios), then the page filters/sorts it in pandas. The snapshot is ~17k rows, so
slicing it is instant; the only cost is building it, which we cache (keyed on the latest
`daily` date) so repeated filtering doesn't re-query.

Sources, all by **permaticker**:
- `daily`  — latest market valuation (mktcap, EV, PE, PS, PB, EV/EBITDA).
- `sf1` ART — trailing-twelve-month levels, margins, returns, balance-sheet ratios, plus a
  4-quarter lag for TTM YoY growth.
- `sf1` ARQ — most-recent quarter + 4-quarter lag for quarter-over-quarter YoY growth.
- `sf1` ARY — annual series with 1/3/5-year lags for annual & multi-year CAGR growth.
- `sf3a` — institutional (13F) holder count.

Forward-looking Finviz filters (Forward P/E, PEG, next-year / next-5yr EPS growth, earnings
surprise) require analyst estimates, which the Sharadar Core bundle does not include — they
are deliberately omitted rather than faked (data-fidelity: no false positives).
"""
from __future__ import annotations

import threading
import time
from datetime import timedelta

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.backend import screens
from core.backend.db.engine import engine
from core.backend.queries.securities import health
from core.backend.queries._common import query_df, scalar
from core.backend.queries._rebuild import LOCK_SCREENER, NEW, live_count, single_flight, swap_in

# The snapshot is **precomputed** into a Postgres table (`screener_snapshot`) so the page
# reads it instantly — building it live scans SF1's ART/ARQ/ARY panels (~10s). It is
# refreshed on data load (the loader calls `refresh_snapshot` after a DAILY load) and
# rebuilt by the builder / after a DAILY load; the in-memory cache sits on top so
# repeated filtering is free.
_TABLE = "screener_snapshot"
_CACHE: dict = {"key": None, "df": None, "ts": 0.0}
_LOCK = threading.Lock()
_TTL = 1800  # seconds — in-memory cache lifetime before re-checking the table

# Optional sector/industry exclusions shared by the screener UI and experiments.
# Commodities = price-takers with no pricing power. Biotech/pharma = drug developers with
# binary trial/FDA outcomes and lumpy, one-off earnings (their trailing growth/margins are
# artifacts, not compounding) — distinct from real-revenue healthcare (devices, services,
# diagnostics, insurers), which we keep.
COMMODITY_SECTORS = {"Energy", "Basic Materials"}
BIOTECH_INDUSTRIES = {
    "Biotechnology",
    "Drug Manufacturers - Specialty & Generic",
    "Drug Manufacturers - General",
    "Drug Manufacturers - Major",
}


# Master row per permaticker (prefer the SEP product row).
_MASTER = """
    SELECT DISTINCT ON (permaticker) permaticker::bigint AS permaticker, ticker, name,
           sector, industry, exchange, scalemarketcap, isdelisted, firstpricedate
    FROM tickers WHERE permaticker IS NOT NULL
    ORDER BY permaticker,
        CASE "table" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 ELSE 2 END
"""


def _snapshot_sql(since) -> str:
    return f"""
    WITH d AS (
        SELECT DISTINCT ON (permaticker) permaticker, marketcap, ev, pe, ps, pb, evebitda
        FROM daily
        WHERE permaticker IS NOT NULL AND date >= :since
        ORDER BY permaticker, date DESC
    ),
    art AS (
        SELECT DISTINCT ON (permaticker) permaticker,
               revenue, cashneq, debt, fcf, opinc, ev AS ev_art, marketcap AS mc_art,
               grossmargin, netmargin, roe, roa, roic, currentratio, de,
               debtnc, equity, assetsc, inventory, liabilitiesc, payoutratio,
               divyield, eps, dps, pe AS pe_art, ps AS ps_art, pb AS pb_art,
               evebitda AS evebitda_art, eps_1y, revenue_1y,
               assets, liabilities, workingcapital, retearn, ebit
        FROM (
            SELECT permaticker, calendardate, revenue, cashneq, debt, fcf, opinc, ev,
                   marketcap, grossmargin, netmargin, roe, roa, roic, currentratio, de,
                   debtnc, equity, assetsc, inventory, liabilitiesc, payoutratio, divyield,
                   eps, dps, pe, ps, pb, evebitda,
                   assets, liabilities, workingcapital, retearn, ebit,
                   lag(eps, 4) OVER w AS eps_1y, lag(revenue, 4) OVER w AS revenue_1y
            FROM sf1 WHERE dimension = 'ART' AND permaticker IS NOT NULL
            WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
        ) z
        -- Prefer the latest row that actually has fundamentals: a blank/preliminary latest
        -- ART filing (revenue NULL) otherwise nulls every metric at once and silently drops
        -- an otherwise-healthy company. (revenue IS NULL) sorts populated rows first.
        ORDER BY permaticker, (revenue IS NULL), calendardate DESC
    ),
    mx AS (
        SELECT DISTINCT ON (permaticker) permaticker,
               price AS m_price, high52w, low52w
        FROM metrics WHERE permaticker IS NOT NULL
        ORDER BY permaticker, date DESC
    ),
    arq AS (
        SELECT DISTINCT ON (permaticker) permaticker,
               eps AS eps_q, eps_q1y, revenue AS rev_q, rev_q1y
        FROM (
            SELECT permaticker, calendardate, eps, revenue,
                   lag(eps, 4) OVER w AS eps_q1y, lag(revenue, 4) OVER w AS rev_q1y
            FROM sf1 WHERE dimension = 'ARQ' AND permaticker IS NOT NULL
            WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
        ) z ORDER BY permaticker, calendardate DESC
    ),
    ary AS (
        SELECT DISTINCT ON (permaticker) permaticker,
               eps AS eps_y, eps_y1, eps_y3, eps_y5,
               revenue AS rev_y, rev_y1, rev_y3, rev_y5,
               dps AS dps_y, dps_y3,
               shareswadil AS shares_y, shares_y5
        FROM (
            SELECT permaticker, calendardate, eps, revenue, dps, shareswadil,
                   lag(eps, 1) OVER w AS eps_y1, lag(eps, 3) OVER w AS eps_y3,
                   lag(eps, 5) OVER w AS eps_y5,
                   lag(revenue, 1) OVER w AS rev_y1, lag(revenue, 3) OVER w AS rev_y3,
                   lag(revenue, 5) OVER w AS rev_y5,
                   lag(dps, 3) OVER w AS dps_y3,
                   lag(shareswadil, 5) OVER w AS shares_y5
            FROM sf1 WHERE dimension = 'ARY' AND permaticker IS NOT NULL
            WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
        ) z
        -- Same as ART: skip a blank latest annual filing so 5y-growth inputs aren't nulled.
        ORDER BY permaticker, (revenue IS NULL), calendardate DESC
    ),
    inst AS (
        SELECT DISTINCT ON (permaticker) permaticker, shrholders, totalvalue
        FROM sf3a WHERE permaticker IS NOT NULL
        ORDER BY permaticker, calendardate DESC
    ),
    m AS ({_MASTER})
    SELECT m.permaticker, m.ticker, m.name, m.sector, m.industry, m.exchange,
           m.scalemarketcap, m.isdelisted, m.firstpricedate,
           -- daily.marketcap / daily.ev are in USD *millions*; SF1 figures are absolute
           -- USD. Normalise daily to absolute so every ratio shares one unit.
           COALESCE(d.marketcap * 1e6, art.mc_art) AS marketcap,
           COALESCE(d.ev * 1e6, art.ev_art) AS ev,
           COALESCE(d.pe, art.pe_art) AS pe,
           COALESCE(d.ps, art.ps_art) AS ps,
           COALESCE(d.pb, art.pb_art) AS pb,
           COALESCE(d.evebitda, art.evebitda_art) AS ev_ebitda,
           art.revenue, art.cashneq, art.debt, art.fcf, art.opinc,
           art.assets, art.liabilities, art.workingcapital, art.retearn, art.ebit,
           art.grossmargin, art.netmargin, art.roe, art.roa, art.roic,
           art.currentratio, art.de, art.debtnc, art.equity, art.assetsc, art.inventory,
           art.liabilitiesc, art.payoutratio, art.divyield, art.eps, art.dps,
           art.eps_1y, art.revenue_1y,
           arq.eps_q, arq.eps_q1y, arq.rev_q, arq.rev_q1y,
           ary.eps_y, ary.eps_y1, ary.eps_y3, ary.eps_y5,
           ary.rev_y, ary.rev_y1, ary.rev_y3, ary.rev_y5, ary.dps_y, ary.dps_y3,
           ary.shares_y, ary.shares_y5,
           inst.shrholders AS inst_holders,
           mx.m_price, mx.high52w, mx.low52w
    FROM m
    LEFT JOIN d   ON d.permaticker   = m.permaticker
    LEFT JOIN art ON art.permaticker = m.permaticker
    LEFT JOIN arq ON arq.permaticker = m.permaticker
    LEFT JOIN ary ON ary.permaticker = m.permaticker
    LEFT JOIN inst ON inst.permaticker = m.permaticker
    LEFT JOIN mx ON mx.permaticker = m.permaticker
    WHERE d.permaticker IS NOT NULL OR art.permaticker IS NOT NULL
    """


def _pct_growth(cur, prev):
    """YoY % growth, NaN unless prev is a positive base (avoids sign-flip nonsense)."""
    out = (cur - prev) / prev.abs()
    return out.where(prev > 0)


def _cagr(cur, base, years):
    out = np.where((cur > 0) & (base > 0), (cur / base) ** (1.0 / years) - 1.0, np.nan)
    return pd.Series(out, index=cur.index)


def _derive(df: pd.DataFrame) -> pd.DataFrame:
    """Add the Finviz-style derived columns the UI filters on."""
    d = df
    d["p_cash"] = (d["marketcap"] / d["cashneq"]).where(d["cashneq"] > 0)
    d["p_fcf"] = (d["marketcap"] / d["fcf"]).where(d["fcf"] > 0)
    d["ev_sales"] = (d["ev"] / d["revenue"]).where(d["revenue"] > 0)
    d["oper_margin"] = (d["opinc"] / d["revenue"]).where(d["revenue"] > 0)
    d["quick_ratio"] = ((d["assetsc"] - d["inventory"]) / d["liabilitiesc"]).where(
        d["liabilitiesc"] > 0)
    d["ltde"] = (d["debtnc"] / d["equity"]).where(d["equity"] > 0)
    # net cash (cash minus total debt) as a fraction of market cap — Burry-style asset
    # plays where the balance sheet alone is worth much of the price (>1 = net cash > mktcap)
    d["net_cash"] = d["cashneq"] - d["debt"]
    d["net_cash_pct"] = (d["net_cash"] / d["marketcap"]).where(d["marketcap"] > 0)
    # Altman Z-score (bankruptcy distance) — the survivability gate. TTM flows from
    # ART; X4 uses the live market cap. >2.99 safe · 1.81–2.99 grey · <1.81 distress.
    d["altman_z"] = health.altman_z(
        d["workingcapital"], d["retearn"], d["ebit"], d["marketcap"],
        d["liabilities"], d["assets"], d["revenue"])
    # how out-of-favor by price: distance above the 52-week low / below the 52-week high
    d["pct_above_low"] = ((d["m_price"] - d["low52w"]) / d["low52w"]).where(d["low52w"] > 0)
    d["pct_below_high"] = ((d["high52w"] - d["m_price"]) / d["high52w"]).where(
        d["high52w"] > 0)
    # company age — years since first trade (proxy for "been in business a long time")
    fpd = pd.to_datetime(d["firstpricedate"], errors="coerce")
    d["years_public"] = (pd.Timestamp.now() - fpd).dt.days / 365.25
    # capital-allocation signal: 5y change in diluted share count. Negative = net buybacks
    # (the CAT/quality-compounder tell); positive = dilution. Annualised for readability.
    ratio = (d["shares_y"] / d["shares_y5"]).where(d["shares_y5"] > 0)
    d["shares_cagr_5y"] = ratio ** (1.0 / 5.0) - 1.0
    # growth
    d["eps_g_ttm"] = _pct_growth(d["eps"], d["eps_1y"])
    d["sales_g_ttm"] = _pct_growth(d["revenue"], d["revenue_1y"])
    d["eps_g_qoq"] = _pct_growth(d["eps_q"], d["eps_q1y"])
    d["sales_g_qoq"] = _pct_growth(d["rev_q"], d["rev_q1y"])
    d["eps_g_yr"] = _pct_growth(d["eps_y"], d["eps_y1"])
    d["sales_g_yr"] = _pct_growth(d["rev_y"], d["rev_y1"])
    d["eps_g_3y"] = _cagr(d["eps_y"], d["eps_y3"], 3)
    d["eps_g_5y"] = _cagr(d["eps_y"], d["eps_y5"], 5)
    d["sales_g_3y"] = _cagr(d["rev_y"], d["rev_y3"], 3)
    d["sales_g_5y"] = _cagr(d["rev_y"], d["rev_y5"], 5)
    d["div_growth"] = _cagr(d["dps_y"], d["dps_y3"], 3)
    # tidy renames to the UI's metric ids
    d = d.rename(columns={
        "grossmargin": "gross_margin", "netmargin": "net_margin",
        "currentratio": "current_ratio", "de": "debt_equity",
        "payoutratio": "payout", "divyield": "div_yield",
        "roe": "roe", "roa": "roa", "roic": "roic",
    })
    return d


def build_snapshot(session: Session) -> pd.DataFrame:
    """Compute the snapshot live from SF1/DAILY/SF3A (the ~10s heavy path)."""
    max_date = scalar(session, "SELECT max(date) FROM daily")
    since = (max_date - timedelta(days=14)) if max_date else None
    raw = query_df(session, _snapshot_sql(since), {"since": since})
    return _derive(raw)


def _max_daily_date(session: Session):
    return scalar(session, "SELECT max(date) FROM daily")


def refresh_snapshot(session: Session) -> int:
    """Build the snapshot and **persist** it to the `screener_snapshot` table (tagged with
    the `daily` as-of date). Idempotent — safe to call after every load. Returns row count.

    Single-flight + atomic swap: only one process rebuilds at a time (others skip and keep
    serving the live table); the build goes into `…__new` and is swapped in with a brief
    metadata lock, so readers never block on the multi-second build (no DROP-convoy)."""
    max_date = _max_daily_date(session)
    with single_flight(LOCK_SCREENER) as mine:
        if not mine:  # another worker is rebuilding — don't stampede
            return live_count(_TABLE)
        df = build_snapshot(session).copy()
        df["asof"] = max_date
        df.to_sql(f"{_TABLE}{NEW}", engine, if_exists="replace", index=False)
        with engine.begin() as conn:
            conn.execute(text(f"CREATE INDEX ix_{_TABLE}_permaticker{NEW} "
                              f"ON {_TABLE}{NEW} (permaticker)"))
            swap_in(conn, _TABLE,
                    ((f"ix_{_TABLE}_permaticker{NEW}", f"ix_{_TABLE}_permaticker"),))
        with _LOCK:
            _CACHE.update(key=str(max_date), df=df, ts=time.time())
        return len(df)


def _read_table(session: Session) -> tuple[object, pd.DataFrame]:
    asof = scalar(session, f"SELECT asof FROM {_TABLE} LIMIT 1")
    df = query_df(session, f"SELECT * FROM {_TABLE}")
    return asof, df


def snapshot(session: Session) -> pd.DataFrame:
    """Return the per-security metrics snapshot — served from the precomputed table when
    current, falling back to a live build (which it then persists) if the table is missing
    or stale. An in-memory cache fronts both."""
    key = str(_max_daily_date(session))
    with _LOCK:
        if (_CACHE["df"] is not None and _CACHE["key"] == key
                and (time.time() - _CACHE["ts"]) < _TTL):
            return _CACHE["df"]
    # Precomputed table, if it matches the current as-of date.
    try:
        asof, df = _read_table(session)
        if str(asof) == key:
            with _LOCK:
                _CACHE.update(key=key, df=df, ts=time.time())
            return df
    except Exception:
        pass  # table absent — fall through to build
    # Stale / missing → build live and persist for next time. If persistence fails
    # (e.g. read-only DB) still serve the freshly built frame.
    try:
        refresh_snapshot(session)
        with _LOCK:
            return _CACHE["df"]
    except Exception:
        df = build_snapshot(session)
        with _LOCK:
            _CACHE.update(key=key, df=df, ts=time.time())
        return df


def screen_candidates(
    df: pd.DataFrame, drop_delisted: bool = True, spec: dict | None = None
) -> pd.DataFrame:
    """Apply a screen spec to the snapshot and return the surviving rows.

    The spec is **data, not code** — a YAML file in `config/screens/` (see
    `core.backend.screens`), so the filter is the user's to define and the live screen and
    the CLI provably run the same definition. Defaults to the active screen
    (`ACTIVE_SCREEN` in core/.env).

    `drop_delisted=False` skips the `isdelisted != 'Y'` gate — used by the point-in-time
    backtest (`backtest.run_screen_asof`), where `isdelisted` is *today's* flag (wrong for a
    historical as-of) and survivorship is handled instead by only including names trading then."""
    return screens.apply_screen(
        df, spec or screens.active_screen(), drop_delisted=drop_delisted
    )
