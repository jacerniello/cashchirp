"""Point-in-time study panel — every live security at each yearly rebalance date, with what
a screen could have seen then and what happened next.

One row per (q, permaticker) alive at q (the harness's survivorship-free universe):

  * every `screener_snapshot` column, computed by `harness.build_panel` — so a gate
    evaluated on this panel sees exactly the value the backtest (and the screen) saw;
  * candidate signals the snapshot does not carry (`EXTRA_SIGNALS`): yields, margin and
    ROIC trends, accruals, cash conversion, interest cover, 1y dilution, growth
    acceleration, momentum / volatility from `sep`, and insider buying from `sf2` — each
    computed from data public on or before q;
  * the tradability flags the backtest applies at entry (fresh print, price ≥ $3,
    ADV ≥ $1M), and forward 12- and 24-month total returns from the entry series chosen
    by `harness.pick` (one ticker series per name, followed to the exit; a name that stops
    trading is valued at its last print, with `stopped_<h>` set).

Labels (winner / loser) are NOT stored: the primary ones are relative to a screen's
universe on each date, so `study.py` derives them for whichever universe it is studying.

The panel is cached to `core/data/panels/<key>.parquet` (gitignored) — it reads a year of
`sep` per date and takes several minutes to build, and every study reuses it. The cache key
covers the grid and a version number; bump `PANEL_VERSION` when the columns change.

Coverage limits that are properties of the data, not the code: `sf2` (insiders) starts in
2008, so insider signals are blank before 2009; `sf3a` (13F) starts mid-2013 and FINRA
short interest at end-2017, so neither exists in the 2003–2012 discovery period and they
are not panel signals.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from core.backend.backtest import harness
from core.backend.queries._common import query_df
from core.config import CORE_DIR

Say = Callable[[str], None]

PANEL_VERSION = 1
PANEL_DIR = CORE_DIR / "data" / "panels"

# The study protocol: signals and thresholds are chosen on DISCOVERY only; HOLDOUT is
# evaluated once, at the end. The gap keeps discovery's 24-month forward windows (which end
# by 2014) from overlapping the first holdout window.
DISCOVERY = (date(2003, 1, 1), date(2012, 1, 1))
GAP = (date(2013, 1, 1), date(2014, 1, 1))
HOLDOUT = (date(2015, 1, 1), date(2022, 1, 1))
HORIZONS = (12, 24)
INSIDER_START = date(2009, 1, 1)     # first q with a full 12-month sf2 look-back


def default_grid() -> list[date]:
    """Yearly, 1 January 2003 … 2022 — discovery, gap and holdout together."""
    return [date(y, 1, 1) for y in range(DISCOVERY[0].year, HOLDOUT[1].year + 1)]


def period_of(q: date) -> str:
    if DISCOVERY[0] <= q <= DISCOVERY[1]:
        return "discovery"
    if HOLDOUT[0] <= q <= HOLDOUT[1]:
        return "holdout"
    return "gap"


# Snapshot columns a study needs that harness.build_panel only fetches when a screen gates
# on them. Asking for them here makes the panel carry the full snapshot.
_FORCE = {"gates": {"pct_below_high": {"max": 1}, "inst_holders": {"min": 0}}}

# --------------------------------------------------------------------------- fundamentals

_X_ART_COLS = ("revenue, netinc AS netinc_x, ncfo AS ncfo_x, intexp AS intexp_x, "
               "sharesbas AS sharesbas_x, assets AS assets_x")
_X_ART_LAGS = ("lag(netmargin, 4) OVER c AS net_margin_1y, "
               "lag(netmargin, 12) OVER c AS net_margin_3y, "
               "lag(grossmargin, 4) OVER c AS gross_margin_1y, "
               "lag(roic, 4) OVER c AS roic_1y, lag(roic, 12) OVER c AS roic_3y, "
               "lag(sharesbas, 4) OVER c AS sharesbas_1y")


def _extra_fundamentals(session: Session, grid: list[date]) -> pd.DataFrame:
    """Extra ART fields and lags, from the SAME row `build_panel` picks (same ordering)."""
    df = harness._fundamentals(session, "ART", _X_ART_COLS, _X_ART_LAGS, grid)
    df["q"] = pd.to_datetime(df["q"]).dt.date
    return df.drop(columns=["revenue"], errors="ignore")


# --------------------------------------------------------------------------- prices


def _price_stats(session: Session, q: date) -> pd.DataFrame:
    """Per (permaticker, ticker) over the year to q: closeadj now, ~1, ~6 and ~12 months
    ago (last print on/before each), and annualised daily log-return volatility. Aggregated
    in Postgres over the date-indexed window — one row per series comes back."""
    df = query_df(session, """
        WITH s AS (
            SELECT permaticker, ticker, date, closeadj,
                   ln(closeadj / lag(closeadj) OVER (PARTITION BY permaticker, ticker
                                                     ORDER BY date)) AS lr
            FROM sep
            WHERE date > :lo AND date <= :hi AND permaticker IS NOT NULL AND closeadj > 0
        )
        SELECT permaticker, ticker, count(*) AS n, max(date) AS px_date,
               (array_agg(closeadj ORDER BY date DESC))[1] AS p0,
               (array_agg(closeadj ORDER BY date DESC) FILTER (WHERE date <= :m1))[1] AS p1,
               (array_agg(closeadj ORDER BY date DESC) FILTER (WHERE date <= :m6))[1] AS p6,
               (array_agg(closeadj ORDER BY date DESC) FILTER (WHERE date <= :m12))[1] AS p12,
               stddev_samp(lr) FILTER (WHERE date > :m12) AS sd,
               count(lr) FILTER (WHERE date > :m12) AS n_lr
        FROM s GROUP BY permaticker, ticker
    """, {"lo": q - timedelta(days=400), "hi": q, "m1": q - timedelta(days=30),
          "m6": q - timedelta(days=182), "m12": q - timedelta(days=365)})
    if df.empty:
        return df
    df["px_date"] = pd.to_datetime(df["px_date"]).dt.date
    # A gap of more than ~3 weeks around a reference date means that reference print is
    # stale; the window's own boundaries already cap how stale it can be.
    df["mom_12_1"] = df["p1"] / df["p12"] - 1
    df["mom_6"] = df["p0"] / df["p6"] - 1
    df["mom_1"] = df["p0"] / df["p1"] - 1
    df["vol_1y"] = (df["sd"] * math.sqrt(252)).where(df["n_lr"] >= 150)
    return df


def _insiders(session: Session, grid: list[date]) -> pd.DataFrame:
    """Open-market insider trades (Form 4/5, code P = purchase, S = sale, non-derivative
    only — awards, option exercises, tax withholding and gifts excluded) FILED in the
    12 months before each q. Restated forms are skipped so an amendment is not counted
    twice. Dates before INSIDER_START are not covered by sf2 and come back absent."""
    qs = [q for q in grid if q >= INSIDER_START]
    if not qs:
        return pd.DataFrame(columns=["q", "permaticker", "ins_buy_val", "ins_sell_val",
                                     "ins_buyers", "ins_sellers"]).astype(
            {"permaticker": "int64", "ins_buy_val": float, "ins_sell_val": float,
             "ins_buyers": float, "ins_sellers": float})
    df = query_df(session, """
        WITH g AS (SELECT unnest(CAST(:g AS date[])) AS q),
        t AS MATERIALIZED (
            SELECT permaticker, filingdate, ownername, transactioncode,
                   coalesce(transactionvalue,
                            transactionshares * transactionpricepershare) AS val
            FROM sf2
            WHERE transactioncode IN ('P', 'S') AND securityadcode IN ('NA', 'ND')
              AND formtype IN ('4', '5') AND permaticker IS NOT NULL
              AND filingdate > CAST(:lo AS date) AND filingdate <= CAST(:hi AS date)
        )
        SELECT g.q, t.permaticker,
               sum(val) FILTER (WHERE transactioncode = 'P') AS ins_buy_val,
               sum(val) FILTER (WHERE transactioncode = 'S') AS ins_sell_val,
               count(DISTINCT ownername) FILTER (WHERE transactioncode = 'P') AS ins_buyers,
               count(DISTINCT ownername) FILTER (WHERE transactioncode = 'S') AS ins_sellers
        FROM g JOIN t ON t.filingdate <= g.q AND t.filingdate > g.q - 365
        GROUP BY g.q, t.permaticker
    """, {"g": qs, "lo": min(qs) - timedelta(days=366), "hi": max(qs)})
    df["q"] = pd.to_datetime(df["q"]).dt.date
    return df


# --------------------------------------------------------------------------- forward


def _forward(session: Session, q: date, trad: pd.DataFrame,
             pws: dict[date, pd.DataFrame]) -> pd.DataFrame:
    """Forward 12m / 24m total return for every name tradable at q, on its chosen series."""
    out = pd.DataFrame(index=trad.index)
    out.index.name = "permaticker"
    ids = [int(x) for x in trad.index]
    for h in HORIZONS:
        end = (pd.Timestamp(q) + pd.DateOffset(months=h)).date()
        if end not in pws:
            continue
        ex = harness._exit_prices(session, ids, trad["ticker"], q, end, pws[end])
        px = ex["px"].reindex(trad.index)
        out[f"fwd_{h}m"] = px / trad["px"] - 1
        xd = ex["px_date"].reindex(trad.index)
        # 1.0 / 0.0, NaN where there is no exit print (float so it survives parquet)
        out[f"stopped_{h}m"] = xd.map(
            lambda d, e=end: np.nan if d is None or pd.isna(d)
            else float(d < e - timedelta(days=harness.TRADABLE_WINDOW_DAYS)))
        out[f"exit_date_{h}m"] = xd
    return out


# --------------------------------------------------------------------------- derived


def _derive_extra(d: pd.DataFrame) -> pd.DataFrame:
    """Candidate signals from the joined panel. Ratios are NaN where the base is not
    meaningful (non-positive denominator) rather than sign-flipped nonsense."""
    mc = d["marketcap"].where(d["marketcap"] > 0)
    # Valuation as YIELDS (higher = cheaper) so a loss-maker sorts as expensive instead of
    # vanishing or looking like the cheapest name (a negative P/E).
    d["earnings_yield"] = 1.0 / d["pe"].where(d["pe"] != 0)
    d["fcf_yield"] = d["fcf"] / mc
    d["ebitda_ev"] = 1.0 / d["ev_ebitda"].where(d["ev_ebitda"] != 0)
    d["book_to_price"] = 1.0 / d["pb"].where(d["pb"] != 0)
    d["sales_ev"] = (d["revenue"] / d["ev"]).where(d["ev"] > 0)
    # Quality and its trend.
    d["net_margin_chg_1y"] = d["net_margin"] - d["net_margin_1y"]
    d["net_margin_chg_3y"] = d["net_margin"] - d["net_margin_3y"]
    d["gross_margin_chg_1y"] = d["gross_margin"] - d["gross_margin_1y"]
    d["roic_chg_1y"] = d["roic"] - d["roic_1y"]
    d["roic_chg_3y"] = d["roic"] - d["roic_3y"]
    d["fcf_conversion"] = (d["fcf"] / d["netinc_x"]).where(d["netinc_x"] > 0)
    d["accruals"] = ((d["netinc_x"] - d["ncfo_x"]) / d["assets_x"]).where(d["assets_x"] > 0)
    d["interest_cover"] = (d["ebit"] / d["intexp_x"]).where(d["intexp_x"] > 0)
    # Balance sheet: net cash already in the snapshot (net_cash_pct).
    # Dilution: 1y change in basic shares (TTM rows four quarters apart).
    d["shares_chg_1y"] = (d["sharesbas_x"] / d["sharesbas_1y"] - 1).where(d["sharesbas_1y"] > 0)
    # Growth acceleration: latest annual growth minus the 3-year CAGR.
    d["sales_accel"] = d["sales_g_yr"] - d["sales_g_3y"]
    # Insiders, normalised by size; blank (not zero) where sf2 has no coverage.
    covered = pd.to_datetime(d["q"]) >= pd.Timestamp(INSIDER_START)
    for c in ("ins_buy_val", "ins_sell_val", "ins_buyers", "ins_sellers"):
        d[c] = d[c].where(~covered | d[c].notna(), 0.0).where(covered)
    d["ins_net_buy_pct"] = ((d["ins_buy_val"] - d["ins_sell_val"]) / mc).where(covered)
    d["ins_buy_pct"] = (d["ins_buy_val"] / mc).where(covered)
    d["ins_any_buy"] = (d["ins_buyers"] > 0).astype(float).where(covered)
    d["log_marketcap"] = np.log10(mc)
    return d


EXTRA_SIGNALS = (
    "earnings_yield", "fcf_yield", "ebitda_ev", "book_to_price", "sales_ev",
    "net_margin_chg_1y", "net_margin_chg_3y", "gross_margin_chg_1y", "roic_chg_1y",
    "roic_chg_3y", "fcf_conversion", "accruals", "interest_cover", "shares_chg_1y",
    "sales_accel", "mom_12_1", "mom_6", "mom_1", "vol_1y", "ins_net_buy_pct", "ins_buy_pct",
    "ins_any_buy", "ins_buyers", "log_marketcap",
)


# --------------------------------------------------------------------------- build


def build(session: Session, grid: list[date], say: Say = print) -> pd.DataFrame:
    """Assemble the panel for `grid` (see the module docstring). Several minutes."""
    base = harness.build_panel(session, grid, _FORCE, say)
    base["q"] = pd.to_datetime(base["q"]).dt.date
    say(f"Snapshot panel: {len(base):,} rows")
    xf = _extra_fundamentals(session, grid)
    base = base.merge(xf, on=["q", "permaticker"], how="left")
    say(f"Insider trades (sf2, {INSIDER_START.year}+)…")
    ins = _insiders(session, grid)
    base = base.merge(ins, on=["q", "permaticker"], how="left")

    ends = {(pd.Timestamp(q) + pd.DateOffset(months=h)).date() for q in grid for h in HORIZONS}
    latest = harness._d(query_df(session, "SELECT max(date) AS d FROM sep")["d"].iloc[0])
    ends = {e for e in ends if e <= latest}
    say(f"Cross-sectional price windows for {len(set(grid) | ends)} dates…")
    pws = {d: harness.price_window(session, d) for d in sorted(set(grid) | ends)}
    p = harness.Params(screen="-")

    frames = []
    for i, q in enumerate(grid, 1):
        trad = harness._tradable(pws[q], q, p)
        allp = harness.pick(pws[q])
        fw = _forward(session, q, trad, pws)
        ps = _price_stats(session, q)
        # momentum on the same series the forward return follows where there is one
        chosen = trad["ticker"].reindex(allp.index).fillna(allp["ticker"])
        ps = ps[ps["ticker"] == ps["permaticker"].map(chosen)] if not ps.empty else ps
        ps = ps.set_index("permaticker")[["mom_12_1", "mom_6", "mom_1", "vol_1y"]]
        f = pd.DataFrame(index=allp.index)
        f["tradable"] = f.index.isin(trad.index)
        f["entry_px"] = trad["px"].reindex(f.index)
        f["entry_px_unadj"] = allp["px_unadj"]
        f["adv"] = allp["adv"]
        f = f.join(fw, how="left").join(ps, how="left")
        f["q"] = q
        frames.append(f.reset_index())
        say(f"[{i}/{len(grid)}] {q}: {int(f['tradable'].sum()):,} tradable, "
            f"fwd24 known for {int(f.get('fwd_24m', pd.Series(dtype=float)).notna().sum()):,}")
    pf = pd.concat(frames, ignore_index=True)
    pf["permaticker"] = pf["permaticker"].astype("int64")
    base["permaticker"] = base["permaticker"].astype("int64")
    d = base.merge(pf, on=["q", "permaticker"], how="left")
    d["tradable"] = d["tradable"].astype("boolean").fillna(False).astype(bool)
    for h in HORIZONS:
        d[f"stopped_{h}m"] = pd.to_numeric(d[f"stopped_{h}m"], errors="coerce")
    d = _derive_extra(d)
    d["period"] = d["q"].map(period_of)
    _sanity(d, say)
    return d


def _sanity(d: pd.DataFrame, say: Say) -> None:
    """CLAUDE.md: no negative prices, returns in plausible ranges — reported, not hidden."""
    t = d[d["tradable"]]
    bad = (t["entry_px"] <= 0).sum()
    if bad:
        say(f"WARNING: {bad} tradable rows with a non-positive entry price")
    for h in HORIZONS:
        c = f"fwd_{h}m"
        if c in t:
            r = t[c].dropna()
            say(f"  fwd {h}m: n={len(r):,} median {r.median():+.1%} "
                f"<-100%: {(r < -1).sum()} >+1000%: {(r > 10).sum()}")


def cache_path(grid: list[date]) -> Path:
    key = f"panel-v{PANEL_VERSION}-{grid[0]:%Y%m%d}-{grid[-1]:%Y%m%d}-{len(grid)}"
    return PANEL_DIR / f"{key}.parquet"


def load(session: Session | None = None, grid: list[date] | None = None, *,
         rebuild: bool = False, say: Say = print) -> pd.DataFrame:
    """The cached panel, building (and caching) it if absent or `rebuild`."""
    grid = grid or default_grid()
    path = cache_path(grid)
    if path.exists() and not rebuild:
        say(f"Panel cache: {path}")
        d = pd.read_parquet(path)
        d["q"] = pd.to_datetime(d["q"]).dt.date
        return d
    if session is None:
        from core.backend.db.engine import session_scope
        with session_scope() as s:
            return load(s, grid, rebuild=True, say=say)
    d = build(session, grid, say)
    PANEL_DIR.mkdir(parents=True, exist_ok=True)
    out = d.copy()
    for c in out.columns:            # parquet wants one type per column
        if out[c].dtype == object:
            out[c] = out[c].map(lambda v: None if v is None or (isinstance(v, float)
                                                                 and math.isnan(v))
                                else (v.isoformat() if hasattr(v, "isoformat") else str(v)))
    tmp = path.with_suffix(".tmp")
    out.to_parquet(tmp, index=False)
    tmp.rename(path)
    say(f"Panel cached → {path} ({len(d):,} rows, {d.shape[1]} columns)")
    return d


def info(d: pd.DataFrame) -> dict[str, Any]:
    """Row counts per period — for a report's provenance block."""
    return {k: int(v) for k, v in d.groupby("period").size().items()}
