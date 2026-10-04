"""Point-in-time backtest harness — "expectation vs. reality" for a saved screen.

Reconstructs what a screen would have selected **with only the information public on a past
date**, then measures what those names actually did next. Two anti-cheating rules:

  1. **No look-ahead in fundamentals.** `sf1` rows are gated by `datekey <= asof` (datekey is
     the SEC filing date — when the figure became public) and the latest *filed* row is
     taken. Valuation comes from `daily` on/before the as-of date. 52-week price bands and
     13F holder counts (only fetched when a screen gates on them) are likewise windowed to
     data that existed then; 13F aggregates are lagged 45 days for the filing delay.
  2. **No survivorship bias.** The universe is every security with a `daily` valuation in
     the 21 days before the as-of date — not today's listed names — and today's
     `isdelisted` flag is ignored. A holding that stops trading mid-period is valued at its
     last traded price, so busts and buyouts both carry their real outcome.

Returns use `closeadj` (split- and dividend-adjusted) — total return. The SPY benchmark is
the same total-return series from `sfp`.

Every query is bounded: cross-sectional reads of `daily` / `sep` are confined to a few weeks
around each rebalance date (index on `date`), per-name price paths filter on
`permaticker` (index on `(permaticker, date)`), and `sf1` — 3M rows — is read once per
dimension for the whole grid. Nothing scans `sep` or `daily` unfiltered.

Pure computation: nothing here writes files. `core.backend.backtest.run` turns the result
into a report folder.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from core.backend import screens
from core.backend.queries._common import query_df, rows, scalar
from core.backend.queries.discovery import screener

Say = Callable[[str], None]

# How far back a figure may be and still count as "the latest known". Without a cap, a name
# that stopped filing years ago would be screened on fundamentals from a different era.
FUNDAMENTAL_STALE_DAYS = 548        # ~18 months: covers a late annual filer, not a dead one
VALUATION_WINDOW_DAYS = 21          # a `daily` row this recent ⇒ the name was alive at asof
TRADABLE_WINDOW_DAYS = 10           # a `sep` print this recent ⇒ we could actually buy it
ADV_WINDOW_DAYS = 30                # dollar volume averaged over this window
INST_LAG_DAYS = 45                  # 13F filings are due 45 days after quarter end

# Sanity bounds (CLAUDE.md: "no negative prices, returns in plausible ranges"). Breaching one
# is not an error — it is reported prominently in the report's warnings.
NAME_RETURN_MAX = 10.0              # +1,000% in one holding period: possible, worth a look
PERIOD_RETURN_BOUNDS = (-0.8, 3.0)  # a diversified basket outside this is suspect
BENCH_CAGR_BOUNDS = (-0.3, 0.4)     # SPY outside this over a multi-year run ⇒ data problem
MIN_UNIVERSE = 500                  # fewer live names than this ⇒ a data gap, not a market

_PRICE_BAND_COLS = {"m_price", "high52w", "low52w", "pct_above_low", "pct_below_high"}
_INST_COLS = {"inst_holders"}


@dataclass
class Params:
    """Everything that determines a run. Stored verbatim in the report."""
    screen: str
    kind: str = "portfolio"                 # portfolio | cohort
    start: str = "2005-01-01"
    end: str | None = None                  # default: latest sep date
    rebalance_months: int = 12
    hold_months: int = 12                   # cohort horizon (portfolio holds to next rebalance)
    benchmark: str = "SPY"
    cost_bps: float = 30.0                  # charged on turnover (portfolio)
    min_price: float = 3.0                  # unadjusted close at entry
    min_adv: float = 1e6                    # avg daily dollar volume at entry
    min_names: int = 5                      # fewer passers ⇒ sit in cash that period


@dataclass
class Result:
    params: Params
    spec: dict[str, Any]
    summary: dict[str, Any]
    series: dict[str, list[dict[str, Any]]]
    periods: list[dict[str, Any]]
    warnings: list[dict[str, str]] = field(default_factory=list)
    series_kind: str = "nav"


# ----------------------------------------------------------------------------- dates


def _d(x: Any) -> date:
    return pd.Timestamp(x).date()


def rebalance_grid(start: date, end: date, months: int) -> list[date]:
    """start, start+m, start+2m … while ≤ end (calendar anniversaries, not trading days —
    every lookup is "last print on/before", so a weekend date is harmless)."""
    out, k = [], 0
    while True:
        d = (pd.Timestamp(start) + pd.DateOffset(months=months * k)).date()
        if d > end:
            return out
        out.append(d)
        k += 1


def _monthly_marks(t: date, tn: date) -> list[date]:
    """Monthly anniversaries strictly inside (t, tn), then tn — the equity-curve sampling."""
    marks, k = [], 1
    while True:
        m = (pd.Timestamp(t) + pd.DateOffset(months=k)).date()
        if m >= tn - timedelta(days=7):
            break
        marks.append(m)
        k += 1
    return [*marks, tn]


# ----------------------------------------------------------------------------- panels

_ART_COLS = ("revenue, cashneq, debt, fcf, opinc, grossmargin, netmargin, roe, roa, roic, "
             "currentratio, de, debtnc, equity, assetsc, inventory, liabilitiesc, payoutratio, "
             "divyield, eps, dps, assets, liabilities, workingcapital, retearn, ebit, "
             "ev AS ev_art, marketcap AS mc_art, pe AS pe_art, ps AS ps_art, pb AS pb_art, "
             "evebitda AS evebitda_art")
_ART_LAGS = "lag(eps, 4) OVER c AS eps_1y, lag(revenue, 4) OVER c AS revenue_1y"
_ARQ_COLS = "eps AS eps_q, revenue AS rev_q, revenue"
_ARQ_LAGS = "lag(eps, 4) OVER c AS eps_q1y, lag(revenue, 4) OVER c AS rev_q1y"
_ARY_COLS = "eps AS eps_y, revenue AS rev_y, dps AS dps_y, shareswadil AS shares_y, revenue"
_ARY_LAGS = ("lag(eps, 1) OVER c AS eps_y1, lag(eps, 3) OVER c AS eps_y3, "
             "lag(eps, 5) OVER c AS eps_y5, lag(revenue, 1) OVER c AS rev_y1, "
             "lag(revenue, 3) OVER c AS rev_y3, lag(revenue, 5) OVER c AS rev_y5, "
             "lag(dps, 3) OVER c AS dps_y3, lag(shareswadil, 5) OVER c AS shares_y5")


def _fundamentals(session: Session, dim: str, cols: str, lags: str,
                  grid: list[date]) -> pd.DataFrame:
    """Latest *filed* `sf1` row per (grid date, permaticker) for one dimension.

    The lag windows run once over the dimension (ordered by fiscal period, so "a year ago"
    means the same quarter last year); each grid date then takes the newest row whose
    filing date is on/before it and no older than FUNDAMENTAL_STALE_DAYS. A blank
    preliminary filing (revenue NULL) loses to a populated one, as in the live snapshot."""
    sql = f"""
    WITH g AS (SELECT unnest(CAST(:g AS date[])) AS q),
    w AS (
        SELECT permaticker, calendardate, datekey, {cols}, {lags}
        FROM sf1
        WHERE dimension = :dim AND permaticker IS NOT NULL AND datekey <= :maxq
        WINDOW c AS (PARTITION BY permaticker ORDER BY calendardate)
    )
    SELECT DISTINCT ON (g.q, w.permaticker) g.q, w.*
    FROM g JOIN w ON w.datekey <= g.q AND w.datekey > g.q - CAST(:stale AS integer)
    ORDER BY g.q, w.permaticker, (w.revenue IS NULL), w.datekey DESC, w.calendardate DESC
    """
    df = query_df(session, sql, {"g": grid, "dim": dim, "maxq": max(grid),
                                 "stale": FUNDAMENTAL_STALE_DAYS})
    return df.drop(columns=["calendardate", "datekey", "revenue"] if dim != "ART"
                   else ["calendardate", "datekey"], errors="ignore")


def _valuation(session: Session, q: date) -> pd.DataFrame:
    """`daily` valuation on/before q, from a row no older than VALUATION_WINDOW_DAYS. Joining
    on this is the survivorship gate: a name with no recent row had already stopped trading."""
    return query_df(session, """
        SELECT DISTINCT ON (permaticker) permaticker,
               marketcap * 1e6 AS marketcap_d, ev * 1e6 AS ev_d,
               pe AS pe_d, ps AS ps_d, pb AS pb_d, evebitda AS evebitda_d
        FROM daily
        WHERE date > :lo AND date <= :hi AND permaticker IS NOT NULL
        ORDER BY permaticker, date DESC
    """, {"lo": q - timedelta(days=VALUATION_WINDOW_DAYS), "hi": q})


def _price_band(session: Session, q: date) -> pd.DataFrame:
    """52-week close band as of q (only built when a screen gates on it — it reads a year
    of `sep`, ~2.5M rows, via the date index). One ticker series per name (see `pick`)."""
    df = query_df(session, """
        SELECT permaticker, ticker, count(*) AS n, max(date) AS px_date,
               (array_agg(close ORDER BY date DESC))[1] AS m_price,
               max(close) AS high52w, min(close) AS low52w
        FROM sep WHERE date > :lo AND date <= :hi AND permaticker IS NOT NULL
        GROUP BY permaticker, ticker
    """, {"lo": q - timedelta(days=365), "hi": q})
    return pick(df).reset_index()[["permaticker", "m_price", "high52w", "low52w"]]


def _inst(session: Session, q: date) -> pd.DataFrame:
    """13F holder count from the latest quarter whose filings were due by q."""
    cutoff = q - timedelta(days=INST_LAG_DAYS)
    return query_df(session, """
        SELECT DISTINCT ON (permaticker) permaticker, shrholders AS inst_holders
        FROM sf3a WHERE date <= :hi AND date > :lo AND permaticker IS NOT NULL
        ORDER BY permaticker, date DESC
    """, {"lo": cutoff - timedelta(days=150), "hi": cutoff})


# `sep` can hold TWO ticker series for one permaticker on the same dates (a renamed or
# re-registered listing kept under both symbols — ELME/ELMES, AETR/WPRT, …), and their
# `closeadj` levels can differ by orders of magnitude. Mixing them turns a flat year into a
# +5,000% return. So every price read is per (permaticker, ticker), one series is chosen per
# name at entry, and that same series is followed to the exit.


def pick(df: pd.DataFrame) -> pd.DataFrame:
    """One row per permaticker from per-(permaticker, ticker) rows: the series with the most
    prints in the window, then the most recent, then alphabetical (deterministic)."""
    if df.empty:
        return df.set_index("permaticker")
    return (df.sort_values(["permaticker", "n", "px_date", "ticker"],
                           ascending=[True, False, False, True])
              .drop_duplicates("permaticker").set_index("permaticker"))


def price_window(session: Session, q: date) -> pd.DataFrame:
    """Per (permaticker, ticker): last adjusted / unadjusted close on/before q, its date, the
    number of prints and average dollar volume over the preceding ADV_WINDOW_DAYS."""
    df = query_df(session, """
        SELECT permaticker, ticker, count(*) AS n,
               (array_agg(closeadj ORDER BY date DESC))[1] AS px,
               (array_agg(closeunadj ORDER BY date DESC))[1] AS px_unadj,
               max(date) AS px_date,
               avg(closeunadj * volume) AS adv
        FROM sep WHERE date > :lo AND date <= :hi AND permaticker IS NOT NULL
        GROUP BY permaticker, ticker
    """, {"lo": q - timedelta(days=ADV_WINDOW_DAYS), "hi": q})
    df["px_date"] = pd.to_datetime(df["px_date"]).dt.date
    return df


def _needed(spec: dict[str, Any]) -> set[str]:
    cols = set((spec.get("gates") or {}).keys())
    for g in spec.get("growth") or []:
        cols |= {g.get("level"), g.get("level_5y_ago"), g.get("cagr")}
    return cols


def build_panel(session: Session, grid: list[date], spec: dict[str, Any],
                say: Say) -> pd.DataFrame:
    """The derived screen panel, one row per (q, permaticker) alive at q — the same columns
    the live `screener_snapshot` has, computed by the same `screener._derive`."""
    need = _needed(spec)
    say(f"Loading point-in-time fundamentals (sf1 ART/ARQ/ARY) for {len(grid)} dates…")
    art = _fundamentals(session, "ART", _ART_COLS, _ART_LAGS, grid)
    arq = _fundamentals(session, "ARQ", _ARQ_COLS, _ARQ_LAGS, grid)
    ary = _fundamentals(session, "ARY", _ARY_COLS, _ARY_LAGS, grid)
    say(f"  ART {len(art):,} · ARQ {len(arq):,} · ARY {len(ary):,} rows")
    master = query_df(session, screener._MASTER)

    frames = []
    for q in grid:
        v = _valuation(session, q)
        v["q"] = q
        if need & _PRICE_BAND_COLS:
            v = v.merge(_price_band(session, q), on="permaticker", how="left")
        if need & _INST_COLS:
            v = v.merge(_inst(session, q), on="permaticker", how="left")
        frames.append(v)
    val = pd.concat(frames, ignore_index=True)
    for d in (art, arq, ary):
        d["q"] = pd.to_datetime(d["q"]).dt.date

    raw = (val.merge(art, on=["q", "permaticker"], how="left")
              .merge(arq, on=["q", "permaticker"], how="left")
              .merge(ary, on=["q", "permaticker"], how="left")
              .merge(master, on="permaticker", how="left"))
    # Same precedence as the live snapshot: the market's daily figure, else the filing's.
    for live, d_col, a_col in (("marketcap", "marketcap_d", "mc_art"), ("ev", "ev_d", "ev_art"),
                               ("pe", "pe_d", "pe_art"), ("ps", "ps_d", "ps_art"),
                               ("pb", "pb_d", "pb_art"), ("ev_ebitda", "evebitda_d",
                                                          "evebitda_art")):
        raw[live] = raw[d_col].combine_first(raw[a_col])
    for col in ("m_price", "high52w", "low52w", "inst_holders"):
        if col not in raw.columns:
            raw[col] = np.nan
    derived = screener._derive(raw.copy())
    # years_public must be measured AS OF the date, not today — else a 2010 IPO would pass a
    # ≥5y gate in 2011. _derive uses now(); override it.
    derived["years_public"] = (
        (pd.to_datetime(derived["q"]) - pd.to_datetime(derived["firstpricedate"],
                                                       errors="coerce")).dt.days / 365.25)
    return derived


def panel_for(session: Session, grid: list[date], spec: dict[str, Any], say: Say,
              prebuilt: pd.DataFrame | None = None) -> pd.DataFrame:
    """`build_panel`, reusing a prebuilt panel's dates where it has them (the cached study
    panel from `backtest.panel`, built by this same function) and building only the rest."""
    if prebuilt is None:
        return build_panel(session, grid, spec, say)
    have = set(prebuilt["q"])
    missing = [q for q in grid if q not in have]
    parts = [prebuilt[prebuilt["q"].isin(set(grid))]]
    if missing:
        parts.append(build_panel(session, missing, spec, say))
    say(f"Reusing the cached panel for {len(grid) - len(missing)} of {len(grid)} dates")
    return pd.concat(parts, ignore_index=True)


# ----------------------------------------------------------------------------- prices


def _own_series(df: pd.DataFrame, tick: pd.Series) -> pd.DataFrame:
    """Keep only each name's chosen ticker series."""
    if df.empty:
        return df
    want = df["permaticker"].map(tick)
    return df[df["ticker"] == want]


