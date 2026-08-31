"""Point-in-time backtest harness — "expectation vs. reality."

Reconstructs the fundamentals snapshot **as it was known on an as-of date** (no look-ahead),
so a screen can be run with only the information available then, and the **realized forward
return** measured against it. This is the project's validation discipline made executable.

Two anti-cheating rules enforced here:
  1. **No look-ahead in fundamentals** — `sf1` rows are gated by `datekey <= asof` (datekey is
     the SEC filing date, i.e. when the figure became public). We take the latest such row.
  2. **No survivorship bias in the universe** — the universe is every security with a *price*
     at the as-of date (not filtered by today's delisted flag). Forward return uses the last
     available adjusted close, so names that later cratered or delisted carry their loss.

Returns use `closeadj` (dividend-adjusted) = total return.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries.discovery import screener
from core.backend.queries._common import query_df, scalar
from core.backend import screens


# Point-in-time raw snapshot for the **idea screen** specifically: the same column set
# `screener._snapshot_sql` produces, but reconstructed as-of a historical date so the screen
# can be re-run with only the data known then. Two changes vs the live builder:
#   • Fundamentals (sf1 ART/ARQ/ARY) are gated by `datekey <= :asof` (the filing date) and the
#     latest *filed* row is taken — no look-ahead. The growth lags still order by calendardate.
#   • Valuation comes from `daily` as-of `:asof` (latest row on/before), so multiples reflect
#     the price we'd actually pay then. `daily` is itself point-in-time (it only knows filed
#     fundamentals) and carries delisted names' history, so the universe is survivorship-free.
# The 52-week price band / institutional fields aren't screen gates, so they're left NULL.
_SCREEN_ASOF_SQL = """
WITH d AS (
    -- Valuation as-of asof, but only from a *recent* row (within ~3 weeks): a name's last
    -- daily print being years before asof means it had already delisted — admitting that
    -- stale row would resurrect zombies into the universe and measure returns off a dead
    -- price. The window is what makes "trading at asof" (alive) the real survivorship gate.
    SELECT DISTINCT ON (permaticker) permaticker, marketcap, ev, pe, ps, pb, evebitda
    FROM daily
    WHERE permaticker IS NOT NULL
      AND date <= CAST(:asof AS date) AND date >= CAST(:asof AS date) - 21
    ORDER BY permaticker, date DESC
),
art AS (
    SELECT DISTINCT ON (permaticker) permaticker,
           revenue, cashneq, debt, fcf, opinc, grossmargin, netmargin, roe, roa, roic,
           currentratio, de, debtnc, equity, assetsc, inventory, liabilitiesc, payoutratio,
           divyield, eps, dps, assets, liabilities, workingcapital, retearn, ebit,
           eps_1y, revenue_1y
    FROM (
        SELECT permaticker, calendardate, datekey, revenue, cashneq, debt, fcf, opinc,
               grossmargin, netmargin, roe, roa, roic, currentratio, de, debtnc, equity,
               assetsc, inventory, liabilitiesc, payoutratio, divyield, eps, dps,
               assets, liabilities, workingcapital, retearn, ebit,
               lag(eps, 4) OVER w AS eps_1y, lag(revenue, 4) OVER w AS revenue_1y
        FROM sf1 WHERE dimension = 'ART' AND permaticker IS NOT NULL AND datekey <= :asof
        WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
    ) z ORDER BY permaticker, (revenue IS NULL), datekey DESC
),
arq AS (
    SELECT DISTINCT ON (permaticker) permaticker, eps AS eps_q, eps_q1y, revenue AS rev_q, rev_q1y
    FROM (
        SELECT permaticker, calendardate, datekey, eps, revenue,
               lag(eps, 4) OVER w AS eps_q1y, lag(revenue, 4) OVER w AS rev_q1y
        FROM sf1 WHERE dimension = 'ARQ' AND permaticker IS NOT NULL AND datekey <= :asof
        WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
    ) z ORDER BY permaticker, datekey DESC
),
ary AS (
    SELECT DISTINCT ON (permaticker) permaticker,
           eps AS eps_y, eps_y1, eps_y3, eps_y5, revenue AS rev_y, rev_y1, rev_y3, rev_y5,
           dps AS dps_y, dps_y3, shareswadil AS shares_y, shares_y5
    FROM (
        SELECT permaticker, calendardate, datekey, eps, revenue, dps, shareswadil,
               lag(eps, 1) OVER w AS eps_y1, lag(eps, 3) OVER w AS eps_y3,
               lag(eps, 5) OVER w AS eps_y5,
               lag(revenue, 1) OVER w AS rev_y1, lag(revenue, 3) OVER w AS rev_y3,
               lag(revenue, 5) OVER w AS rev_y5,
               lag(dps, 3) OVER w AS dps_y3, lag(shareswadil, 5) OVER w AS shares_y5
        FROM sf1 WHERE dimension = 'ARY' AND permaticker IS NOT NULL AND datekey <= :asof
        WINDOW w AS (PARTITION BY permaticker ORDER BY calendardate)
    ) z ORDER BY permaticker, (revenue IS NULL), datekey DESC
),
m AS (
    SELECT DISTINCT ON (permaticker) permaticker::bigint AS permaticker, ticker, name,
           sector, industry, exchange, scalemarketcap, isdelisted, firstpricedate
    FROM tickers WHERE permaticker IS NOT NULL
    ORDER BY permaticker, CASE "table" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 ELSE 2 END
)
SELECT m.permaticker, m.ticker, m.name, m.sector, m.industry, m.exchange,
       m.scalemarketcap, m.isdelisted, m.firstpricedate,
       d.marketcap * 1e6 AS marketcap, d.ev * 1e6 AS ev,
       d.pe, d.ps, d.pb, d.evebitda AS ev_ebitda,
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
       NULL::double precision AS m_price,
       NULL::double precision AS high52w, NULL::double precision AS low52w
