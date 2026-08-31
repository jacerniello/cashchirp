"""Counterfactual S&P 500 index lab — "how would the index have done *without* X?"

Reconstructs the S&P 500 as a **monthly-rebalanced, cap-weighted total-return
index** from its own constituents, so you can drop any set of companies and/or
sectors and re-run history on the survivors (weights renormalised), or flip to
equal-weight. The use case: *how much of the index's return was just the Mag-7?
what does the market look like ex-Energy? ex-Financials through 2008?*

### How it works

A precomputed monthly panel, ``sp500_member_months`` — one row per
``(month, permaticker)`` the name was an S&P 500 member — carries everything a
backtest needs:

- ``ret``        — the constituent's **total return that month** (from `sep.closeadj`,
                   which is split- *and* dividend-adjusted), and
- ``weight_cap`` — its **begin-of-month** market cap (the prior month-end
                   `daily.marketcap`), i.e. the cap-weight basis for *this* month's
                   return. Baking the one-month lag into the panel makes the read
                   side a pure group-by.

The index is then chain-linked at read time: for each month, take the surviving
members (after exclusions), set weights ``wᵢ = weight_capᵢ / Σ weight_cap`` (or
``1/N`` for equal-weight), and the month's index return is ``Σ wᵢ·retᵢ``; compound
across months for the cumulative level. **Removing a company or sector is just a
filter + renormalise** — identical machinery for the baseline and every scenario,
so the methodology bias cancels in the comparison.

### Fidelity

This is a *faithful reconstruction*, not the official index: it uses **full** market
cap (Sharadar has no float) and **quarterly** membership snapshots forward-filled to
months. Validated against SPY total return — 0.96 monthly-return correlation, CAGR
within ~0.7%/yr over 28 years (the gap is the float/rebalance difference, documented
not faked). For scenario-vs-baseline questions that residual cancels. Cap-weighted by
construction, so it leans large-cap; equal-weight is offered as the breadth contrast.

Built by ``python -m core.scripts.build.build_sp500_member_months`` (and the orchestrator);
Pure cache — never hand-edit. There is no app-startup rebuild: run the builder (or the
ortherwise-scheduled orchestrator) after membership advances.
"""
from __future__ import annotations

import threading
import time

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.backend.db.engine import engine
from core.backend.queries._common import query_df, scalar
from core.backend.queries._rebuild import (
    LOCK_SP500_MEMBER_MONTHS,
    NEW,
    live_count,
    single_flight,
    swap_in,
)

_TABLE = "sp500_member_months"
# Constituents ever in the index — the only securities we need price/cap history for.
_MEMBER_SET = "(SELECT DISTINCT permaticker FROM sp500 WHERE action IN ('historical','current'))"

# In-process cache of the (small) panel so a backtest is a pandas group-by, not a
# 250k-row re-read. Keyed on the panel's asof.
_CACHE: dict = {"key": None, "df": None, "ts": 0.0}
_LOCK = threading.Lock()
_TTL = 1800


def _membership_asof(session: Session):
    return scalar(session, "SELECT max(date) FROM sp500 WHERE action IN ('historical','current')")


# --- build -----------------------------------------------------------------