def price_paths(session: Session, perms: list[int], tick: pd.Series,
                lo: date, hi: date) -> pd.DataFrame:
    """closeadj, date × permaticker, for the given names' chosen series over (lo, hi],
    forward-filled — so a name that stops trading carries its last price (the realised
    outcome) to the end."""
    if not perms:
        return pd.DataFrame()
    df = query_df(session, """
        SELECT permaticker, ticker, date, closeadj FROM sep
        WHERE permaticker = ANY(CAST(:p AS bigint[])) AND date > :lo AND date <= :hi
          AND closeadj IS NOT NULL
    """, {"p": [int(x) for x in perms], "lo": lo, "hi": hi})
    df = _own_series(df, tick)
    if df.empty:
        return pd.DataFrame()
    df["date"] = pd.to_datetime(df["date"])
    return df.pivot_table(index="date", columns="permaticker", values="closeadj",
                          aggfunc="last").sort_index().ffill()


def last_prices(session: Session, perms: list[int], tick: pd.Series,
                after: date, upto: date) -> pd.DataFrame:
    """Last closeadj in (after, upto] of each name's chosen series — for names that stopped
    trading before `upto` (so the cross-sectional window at `upto` misses them)."""
    if not perms:
        return pd.DataFrame(columns=["px", "px_date"])
    df = query_df(session, """
        SELECT DISTINCT ON (permaticker, ticker) permaticker, ticker, closeadj AS px,
               date AS px_date
        FROM sep
        WHERE permaticker = ANY(CAST(:p AS bigint[])) AND date > :lo AND date <= :hi
          AND closeadj IS NOT NULL
        ORDER BY permaticker, ticker, date DESC
    """, {"p": [int(x) for x in perms], "lo": after, "hi": upto})
    df = _own_series(df, tick)
    df["px_date"] = pd.to_datetime(df["px_date"]).dt.date
    return df.set_index("permaticker")[["px", "px_date"]]