FROM m
JOIN d   ON d.permaticker   = m.permaticker      -- trading at asof ⇒ alive (survivorship gate)
LEFT JOIN art ON art.permaticker = m.permaticker
LEFT JOIN arq ON arq.permaticker = m.permaticker
LEFT JOIN ary ON ary.permaticker = m.permaticker
"""


def screen_snapshot_asof(session: Session, asof: str) -> pd.DataFrame:
    """Full point-in-time metrics snapshot for the idea screen, as-of `asof`. Reuses the live
    `screener._derive` so every derived metric (Altman Z, growth, net-cash, etc.) is computed
    identically to production — only the data vintage differs. Feed to `run_screen_asof`."""
    raw = query_df(session, _SCREEN_ASOF_SQL, {"asof": asof})
    return screener._derive(raw) if not raw.empty else raw


def run_screen_asof(session: Session, asof: str, spec: dict | None = None) -> pd.DataFrame:
    """The idea screen (`screener.screen_candidates`) applied to the as-of snapshot. Survivorship
    is handled by the snapshot (only names trading at `asof`), so the today's-`isdelisted` gate
    is switched off. Returns the surviving rows — the basket we'd have held entering `asof`."""
    snap = screen_snapshot_asof(session, asof)
    if snap.empty:
        return snap
    return screener.screen_candidates(snap, drop_delisted=False, spec=spec)