def _build_panel(session: Session, asof) -> pd.DataFrame:
    """Assemble the monthly member panel in pandas (one heavy pull each for prices
    and caps, then vectorised returns + lagged weights + monthly membership)."""
    conn = session.connection()
    # Month-end total-return close per ever-member (the last trading day of each month).
    closeadj = query_df(session, f"""
        SELECT DISTINCT ON (permaticker, date_trunc('month', date))
               permaticker, date_trunc('month', date)::date AS month, closeadj
        FROM sep
        WHERE permaticker IN {_MEMBER_SET} AND date >= '1997-12-01' AND closeadj > 0
        ORDER BY permaticker, date_trunc('month', date), date DESC
    """)
    # Month-end market cap per ever-member (the cap-weight basis).
    mcap = query_df(session, f"""
        SELECT DISTINCT ON (permaticker, date_trunc('month', date))
               permaticker, date_trunc('month', date)::date AS month, marketcap
        FROM daily
        WHERE permaticker IN {_MEMBER_SET} AND date >= '1997-12-01' AND marketcap > 0
        ORDER BY permaticker, date_trunc('month', date), date DESC
    """)
    # Quarterly membership snapshots, forward-filled to months below.
    memb = query_df(session, "SELECT date::date AS snap, permaticker FROM sp500 WHERE action='historical'")
    ref = query_df(session, """
        SELECT DISTINCT ON (permaticker) permaticker::bigint AS permaticker, ticker, name,
               COALESCE(sector, 'Unknown') AS sector
        FROM tickers WHERE permaticker IS NOT NULL
        ORDER BY permaticker, CASE "table" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 ELSE 2 END
    """)
    if closeadj.empty:
        return pd.DataFrame()

    # This-month total return + begin-of-month (prior month-end) cap, per name.
    closeadj = closeadj.sort_values(["permaticker", "month"])
    closeadj["ret"] = closeadj.groupby("permaticker")["closeadj"].pct_change()
    mcap = mcap.sort_values(["permaticker", "month"])
    mcap["weight_cap"] = mcap.groupby("permaticker")["marketcap"].shift(1)  # prior month-end

    panel = closeadj.merge(
        mcap[["permaticker", "month", "weight_cap"]], on=["permaticker", "month"], how="inner"
    )
    panel = panel.dropna(subset=["ret", "weight_cap"])
    panel = panel[panel["weight_cap"] > 0]

    # Monthly membership: a name is "in" for month m if the latest snapshot on/before
    # m's month-end included it. Build an interval map by forward-filling snapshots.
    snaps = sorted(memb["snap"].unique())
    members_by_snap = {s: set(memb.loc[memb["snap"] == s, "permaticker"]) for s in snaps}
    snaps_arr = np.array(snaps)

    def member_set_for(month_start: pd.Timestamp) -> set:
        # month-end = last day of that month; prevailing snapshot is the latest <= month-end
        month_end = (pd.Timestamp(month_start) + pd.offsets.MonthEnd(0)).date()
        idx = np.searchsorted(snaps_arr, np.datetime64(month_end), side="right") - 1
        return members_by_snap[snaps[idx]] if idx >= 0 else set()

    keep_rows = []
    for month, grp in panel.groupby("month"):
        mset = member_set_for(month)
        if not mset:
            continue
        keep_rows.append(grp[grp["permaticker"].isin(mset)])
    if not keep_rows:
        return pd.DataFrame()
    out = pd.concat(keep_rows, ignore_index=True)
    out = out.merge(ref, on="permaticker", how="left")
    out["sector"] = out["sector"].fillna("Unknown")
    out["asof"] = asof
    return out[["month", "permaticker", "ticker", "name", "sector", "weight_cap", "ret", "asof"]]


def refresh_member_months(session: Session) -> int:
    """Rebuild `sp500_member_months` and return its row count. Idempotent — safe after
    every SP500/SEP/DAILY load. Single-flight + atomic swap like the other derived
    tables; the heavy part is two month-end pulls off `sep`/`daily` (~1 min)."""
    asof = _membership_asof(session)
    with single_flight(LOCK_SP500_MEMBER_MONTHS) as mine:
        if not mine:
            return live_count(_TABLE)
        df = _build_panel(session, asof)
        df.to_sql(f"{_TABLE}{NEW}", engine, if_exists="replace", index=False)
        with engine.begin() as conn:
            conn.execute(text(f"CREATE INDEX ix_{_TABLE}_month{NEW} ON {_TABLE}{NEW} (month)"))
            swap_in(conn, _TABLE, ((f"ix_{_TABLE}_month{NEW}", f"ix_{_TABLE}_month"),))
        with _LOCK:
            _CACHE.update(key=str(asof), df=df, ts=time.time())
        return len(df)


# --- read side -------------------------------------------------------------

def _panel(session: Session) -> pd.DataFrame:
    """The member-month panel, from the in-process cache or the table."""
    key = str(_membership_asof(session))
    with _LOCK:
        if _CACHE["df"] is not None and _CACHE["key"] == key and time.time() - _CACHE["ts"] < _TTL:
            return _CACHE["df"]
    df = query_df(session, f"SELECT * FROM {_TABLE}")
    df["month"] = pd.to_datetime(df["month"])
    with _LOCK:
        _CACHE.update(key=key, df=df, ts=time.time())
    return df


def options(session: Session) -> dict:
    """Controls for the lab UI: the sector list, the largest current constituents (the
    default company picker), **every** name that was *ever* a member (so the picker can
    search point-in-time — Cisco/GE/Intel, not just today's leaders — which guards
    against the hindsight of only being able to remove today's winners), and the
    available month range."""
    df = _panel(session)
    if df.empty:
        return {"sectors": [], "companies": [], "all_members": [], "start": None, "end": None}
    sectors = sorted(s for s in df["sector"].unique() if s)
    last_month = df["month"].max()
    latest = df[df["month"] == last_month].copy()
    latest = latest.sort_values("weight_cap", ascending=False).head(60)
    companies = [
        {"permaticker": int(r.permaticker), "ticker": r.ticker, "name": r.name, "sector": r.sector}
        for r in latest.itertuples()
    ]
    ever = (df[["permaticker", "ticker", "name", "sector"]]
            .drop_duplicates("permaticker").sort_values("ticker"))
    all_members = [
        {"permaticker": int(r.permaticker), "ticker": r.ticker, "name": r.name, "sector": r.sector}
        for r in ever.itertuples()
    ]
    return {
        "sectors": sectors,
        "companies": companies,
        "all_members": all_members,
        "start": df["month"].min().strftime("%Y-%m-%d"),
        "end": last_month.strftime("%Y-%m-%d"),
    }