def benchmark_series(session: Session, ticker: str, lo: date, hi: date) -> pd.Series:
    """Total-return (closeadj) series for the benchmark. Funds (SPY) live in `sfp`; an equity
    ticker falls back to `sep`. Resolved to a permaticker first — tickers recycle."""
    found = rows(session, """
        SELECT "table", permaticker FROM tickers
        WHERE ticker = :t AND "table" IN ('SFP', 'SEP') AND permaticker IS NOT NULL
        ORDER BY CASE "table" WHEN 'SFP' THEN 0 ELSE 1 END,
                 CASE isdelisted WHEN 'N' THEN 0 ELSE 1 END
        LIMIT 1
    """, {"t": ticker.upper()})
    if not found:
        return pd.Series(dtype=float)
    table = "sfp" if found[0]["table"] == "SFP" else "sep"
    df = query_df(session, f"""
        SELECT date, closeadj FROM {table}
        WHERE permaticker = :p AND date > :lo AND date <= :hi AND closeadj IS NOT NULL
        ORDER BY date
    """, {"p": int(found[0]["permaticker"]), "lo": lo, "hi": hi})
    if df.empty:
        return pd.Series(dtype=float)
    return pd.Series(df["closeadj"].astype(float).values, index=pd.to_datetime(df["date"]))