def forward_returns(
    session: Session, permatickers: list[int], asof: str, end: str | None = None
) -> pd.DataFrame:
    """Realized total return per security from `asof` to `end` (default: latest data).

    Entry = last adjusted close on/before `asof`; exit = last adjusted close on/before `end`
    (or overall). Delisted names carry their final price, so busts are not silently dropped.
    """
    if not permatickers:
        return pd.DataFrame(columns=["permaticker", "p0", "p1", "exit_date", "ret"])
    sql = """
    WITH u AS (SELECT unnest(CAST(:pts AS bigint[])) AS permaticker),
    entry AS (
        SELECT DISTINCT ON (s.permaticker) s.permaticker, s.closeadj AS p0
        FROM sep s JOIN u USING (permaticker)
        WHERE s.date <= CAST(:asof AS date)
        ORDER BY s.permaticker, s.date DESC
    ),
    ex AS (
        SELECT DISTINCT ON (s.permaticker) s.permaticker, s.closeadj AS p1, s.date AS exit_date
        FROM sep s JOIN u USING (permaticker)
        WHERE (CAST(:end AS date) IS NULL OR s.date <= CAST(:end AS date))
        ORDER BY s.permaticker, s.date DESC
    )
    SELECT entry.permaticker, entry.p0, ex.p1, ex.exit_date,
           (ex.p1 / entry.p0 - 1) AS ret
    FROM entry JOIN ex USING (permaticker)
    WHERE entry.p0 > 0 AND ex.p1 IS NOT NULL
    """
    return query_df(session, sql, {"pts": list(permatickers), "asof": asof, "end": end})


# --- quarterly portfolio backtest (experiment 018, Test A) ------------------
# Equal-weight the idea screen, re-screened quarterly, vs the equal-weight *eligible universe*
# (everything passing the size + sector gates but NOT the quality/value gates) — so the
# comparison isolates the filter's contribution from small-cap beta. Survivorship-free and
# point-in-time by construction (built on screen_snapshot_asof / forward_returns).


def _eligible(snap: pd.DataFrame, spec: dict | None = None) -> pd.DataFrame:
    """The benchmark universe from a PIT snapshot: the active screen's universe exclusions
    and size band only — the gates that define *what we'd consider* — without its
    quality/value gates. Derived from the same spec the screen runs, so the strategy-vs-
    benchmark spread measures the filter's contribution and not a size or sector tilt."""
    spec = spec or screens.active_screen()
    uni = {"universe": spec.get("universe") or {}}
    uni["universe"]["exclude_delisted"] = False   # PIT snapshots are already survivorship-free
    cap = (spec.get("gates") or {}).get("marketcap")
    if cap:
        uni["gates"] = {"marketcap": cap}
    return screens.apply_screen(snap, uni)


# A per-quarter loop that re-queries `sf1`/`sep` from scratch is ~3 hours over two decades
# (the window-lag scans and 2,000-name forward-return joins dominate). Instead we precompute,
# in a handful of queries, the panels the backtest needs and run the rest in pandas:
#   • fundamentals as-of every quarter, via **validity-window joins** — the lag windows are
#     computed ONCE over all of `sf1`, then each filing is matched to the quarters its
#     `[datekey, next_datekey)` covers (no per-quarter re-scan, no look-ahead).
#   • valuation per quarter from `daily` within 21 days of the quarter-end (the alive gate).
#   • a quarter-end price panel from `sep` (total-return `closeadj`, plus price/ADV for the
#     liquidity floor) in one pass.
# `screener._derive` + `screen_candidates` then run on the whole stacked panel exactly as live.