def _level_series(monthly_ret: pd.Series) -> pd.Series:
    """Chain-link monthly returns into a cumulative level rebased to 100 at the start."""
    return 100.0 * (1.0 + monthly_ret).cumprod()


def _stats(monthly_ret: pd.Series) -> dict:
    """Headline performance/risk stats for a monthly return series."""
    if monthly_ret.empty:
        return {}
    level = (1.0 + monthly_ret).cumprod()
    total = float(level.iloc[-1])
    n_years = len(monthly_ret) / 12.0
    cagr = total ** (1.0 / n_years) - 1.0 if n_years > 0 and total > 0 else None
    vol = float(monthly_ret.std() * np.sqrt(12)) if len(monthly_ret) > 1 else None
    drawdown = level / level.cummax() - 1.0
    return {
        "total_return": total - 1.0,
        "cagr": cagr,
        "vol": vol,
        "max_drawdown": float(drawdown.min()),
        "sharpe_naive": (float(cagr) / vol) if (cagr is not None and vol) else None,
        "best_month": float(monthly_ret.max()),
        "worst_month": float(monthly_ret.min()),
        "n_months": int(len(monthly_ret)),
    }


def _index_return(sub: pd.DataFrame, equal_weight: bool) -> pd.Series:
    """Monthly index return from a (filtered) panel slice: per month, renormalise the
    surviving members' weights and take the weighted mean return."""
    if sub.empty:
        return pd.Series(dtype=float)
    w_raw = pd.Series(1.0, index=sub.index) if equal_weight else sub["weight_cap"]
    totals = w_raw.groupby(sub["month"]).transform("sum")
    contrib = (w_raw / totals) * sub["ret"]
    return contrib.groupby(sub["month"]).sum().sort_index()


def backtest(
    session: Session,
    exclude_sectors: list[str] | None = None,
    exclude_permatickers: list[int] | None = None,
    equal_weight: bool = False,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Reconstruct the baseline index and a scenario index with the given companies /
    sectors removed, plus the *removed-only* sleeve, over an optional date window.

    Returns rebased (=100) level series for each, the headline stats, and the set of
    names actually excluded — everything the lab page renders."""
    df = _panel(session)
    if df.empty:
        return {"baseline": [], "scenario": [], "removed": [], "gap": [], "stats": {}, "excluded": []}

    if start:
        df = df[df["month"] >= pd.Timestamp(start)]
    if end:
        df = df[df["month"] <= pd.Timestamp(end)]
    if df.empty:
        return {"baseline": [], "scenario": [], "removed": [], "gap": [], "stats": {}, "excluded": []}

    excl_sectors = set(exclude_sectors or [])
    excl_pts = set(int(p) for p in (exclude_permatickers or []))
    excluded_mask = df["sector"].isin(excl_sectors) | df["permaticker"].isin(excl_pts)

    baseline_ret = _index_return(df, equal_weight)
    scenario_ret = _index_return(df[~excluded_mask], equal_weight)
    removed_ret = _index_return(df[excluded_mask], equal_weight)

    def to_points(level: pd.Series) -> list[dict]:
        return [{"date": d.strftime("%Y-%m-%d"), "level": round(float(v), 3)}
                for d, v in level.items()]

    # Cumulative performance gap = how far the full index has pulled ahead of (or behind)
    # the ex-removed scenario, as a % — the running contribution of the removed names.
    # gapₜ = (Π(1+baseline) / Π(1+scenario) − 1)·100 over the window; >0 means the
    # removed set has lifted the index. Starts at the first month's difference.
    gap: list[dict] = []
    if excluded_mask.any() and not scenario_ret.empty:
        common = baseline_ret.index.intersection(scenario_ret.index)
        bl = (1.0 + baseline_ret.loc[common]).cumprod()
        sl = (1.0 + scenario_ret.loc[common]).cumprod()
        g = (bl / sl - 1.0) * 100.0
        gap = [{"date": d.strftime("%Y-%m-%d"), "pct": round(float(v), 3)} for d, v in g.items()]

    # Names actually removed (for the UI's "what you took out" summary).
    removed_names = (
        df[excluded_mask][["permaticker", "ticker", "name", "sector"]]
        .drop_duplicates("permaticker")
        .sort_values("ticker")
    )
    excluded = [
        {"permaticker": int(r.permaticker), "ticker": r.ticker, "name": r.name, "sector": r.sector}
        for r in removed_names.itertuples()
    ]

    return {
        "baseline": to_points(_level_series(baseline_ret)),
        "scenario": to_points(_level_series(scenario_ret)) if not scenario_ret.empty else [],
        "removed": to_points(_level_series(removed_ret)) if not removed_ret.empty else [],
        "gap": gap,
        "stats": {
            "baseline": _stats(baseline_ret),
            "scenario": _stats(scenario_ret),
            "removed": _stats(removed_ret),
        },
        "excluded": excluded,
        "equal_weight": equal_weight,
        "n_excluded": len(excluded),
    }