def _at(series: pd.Series | pd.DataFrame, d: date):
    """Last value on/before d (row for a frame), or None if there is none."""
    s = series.loc[:pd.Timestamp(d)]
    return None if s.empty else s.iloc[-1]


# ----------------------------------------------------------------------------- screening


def eligible(snap: pd.DataFrame, spec: dict[str, Any]) -> pd.DataFrame:
    """The comparison universe: the screen's universe rules and size band only, without its
    quality/value gates — so strategy-minus-universe isolates what the filter adds rather
    than a size or sector tilt."""
    uni = dict(spec.get("universe") or {})
    sub: dict[str, Any] = {"id": f"{spec.get('id')}-universe", "universe": uni}
    cap = (spec.get("gates") or {}).get("marketcap")
    if cap:
        sub["gates"] = {"marketcap": cap}
    return screens.apply_screen(snap, sub, drop_delisted=False)


def _tradable(pw_raw: pd.DataFrame, q: date, p: Params) -> pd.DataFrame:
    """Names buyable at q, one chosen ticker series each (index permaticker; `ticker` column
    is the series followed to the exit)."""
    pw = pick(pw_raw)
    fresh = pw["px_date"].map(lambda d: d > q - timedelta(days=TRADABLE_WINDOW_DAYS))
    ok = (fresh & (pw["px"] > 0) & (pw["px_unadj"] >= p.min_price)
          & (pw["adv"].fillna(0) >= p.min_adv))
    return pw[ok]


def _exit_prices(session: Session, perms: list[int], tick: pd.Series, t: date, h: date,
                 pw_h: pd.DataFrame) -> pd.DataFrame:
    """Last price on/before h of each name's chosen series, with names that stopped trading
    before the window at h filled from their own final print."""
    sel = pw_h[pw_h["permaticker"].isin(perms)]
    have = (_own_series(sel, tick).set_index("permaticker")
            .dropna(subset=["px"])[["px", "px_date"]])
    # A print in pw_h older than t belongs to before the holding period — impossible for a
    # name tradable at t, but guard anyway.
    have = have[have["px_date"].map(lambda d: d > t).astype(bool)]
    missing = [x for x in perms if x not in have.index]
    if missing:
        have = pd.concat([have, last_prices(session, missing, tick, t, h)])
    return have


# ----------------------------------------------------------------------------- runs