def _build_panels(session: Session, grid: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (derived screen panel keyed (q, permaticker), quarter-end price panel)."""
    val = query_df(session, """
        WITH g AS (SELECT unnest(CAST(:g AS date[])) AS q)
        SELECT DISTINCT ON (da.permaticker, g.q) g.q, da.permaticker,
               da.marketcap*1e6 AS marketcap, da.ev*1e6 AS ev, da.pe, da.ps, da.pb,
               da.evebitda AS ev_ebitda
        FROM g JOIN daily da ON da.date <= g.q AND da.date > g.q - 21
        WHERE da.permaticker IS NOT NULL
        ORDER BY da.permaticker, g.q, da.date DESC
    """, {"g": grid})
    art = query_df(session, """
        WITH g AS (SELECT unnest(CAST(:g AS date[])) AS q),
        w AS (
            SELECT permaticker, datekey,
                   lead(datekey) OVER (PARTITION BY permaticker ORDER BY datekey) AS next_dk,
                   revenue, cashneq, debt, fcf, opinc, grossmargin, netmargin, roe, roa, roic,
                   currentratio, de, debtnc, equity, assetsc, inventory, liabilitiesc,
                   payoutratio, divyield, eps, dps, assets, liabilities, workingcapital,
                   retearn, ebit,
                   lag(eps, 4) OVER c AS eps_1y, lag(revenue, 4) OVER c AS revenue_1y
            FROM sf1 WHERE dimension='ART' AND permaticker IS NOT NULL AND revenue IS NOT NULL
            WINDOW c AS (PARTITION BY permaticker ORDER BY calendardate)
        )
        SELECT g.q, w.permaticker, w.revenue, w.cashneq, w.debt, w.fcf, w.opinc, w.grossmargin,
               w.netmargin, w.roe, w.roa, w.roic, w.currentratio, w.de, w.debtnc, w.equity,
               w.assetsc, w.inventory, w.liabilitiesc, w.payoutratio, w.divyield, w.eps, w.dps,
               w.assets, w.liabilities, w.workingcapital, w.retearn, w.ebit, w.eps_1y, w.revenue_1y
        FROM g JOIN w ON w.datekey <= g.q AND (w.next_dk IS NULL OR w.next_dk > g.q)
    """, {"g": grid})
    ary = query_df(session, """
        WITH g AS (SELECT unnest(CAST(:g AS date[])) AS q),
        w AS (
            SELECT permaticker, datekey,
                   lead(datekey) OVER (PARTITION BY permaticker ORDER BY datekey) AS next_dk,
                   eps AS eps_y, revenue AS rev_y, dps AS dps_y, shareswadil AS shares_y,
                   lag(eps,1) OVER c AS eps_y1, lag(eps,3) OVER c AS eps_y3,
                   lag(eps,5) OVER c AS eps_y5, lag(revenue,1) OVER c AS rev_y1,
                   lag(revenue,3) OVER c AS rev_y3, lag(revenue,5) OVER c AS rev_y5,
                   lag(dps,3) OVER c AS dps_y3, lag(shareswadil,5) OVER c AS shares_y5
            FROM sf1 WHERE dimension='ARY' AND permaticker IS NOT NULL AND revenue IS NOT NULL
            WINDOW c AS (PARTITION BY permaticker ORDER BY calendardate)
        )
        SELECT g.q, w.permaticker, w.eps_y, w.eps_y1, w.eps_y3, w.eps_y5, w.rev_y, w.rev_y1,
               w.rev_y3, w.rev_y5, w.dps_y, w.dps_y3, w.shares_y, w.shares_y5
        FROM g JOIN w ON w.datekey <= g.q AND (w.next_dk IS NULL OR w.next_dk > g.q)
    """, {"g": grid})
    master = query_df(session, """
        SELECT DISTINCT ON (permaticker) permaticker::bigint AS permaticker, ticker, name,
               sector, industry, exchange, scalemarketcap, isdelisted, firstpricedate
        FROM tickers WHERE permaticker IS NOT NULL
        ORDER BY permaticker, CASE "table" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 ELSE 2 END
    """)
    px = query_df(session, """
        SELECT permaticker,
               (date_trunc('quarter', date) + interval '3 months - 1 day')::date AS q,
               (array_agg(closeadj ORDER BY date DESC))[1] AS px,
               (array_agg(closeunadj ORDER BY date DESC))[1] AS px_unadj,
               avg(closeunadj * volume) AS adv
        FROM sep WHERE permaticker IS NOT NULL GROUP BY permaticker, q
    """)
    for d in (val, art, ary, px):
        d["q"] = pd.to_datetime(d["q"])

    raw = val.merge(art, on=["q", "permaticker"], how="left") \
             .merge(ary, on=["q", "permaticker"], how="left") \
             .merge(master, on="permaticker", how="left")
    for col in ("m_price", "high52w", "low52w", "eps_q", "eps_q1y", "rev_q", "rev_q1y"):
        raw[col] = np.nan  # not screen gates; present only so _derive doesn't KeyError
    derived = screener._derive(raw)
    # years_public must be measured **as-of the quarter**, not today (else a 2010 IPO would
    # pass the ≥5y gate in 2011). Override _derive's now()-based value.
    derived["years_public"] = (
        (derived["q"] - pd.to_datetime(derived["firstpricedate"])).dt.days / 365.25)
    return derived, px


def portfolio_backtest(
    session: Session, start: str = "2004-12-31", end: str | None = None,
    cost_bps: float = 30.0, min_price: float = 3.0, min_dollar_adv: float = 1e6,
    min_names: int = 8,
    spec: dict | None = None,
) -> pd.DataFrame:
    """Quarterly EW screen-vs-eligible-universe backtest (panel-based; see `_build_panels`).
    Returns a per-quarter frame (entry → next quarter): basket size, EW gross/net strat return,
    EW benchmark return, turnover. `cost_bps` is charged on turnover (one-way fraction of book
    replaced). Quarters with < `min_names` liquid passers are skipped (too thin to equal-weight).
    """
    if end is None:
        end = str(scalar(session, "SELECT max(date) FROM sep"))
    grid = [d.date().isoformat() for d in pd.date_range(start, end, freq="QE")]
    derived, px = _build_panels(session, grid)

    spec = spec or screens.active_screen()
    passed = screener.screen_candidates(derived, drop_delisted=False, spec=spec)
    elig = _eligible(derived, spec)
    liq = px[(px["px_unadj"] >= min_price) & (px["adv"] >= min_dollar_adv)]
    liq_by_q = {q: set(d["permaticker"].astype(int)) for q, d in liq.groupby("q")}
    pass_by_q = {q: set(d["permaticker"].astype(int)) for q, d in passed.groupby("q")}
    elig_by_q = {q: set(d["permaticker"].astype(int)) for q, d in elig.groupby("q")}
    pxmat = px.pivot(index="permaticker", columns="q", values="px")

    # Iterate the grid quarters only (the price panel spans all history); they're contiguous
    # quarter-ends, so zip(qs[:-1], qs[1:]) pairs each entry with the next quarter's exit.
    qs = sorted(set(pd.to_datetime(grid)) & set(pxmat.columns))
    recs, prev = [], set()
    for t, tn in zip(qs[:-1], qs[1:]):
        liq_t = liq_by_q.get(t, set())
        bp = pass_by_q.get(t, set()) & liq_t
        ep = elig_by_q.get(t, set()) & liq_t
        if len(bp) < min_names:
            prev = bp
            continue
        rets = (pxmat[tn] / pxmat[t] - 1)  # total return over [t, tn], per permaticker
        rs = rets.reindex(list(bp)).dropna()
        rb = rets.reindex(list(ep)).dropna()
        if rs.empty:
            prev = bp
            continue
        turnover = 1.0 if not prev else 1.0 - len(bp & prev) / len(bp)
        recs.append({
            "date": tn.date().isoformat(), "n": len(bp), "n_priced": len(rs),
            "strat": float(rs.mean()), "strat_net": float(rs.mean()) - cost_bps / 1e4 * turnover,
            "bench": float(rb.mean()) if not rb.empty else np.nan,
            "n_bench": len(rb), "turnover": turnover,
        })
        prev = bp
    return pd.DataFrame(recs).set_index("date")


def perf_stats(r: pd.Series, ppy: int = 4) -> dict:
    """Annualised performance of a periodic (default quarterly) return series."""
    r = r.dropna()
    if r.empty:
        return {}
    nav = (1 + r).cumprod()
    years = len(r) / ppy
    vol = r.std(ddof=1) * np.sqrt(ppy)
    return {
        "periods": len(r),
        "total_return": float(nav.iloc[-1] - 1),
        "cagr": float(nav.iloc[-1] ** (1 / years) - 1),
        "vol_ann": float(vol),
        "sharpe": float((r.mean() * ppy) / vol) if vol > 0 else np.nan,
        "max_drawdown": float((nav / nav.cummax() - 1).min()),
        "best_q": float(r.max()), "worst_q": float(r.min()),
    }


# --- cohort / event study (experiment 018, Test B) --------------------------
# The portfolio backtest asks "does the strategy compound?"; this asks the screen's actual
# claim — "do its names DOUBLE more often than the universe's?" For every quarter a name
# passes, measure its forward 1/2/3y total return and the base rate of ≥100% (a double),
# pooled, vs the same for the eligible universe. Reuses the PIT panels, so it's the same
# survivorship-free, look-ahead-free data the portfolio test runs on.

def cohort_study(
    session: Session, start: str = "2004-12-31", end: str | None = None,
    horizons_q: tuple[int, ...] = (4, 8, 12), min_price: float = 3.0,
    min_dollar_adv: float = 1e6, spec: dict | None = None,
) -> pd.DataFrame:
    """Pooled forward-return base rates for screen passers vs the eligible universe, at each
    horizon (quarters). Returns one row per (cohort, horizon_y) with median/mean return and the
    rate of doubling (≥100%), tripling (≥200%) and halving (≤−50%). Forward prices are carried
    forward for delisted names (the position is frozen at its last/delisting price)."""
    from collections import defaultdict
    if end is None:
        end = str(scalar(session, "SELECT max(date) FROM sep"))
    grid = [d.date().isoformat() for d in pd.date_range(start, end, freq="QE")]
    derived, px = _build_panels(session, grid)

    spec = spec or screens.active_screen()
    passed = screener.screen_candidates(derived, drop_delisted=False, spec=spec)
    elig = _eligible(derived, spec)
    liq = px[(px["px_unadj"] >= min_price) & (px["adv"] >= min_dollar_adv)]
    liq_by_q = {q: set(d["permaticker"].astype(int)) for q, d in liq.groupby("q")}
    pass_by_q = {q: set(d["permaticker"].astype(int)) for q, d in passed.groupby("q")}
    elig_by_q = {q: set(d["permaticker"].astype(int)) for q, d in elig.groupby("q")}

    pxmat = px.pivot(index="permaticker", columns="q", values="px").sort_index(axis=1)
    pxff = pxmat.ffill(axis=1)   # freeze delisted names at their last price
    cols = list(pxmat.columns)
    pos = {q: i for i, q in enumerate(cols)}
    gridset = sorted(set(pd.to_datetime(grid)) & set(cols))

    pool: dict = defaultdict(list)
    for q in gridset:
        i = pos[q]
        liq_q = liq_by_q.get(q, set())
        cohorts = {"screen": pass_by_q.get(q, set()) & liq_q,
                   "universe": elig_by_q.get(q, set()) & liq_q}
        for cohort, members in cohorts.items():
            if not members:
                continue
            p0 = pxmat[q].reindex(list(members))
            for h in horizons_q:
                if i + h >= len(cols):      # not enough forward data for this horizon
                    continue
                ret = (pxff[cols[i + h]].reindex(list(members)) / p0 - 1)
                pool[(cohort, h // 4)].extend(ret[p0 > 0].dropna().tolist())

    rows = []
    for (cohort, hy), vals in sorted(pool.items()):
        v = pd.Series(vals)
        rows.append({
            "cohort": cohort, "horizon_y": hy, "n": len(v),
            "median": float(v.median()), "mean": float(v.mean()),
            "double_rate": float((v >= 1.0).mean()), "triple_rate": float((v >= 2.0).mean()),
            "halve_rate": float((v <= -0.5).mean()), "pos_rate": float((v >= 0).mean()),
        })
    return pd.DataFrame(rows)