def _holding_rows(meta: pd.DataFrame, ids: list[int], entry: pd.Series,
                  exits: pd.DataFrame, h: date) -> list[dict[str, Any]]:
    out = []
    m = meta.set_index("permaticker")
    for pt in ids:
        e = float(entry.get(pt, np.nan))
        x = exits.loc[pt] if pt in exits.index else None
        px1 = float(x["px"]) if x is not None else e
        xd = x["px_date"] if x is not None else None
        row = m.loc[pt] if pt in m.index else {}
        out.append({
            "permaticker": int(pt),
            "ticker": row.get("ticker") if len(row) else None,
            "name": row.get("name") if len(row) else None,
            "sector": row.get("sector") if len(row) else None,
            "entry_px": e, "exit_px": px1,
            "exit_date": xd.isoformat() if xd else None,
            "ret": (px1 / e - 1) if e and e > 0 else None,
            "stopped_trading": bool(xd and xd < h - timedelta(days=TRADABLE_WINDOW_DAYS)),
            "marketcap": _f(row.get("marketcap")) if len(row) else None,
        })
    return out


def _f(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else v


def _stats_nav(points: list[tuple[date, float]]) -> dict[str, float | None]:
    """CAGR / vol / max drawdown of a NAV sampled at (roughly monthly) marks."""
    if len(points) < 2:
        return {}
    dates = [p[0] for p in points]
    nav = pd.Series([p[1] for p in points], index=pd.to_datetime(dates))
    years = (dates[-1] - dates[0]).days / 365.25
    total = nav.iloc[-1] / nav.iloc[0] - 1
    rets = nav.pct_change().dropna()
    gaps = pd.Series(nav.index).diff().dt.days.dropna()
    per_year = 365.25 / gaps.mean() if len(gaps) else 12
    vol = float(rets.std(ddof=1) * math.sqrt(per_year)) if len(rets) > 2 else None
    cagr = (1 + total) ** (1 / years) - 1 if years > 0 and total > -1 else None
    return {
        "total_return": float(total), "cagr": _f(cagr), "volatility": _f(vol),
        "max_drawdown": float((nav / nav.cummax() - 1).min()),
        "sharpe_rf0": _f(cagr / vol) if cagr is not None and vol else None,
    }


def run_portfolio(session: Session, p: Params, spec: dict[str, Any], say: Say,
                  prebuilt: pd.DataFrame | None = None) -> Result:
    """Equal-weight the screen's passers at each rebalance date and hold them to the next
    (buy-and-hold within the period, marked monthly); compare with SPY and with the
    equal-weight eligible universe."""
    start, end = _d(p.start), _d(p.end)
    grid = rebalance_grid(start, end, p.rebalance_months)
    if not grid:
        raise ValueError("No rebalance dates between start and end.")
    bounds = list(grid)
    if (end - grid[-1]).days > 7:
        bounds.append(end)                      # final, partial period
    if len(bounds) < 2:
        raise ValueError("Range too short for one holding period — move start or end.")
    warnings: list[dict[str, str]] = []

    panel = panel_for(session, grid, spec, say, prebuilt)
    say(f"Panel: {len(panel):,} (date, security) rows across {len(grid)} rebalance dates")
    passed_all = screens.apply_screen(panel, spec, drop_delisted=False)
    say("Loading cross-sectional price windows…")
    pws = {q: price_window(session, q) for q in bounds}
    say(f"Loading benchmark {p.benchmark}…")
    bench = benchmark_series(session, p.benchmark, start - timedelta(days=10), end)
    if bench.empty:
        warnings.append(_w("warn", "benchmark-missing",
                           f"No price history for benchmark {p.benchmark} — benchmark "
                           "figures are blank."))

    nav, uni_nav = 1.0, 1.0
    nav_pts: list[tuple[date, float]] = [(bounds[0], 1.0)]
    bench_pts: list[tuple[date, float]] = []
    uni_pts: list[tuple[date, float]] = [(bounds[0], 1.0)]
    b0 = _at(bench, bounds[0]) if not bench.empty else None
    if b0:
        bench_pts.append((bounds[0], 1.0))
    periods: list[dict[str, Any]] = []
    prev: set[int] = set()

    for i, (t, tn) in enumerate(zip(bounds[:-1], bounds[1:]), 1):
        snap = panel[panel["q"] == t]
        passed = passed_all[passed_all["q"] == t]
        trad = _tradable(pws[t], t, p)
        hold = sorted(set(passed["permaticker"].astype(int)) & set(trad.index.astype(int)))
        if len(snap) < MIN_UNIVERSE:
            warnings.append(_w("warn", "thin-universe",
                               f"{t}: only {len(snap)} securities alive in the panel — "
                               "likely a data gap (is `daily`/`sf1` loaded this far back?)."))
        b_t = _at(bench, t) if not bench.empty else None
        b_n = _at(bench, tn) if not bench.empty else None
        bench_ret = (b_n / b_t - 1) if b_t and b_n else None

        # The eligible universe, same liquidity floor.
        elig = eligible(snap, spec)
        uni_ids = sorted(set(elig["permaticker"].astype(int)) & set(trad.index.astype(int)))
        uni_ret = None
        if uni_ids:
            ux = _exit_prices(session, uni_ids, trad["ticker"], t, tn, pws[tn])
            ur = (ux["px"] / trad["px"].reindex(ux.index) - 1).dropna()
            # names with no print at all after t: flat (entry = exit)
            ur = pd.concat([ur, pd.Series(0.0, index=[x for x in uni_ids if x not in ux.index])])
            uni_ret = float(ur.mean())
            uni_nav *= 1 + uni_ret
        uni_pts.append((tn, uni_nav))

        row: dict[str, Any] = {
            "start": t.isoformat(), "end": tn.isoformat(), "n_universe": len(snap),
            "n_eligible": len(uni_ids), "n_passed": int(len(passed)), "n_held": len(hold),
            "bench_ret": _f(bench_ret), "universe_ret": _f(uni_ret), "partial": tn not in grid,
        }

        if len(hold) < p.min_names:
            warnings.append(_w("info", "cash-period",
                               f"{t} → {tn}: {len(hold)} tradable passers (< min_names "
                               f"{p.min_names}) — held cash (0% return) this period."))
            for m in _monthly_marks(t, tn):
                nav_pts.append((m, nav))
                if b0 and (bm := _at(bench, m)):
                    bench_pts.append((m, bm / b0))
            row.update(cash=True, turnover=None, ret_gross=0.0, ret_net=0.0, holdings=[])
            periods.append(row)
            prev = set()
            say(f"[{i}/{len(bounds) - 1}] {t} → {tn}: {len(passed)} passed, "
                f"{len(hold)} tradable — CASH")
            continue

        entry = trad["px"].reindex(hold)
        path = price_paths(session, hold, trad["ticker"],
                           t - timedelta(days=TRADABLE_WINDOW_DAYS), tn)
        turnover = 1.0 if not prev else 1.0 - len(set(hold) & prev) / len(hold)
        start_nav = nav * (1 - p.cost_bps / 1e4 * turnover)
        for m in _monthly_marks(t, tn):
            last = _at(path, m) if not path.empty else None
            rel = (last.reindex(hold) / entry).fillna(1.0) if last is not None else \
                pd.Series(1.0, index=hold)
            nav_pts.append((m, start_nav * float(rel.mean())))
            if b0 and (bm := _at(bench, m)):
                bench_pts.append((m, bm / b0))

        exits = _exit_prices(session, hold, trad["ticker"], t, tn, pws[tn])
        hrows = _holding_rows(snap, hold, entry, exits, tn)
        rets = pd.Series([h["ret"] for h in hrows], dtype=float).fillna(0.0)
        gross = float(rets.mean())
        nav = start_nav * (1 + gross)
        nav_pts[-1] = (tn, nav)               # the tn mark, from exits (same prices)
        net = nav / (start_nav / (1 - p.cost_bps / 1e4 * turnover)) - 1
        row.update(cash=False, turnover=turnover, ret_gross=gross, ret_net=float(net),
                   n_stopped=sum(h["stopped_trading"] for h in hrows), holdings=hrows)
        periods.append(row)
        _sanity_period(row, warnings)
        prev = set(hold)
        say(f"[{i}/{len(bounds) - 1}] {t} → {tn}: {len(passed)} passed, {len(hold)} held, "
            f"return {gross * 100:+.1f}% (SPY {_pct(bench_ret)}, universe {_pct(uni_ret)})")

    s = _stats_nav(nav_pts)
    bs = _stats_nav(bench_pts) if len(bench_pts) > 1 else {}
    us = _stats_nav(uni_pts)
    inv = [r for r in periods if not r["cash"]]
    beat = [r for r in inv if r["bench_ret"] is not None]
    beat_u = [r for r in inv if r["universe_ret"] is not None]
    summary = {
        "start": bounds[0].isoformat(), "end": bounds[-1].isoformat(),
        "years": round((bounds[-1] - bounds[0]).days / 365.25, 2),
        **s,
        "bench_total_return": bs.get("total_return"), "bench_cagr": bs.get("cagr"),
        "bench_volatility": bs.get("volatility"), "bench_max_drawdown": bs.get("max_drawdown"),
        "universe_total_return": us.get("total_return"), "universe_cagr": us.get("cagr"),
        "excess_cagr": (s["cagr"] - bs["cagr"]) if s.get("cagr") is not None
        and bs.get("cagr") is not None else None,
        "excess_cagr_vs_universe": (s["cagr"] - us["cagr"]) if s.get("cagr") is not None
        and us.get("cagr") is not None else None,
        "hit_rate": (sum(r["ret_net"] > r["bench_ret"] for r in beat) / len(beat))
        if beat else None,
        "hit_rate_vs_universe": (sum(r["ret_net"] > r["universe_ret"] for r in beat_u)
                                 / len(beat_u)) if beat_u else None,
        "periods": len(periods), "cash_periods": len(periods) - len(inv),
        "avg_holdings": float(np.mean([r["n_held"] for r in inv])) if inv else 0.0,
        "avg_turnover": float(np.mean([r["turnover"] for r in inv])) if inv else None,
        "unique_names": len({h["permaticker"] for r in inv for h in r["holdings"]}),
    }
    _sanity_bench(summary, warnings)
    if summary["periods"] and summary["cash_periods"] == summary["periods"]:
        warnings.append(_w("warn", "never-invested",
                           "The screen never produced enough tradable names — every period "
                           "was cash. Loosen the gates or lower min_names."))
    series = {"strategy": _pts(nav_pts), "benchmark": _pts(bench_pts),
              "universe": _pts(uni_pts)}
    return Result(p, spec, summary, series, periods, warnings, "nav")


def run_cohort(session: Session, p: Params, spec: dict[str, Any], say: Say,
               prebuilt: pd.DataFrame | None = None) -> Result:
    """For each rebalance date, the forward `hold_months` total return of every passer — a
    per-name claim ("these names double") rather than portfolio compounding. Pooled base
    rates vs the eligible universe and SPY over the identical windows."""
    start, end = _d(p.start), _d(p.end)
    grid = rebalance_grid(start, end, p.rebalance_months)
    horizon = {t: (pd.Timestamp(t) + pd.DateOffset(months=p.hold_months)).date() for t in grid}
    usable = [t for t in grid if horizon[t] <= end]
    warnings: list[dict[str, str]] = []
    if len(usable) < len(grid):
        warnings.append(_w("info", "horizon-past-end",
                           f"{len(grid) - len(usable)} cohort date(s) skipped: their "
                           f"{p.hold_months}-month horizon runs past {end}."))
    if not usable:
        raise ValueError("No cohort date has a complete forward window — widen the range.")
    if p.hold_months > p.rebalance_months:
        warnings.append(_w("info", "overlap",
                           "Cohorts overlap (hold > rebalance): consecutive cohorts share "
                           "names and months, so they are not independent samples. Read the "
                           "spread against the universe, not significance."))

    panel = panel_for(session, usable, spec, say, prebuilt)
    passed_all = screens.apply_screen(panel, spec, drop_delisted=False)
    say("Loading cross-sectional price windows…")
    pws = {q: price_window(session, q) for q in sorted(set(usable) | {horizon[t] for t in usable})}
    bench = benchmark_series(session, p.benchmark, start - timedelta(days=10), end)
    if bench.empty:
        warnings.append(_w("warn", "benchmark-missing",
                           f"No price history for benchmark {p.benchmark}."))

    pool, upool, excess = [], [], []
    periods, s_pts, b_pts, u_pts = [], [], [], []
    for i, t in enumerate(usable, 1):
        h = horizon[t]
        snap = panel[panel["q"] == t]
        if len(snap) < MIN_UNIVERSE:
            warnings.append(_w("warn", "thin-universe",
                               f"{t}: only {len(snap)} securities alive — likely a data gap."))
        trad = _tradable(pws[t], t, p)
        passed = passed_all[passed_all["q"] == t]
        hold = sorted(set(passed["permaticker"].astype(int)) & set(trad.index.astype(int)))
        b_t = _at(bench, t) if not bench.empty else None
        b_h = _at(bench, h) if not bench.empty else None
        bench_ret = (b_h / b_t - 1) if b_t and b_h else None

        elig = eligible(snap, spec)
        uni_ids = sorted(set(elig["permaticker"].astype(int)) & set(trad.index.astype(int)))
        ux = _exit_prices(session, uni_ids, trad["ticker"], t, h, pws[h])
        ur = (ux["px"] / trad["px"].reindex(ux.index) - 1).dropna() if not ux.empty \
            else pd.Series(dtype=float)
        upool.extend(ur.tolist())

        exits = _exit_prices(session, hold, trad["ticker"], t, h, pws[h])
        hrows = _holding_rows(snap, hold, trad["px"].reindex(hold), exits, h)
        r = pd.Series([x["ret"] for x in hrows], dtype=float).dropna()
        pool.extend(r.tolist())
        if bench_ret is not None:
            excess.extend((r - bench_ret).tolist())
        row = {
            "start": t.isoformat(), "end": h.isoformat(), "n_universe": len(snap),
            "n_eligible": len(uni_ids), "n_passed": int(len(passed)), "n_held": len(hold),
            "cash": len(hold) == 0,
            "ret_gross": _f(r.mean()) if len(r) else None,
            "ret_net": _f(r.mean()) if len(r) else None,
            "median_ret": _f(r.median()) if len(r) else None,
            "double_rate": _f((r >= 1).mean()) if len(r) else None,
            "halve_rate": _f((r <= -0.5).mean()) if len(r) else None,
            "bench_ret": _f(bench_ret), "universe_ret": _f(ur.mean()) if len(ur) else None,
            "n_stopped": sum(x["stopped_trading"] for x in hrows), "turnover": None,
            "partial": False, "holdings": hrows,
        }
        periods.append(row)
        _sanity_period(row, warnings)
        if row["ret_gross"] is not None:
            s_pts.append((t, row["ret_gross"]))
        if bench_ret is not None:
            b_pts.append((t, bench_ret))
        if row["universe_ret"] is not None:
            u_pts.append((t, row["universe_ret"]))
        say(f"[{i}/{len(usable)}] cohort {t} → {h}: {len(hold)} names, mean "
            f"{_pct(row['ret_gross'])}, median {_pct(row['median_ret'])} "
            f"(SPY {_pct(bench_ret)}, universe {_pct(row['universe_ret'])})")

    v, u = pd.Series(pool, dtype=float), pd.Series(upool, dtype=float)
    bench_rets = [r["bench_ret"] for r in periods if r["bench_ret"] is not None]

    def base(s: pd.Series) -> dict[str, float | None]:
        if s.empty:
            return {"n": 0, "mean": None, "median": None, "double_rate": None,
                    "halve_rate": None, "pos_rate": None}
        return {"n": len(s), "mean": float(s.mean()), "median": float(s.median()),
                "double_rate": float((s >= 1).mean()), "halve_rate": float((s <= -0.5).mean()),
                "pos_rate": float((s >= 0).mean())}
    sb, ub = base(v), base(u)
    summary = {
        "start": usable[0].isoformat(), "end": horizon[usable[-1]].isoformat(),
        "cohorts": len(usable), "hold_months": p.hold_months,
        "observations": sb["n"], "mean_return": sb["mean"], "median_return": sb["median"],
        "double_rate": sb["double_rate"], "halve_rate": sb["halve_rate"],
        "pos_rate": sb["pos_rate"],
        "beat_bench_rate": float((pd.Series(excess) > 0).mean()) if excess else None,
        "bench_mean_return": float(np.mean(bench_rets)) if bench_rets else None,
        "universe_observations": ub["n"], "universe_mean_return": ub["mean"],
        "universe_median_return": ub["median"], "universe_double_rate": ub["double_rate"],
        "universe_halve_rate": ub["halve_rate"],
        "excess_mean_vs_bench": (sb["mean"] - float(np.mean(bench_rets)))
        if sb["mean"] is not None and bench_rets else None,
        "excess_median_vs_universe": (sb["median"] - ub["median"])
        if sb["median"] is not None and ub["median"] is not None else None,
        "avg_holdings": float(np.mean([r["n_held"] for r in periods])) if periods else 0.0,
        "periods": len(periods),
        "unique_names": len({h["permaticker"] for r in periods for h in r["holdings"]}),
    }
    if not pool:
        warnings.append(_w("warn", "never-invested",
                           "No cohort contained a tradable passer — nothing was measured."))
    series = {"strategy": _pts(s_pts), "benchmark": _pts(b_pts), "universe": _pts(u_pts)}
    return Result(p, spec, summary, series, periods, warnings, "forward_return")


def run(session: Session, p: Params, say: Say = print,
        prebuilt: pd.DataFrame | None = None) -> Result:
    """Load the screen, resolve dates, dispatch on kind. `prebuilt`: a cached panel whose
    dates are reused instead of rebuilt (see `panel_for`)."""
    spec = screens.load_screen(p.screen)
    latest = scalar(session, "SELECT max(date) FROM sep")
    if latest is None:
        raise ValueError("`sep` is empty — load prices before backtesting.")
    p.end = min(_d(p.end), latest).isoformat() if p.end else latest.isoformat()
    if _d(p.start) >= _d(p.end):
        raise ValueError(f"start {p.start} is not before end {p.end}.")
    if p.kind == "portfolio":
        return run_portfolio(session, p, spec, say, prebuilt)
    if p.kind == "cohort":
        return run_cohort(session, p, spec, say, prebuilt)
    raise ValueError(f"kind must be portfolio or cohort, got {p.kind!r}")


# ----------------------------------------------------------------------------- sanity


def _w(level: str, code: str, message: str) -> dict[str, str]:
    return {"level": level, "code": code, "message": message}


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def _pts(points: list[tuple[date, float]]) -> list[dict[str, Any]]:
    return [{"date": d.isoformat(), "value": float(v)} for d, v in points]


def _sanity_period(row: dict[str, Any], warnings: list[dict[str, str]]) -> None:
    """Flag implausible numbers instead of passing them silently."""
    for h in row["holdings"]:
        if h["entry_px"] is None or not h["entry_px"] > 0 or not (h["exit_px"] or 0) > 0:
            warnings.append(_w("warn", "bad-price",
                               f"{row['start']}: {h['ticker']} ({h['permaticker']}) has a "
                               f"non-positive price (entry {h['entry_px']}, exit "
                               f"{h['exit_px']}) — check the data."))
        elif h["ret"] is not None and h["ret"] > NAME_RETURN_MAX:
            warnings.append(_w("warn", "outlier-return",
                               f"{row['start']} → {row['end']}: {h['ticker']} "
                               f"({h['permaticker']}) returned {h['ret'] * 100:+.0f}% — verify "
                               "against a known source (split/adjustment errors look like this)."))
    r = row.get("ret_gross")
    lo, hi = PERIOD_RETURN_BOUNDS
    if r is not None and not (lo <= r <= hi):
        warnings.append(_w("warn", "implausible-period",
                           f"{row['start']} → {row['end']}: basket return {r * 100:+.1f}% is "
                           f"outside the plausible range [{lo:+.0%}, {hi:+.0%}]."))
    if row.get("n_stopped"):
        warnings.append(_w("info", "stopped-trading",
                           f"{row['start']} → {row['end']}: {row['n_stopped']} holding(s) "
                           "stopped trading mid-period and are valued at their last print "
                           "(a buyout's cash-out, or a bust's final trade)."))


def _sanity_bench(summary: dict[str, Any], warnings: list[dict[str, str]]) -> None:
    c = summary.get("bench_cagr")
    lo, hi = BENCH_CAGR_BOUNDS
    if c is not None and summary.get("years", 0) >= 3 and not (lo <= c <= hi):
        warnings.append(_w("warn", "benchmark-implausible",
                           f"Benchmark CAGR {c * 100:.1f}% is outside [{lo:.0%}, {hi:.0%}] — "
                           "reconcile the benchmark series before trusting any comparison."))
