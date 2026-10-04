"""Does a screen remove losers and keep winners? — gate audit, signal study, comparison.

Everything here is pure pandas over the point-in-time panel (`panel.py`): no database, so a
study re-runs in seconds once the panel is cached.

**The objective** (stated in every report — `OBJECTIVE`). At each yearly rebalance date,
within the screen's universe (its sector/industry exclusions and market-cap band, the
backtest's tradability floor, no look-ahead):

  * primary labels — relative, so they adapt to bull and bear years: a **winner** is in
    the top 20% of forward 24-month total return among that date's universe; a **loser**
    is in the bottom 20%, or stopped trading at a loss inside the window;
  * secondary (absolute) labels: winner = forward 24m ≥ +50% (≈ 22%/yr); loser = ≤ −30%
    or stopped trading at a loss;
  * tails, reported but never optimised on: doubled (≥ +100%), busted (≤ −50%);
  * a 12-month version of the primary labels (top / bottom quintile of forward 12m).

A screen or gate is better when it **removes a large share of losers while keeping a large
share of winners**. Headline numbers per kept set: winner retention (share of the
universe's winners kept), loser removal (share of its losers removed), winner / loser rate
among the kept vs the universe, and `edge` = winner retention − loser retention (0 for a
random gate of any size; positive = it keeps winners preferentially).

**The protocol.** Discovery = rebalance dates 2003–2012; holdout = 2015–2022; 2013–14 is a
gap. Selection uses discovery only; the holdout is evaluated once.
"""
from __future__ import annotations

import copy
from datetime import date
from typing import Any, Iterable

import numpy as np
import pandas as pd

from core.backend import screens
from core.backend.backtest import harness, panel

WIN_Q, LOSE_Q = 0.8, 0.2              # primary: top / bottom quintile
ABS_WIN, ABS_LOSE = 0.5, -0.3         # secondary
DOUBLE, BUST = 1.0, -0.5              # tails

OBJECTIVE = [
    "At each yearly rebalance date (1 January), within the screen's universe — its sector/"
    "industry exclusions and market-cap band, the backtest's tradability floor (a print in "
    "the last 10 days, price ≥ $3, ADV ≥ $1M), point-in-time data only.",
    "Primary labels (used to choose gates): WINNER = top 20% of forward 24-month total "
    "return within that date's universe; LOSER = bottom 20%, or stopped trading at a loss "
    "within the window.",
    "Secondary labels (checked, not optimised): winner = forward 24m ≥ +50% (≈22%/yr); "
    "loser = ≤ −30% or stopped trading at a loss. Tails reported only: doubled (≥ +100%), "
    "busted (≤ −50%). A 12-month version of the primary labels is reported alongside.",
    "Better = removes a large share of losers while keeping a large share of winners. "
    "edge = winner retention − loser retention (share of losers kept); a random gate scores "
    "0 whatever its size.",
    "Discovery: rebalance dates 2003–2012 (windows end by 2014). Holdout: 2015–2022 "
    "(windows to 2024), evaluated once. 2013–2014 is a gap.",
]


# --------------------------------------------------------------------------- universe


def _universe_spec(spec: dict[str, Any]) -> dict[str, Any]:
    uni: dict[str, Any] = {"id": f"{spec.get('id')}-universe",
                           "universe": dict(spec.get("universe") or {})}
    if cap := (spec.get("gates") or {}).get("marketcap"):
        uni["gates"] = {"marketcap": cap}
    return uni


def universe(d: pd.DataFrame, spec: dict[str, Any],
             periods: Iterable[str] = ("discovery", "holdout")) -> pd.DataFrame:
    """The screen's universe with labels: tradable at q, forward 24m known, the screen's
    universe rules and market-cap band (exactly `harness.eligible`)."""
    u = d[d["tradable"] & d["fwd_24m"].notna() & d["period"].isin(list(periods))]
    u = screens.apply_screen(u, _universe_spec(spec), drop_delisted=False)
    return label(u.reset_index(drop=True))


def label(u: pd.DataFrame) -> pd.DataFrame:
    """Add the winner/loser columns, ranks computed within each date."""
    u = u.copy()
    g = u.groupby("q")
    r24, r12 = u["fwd_24m"], u["fwd_12m"]
    pr24 = g["fwd_24m"].rank(pct=True)
    pr12 = g["fwd_12m"].rank(pct=True)
    stop24 = (u["stopped_24m"].fillna(0) > 0) & (r24 < 0)
    stop12 = (u["stopped_12m"].fillna(0) > 0) & (r12 < 0)
    u["win_p"] = pr24 >= WIN_Q
    u["lose_p"] = ((pr24 <= LOSE_Q) | stop24) & ~u["win_p"]
    u["win_a"] = r24 >= ABS_WIN
    u["lose_a"] = (r24 <= ABS_LOSE) | stop24
    u["win_12"] = (pr12 >= WIN_Q) & r12.notna()
    u["lose_12"] = (((pr12 <= LOSE_Q) | stop12) & r12.notna()) & ~u["win_12"]
    u["double"] = r24 >= DOUBLE
    u["bust"] = r24 <= BUST
    u["stop_loss"] = stop24
    return u


# --------------------------------------------------------------------------- metrics

_LABELS = (("p", "win_p", "lose_p"), ("a", "win_a", "lose_a"), ("q12", "win_12", "lose_12"))


def _rate(x: pd.Series) -> float | None:
    return float(x.mean()) if len(x) else None


def metrics(u: pd.DataFrame, kept: pd.Series | np.ndarray) -> dict[str, Any]:
    """Selection metrics for a kept-mask over a labelled universe (pooled across dates)."""
    kept = pd.Series(np.asarray(kept, dtype=bool), index=u.index)
    k, rm = u[kept], u[~kept]
    out: dict[str, Any] = {
        "n_univ": len(u), "n_kept": int(kept.sum()),
        "share_kept": _rate(kept),
        "dates": int(u["q"].nunique()),
        "names_per_date": float(kept.groupby(u["q"]).sum().mean()) if len(u) else None,
    }
    for tag, w, lo in _LABELS:
        W, L = u[w], u[lo]
        out[f"{tag}_retention"] = float((kept & W).sum() / W.sum()) if W.sum() else None
        out[f"{tag}_removal"] = float((~kept & L).sum() / L.sum()) if L.sum() else None
        out[f"{tag}_win_kept"] = _rate(k[w])
        out[f"{tag}_win_univ"] = _rate(W)
        out[f"{tag}_lose_kept"] = _rate(k[lo])
        out[f"{tag}_lose_univ"] = _rate(L)
        if out[f"{tag}_retention"] is not None and out[f"{tag}_removal"] is not None:
            out[f"{tag}_edge"] = out[f"{tag}_retention"] - (1 - out[f"{tag}_removal"])
        else:
            out[f"{tag}_edge"] = None
    for tail in ("double", "bust", "stop_loss"):
        out[f"{tail}_kept"] = _rate(k[tail])
        out[f"{tail}_univ"] = _rate(u[tail])
    for h in ("24m", "12m"):
        c = f"fwd_{h}"
        out[f"median_{h}_kept"] = float(k[c].median()) if len(k) else None
        out[f"mean_{h}_kept"] = float(k[c].mean()) if len(k) else None
        out[f"median_{h}_removed"] = float(rm[c].median()) if len(rm) else None
        out[f"mean_{h}_removed"] = float(rm[c].mean()) if len(rm) else None
        out[f"median_{h}_univ"] = float(u[c].median()) if len(u) else None
    # Per-date view, so one boom year cannot carry a pooled number.
    by = []
    for _, g in u.groupby("q"):
        kk = kept.loc[g.index]
        if kk.sum() >= 3:
            by.append(g.loc[kk, "fwd_24m"].median() - g["fwd_24m"].median())
    out["excess_median_by_date"] = float(np.mean(by)) if by else None
    out["dates_beating_universe"] = (float(np.mean([x > 0 for x in by])) if by else None)
    return out


# --------------------------------------------------------------------------- gates


def _mask(u: pd.DataFrame, spec: dict[str, Any]) -> pd.Series:
    passed = screens.apply_screen(u, spec, drop_delisted=False)
    return pd.Series(u.index.isin(passed.index), index=u.index)


def _gates_of(spec: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """(name, sub-spec) per gate, excluding the market-cap band (it defines the universe)."""
    out = []
    for col, rule in (spec.get("gates") or {}).items():
        if col == "marketcap":
            continue
        out.append((col, {"gates": {col: dict(rule)}}))
    for g in spec.get("growth") or []:
        out.append((f"growth:{g['cagr']}", {"growth": [dict(g)]}))
    return out


def _without(spec: dict[str, Any], name: str) -> dict[str, Any]:
    s = copy.deepcopy(spec)
    if name.startswith("growth:"):
        s["growth"] = [g for g in s.get("growth") or [] if f"growth:{g['cagr']}" != name]
    else:
        s.get("gates", {}).pop(name, None)
    return s


def _with(spec: dict[str, Any], name: str, key: str, value: float | None) -> dict[str, Any]:
    """`spec` with gate `name`'s `key` bound set to value (None = gate removed)."""
    s = _without(spec, name)
    if value is None:
        return s
    if name.startswith("growth:"):
        orig = next(g for g in spec["growth"] if f"growth:{g['cagr']}" == name)
        s.setdefault("growth", []).append({**orig, "min_cagr": value})
    else:
        rule = {k: v for k, v in spec["gates"][name].items()}
        rule[key] = value
        s.setdefault("gates", {})[name] = rule
    return s


def _body(spec: dict[str, Any]) -> dict[str, Any]:
    """The screen minus its universe and market-cap band (already applied to `u`)."""
    s = {"id": spec.get("id"), "gates": {k: v for k, v in (spec.get("gates") or {}).items()
                                         if k != "marketcap"},
         "growth": copy.deepcopy(spec.get("growth") or [])}
    return s


# The pre-declared threshold grid (round numbers / conventional breakpoints), fixed before
# any result was looked at. `None` = the gate removed. The swept key is the bound the
# current screen sets (for two-sided valuation gates, the upper bound; `min: 0` stays).
SWEEPS: dict[str, tuple[str, list[float | None]]] = {
    "roic":           ("min", [None, 0.0, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20]),
    "net_margin":     ("min", [None, 0.0, 0.02, 0.05, 0.08, 0.10]),
    "gross_margin":   ("min", [None, 0.15, 0.25, 0.35, 0.50]),
    "altman_z":       ("min", [None, 1.81, 2.5, 3.0, 4.0, 5.0]),
    "years_public":   ("min", [None, 3, 5, 10]),
    "ev_ebitda":      ("max", [None, 8, 10, 12, 14, 18, 25]),
    "p_fcf":          ("max", [None, 10, 15, 20, 25, 30]),
    "pe":             ("max", [None, 10, 15, 20, 25, 30]),
    "fcf":            ("gt", [None, 0]),
    "debt_equity":    ("max", [None, 0.5, 1.0, 1.5, 2.0]),
    "shares_cagr_5y": ("max", [None, 0.0, 0.02, 0.05, 0.10]),
    "growth:eps_g_5y": ("min_cagr", [None, 0.0, 0.03, 0.05, 0.10]),
    "growth:sales_g_5y": ("min_cagr", [None, 0.0, 0.03, 0.05, 0.10]),
}


def gate_audit(d: pd.DataFrame, spec: dict[str, Any],
               periods: tuple[str, ...] = ("discovery", "holdout")) -> dict[str, Any]:
    """Per gate: alone (what it removes vs keeps), leave-one-out (what the full screen minus
    this gate lets back in), and a threshold sweep — for each period."""
    body = _body(spec)
    gates, sens, full = [], [], {}
    for per in periods:
        u = universe(d, spec, (per,))
        if u.empty:
            continue
        fm = _mask(u, body)
        full[per] = metrics(u, fm)
        full[per]["universe"] = metrics(u, np.ones(len(u), dtype=bool))
        for name, sub in _gates_of(body):
            am = _mask(u, {"id": name, **sub})
            lm = _mask(u, _without(body, name))
            back = lm & ~fm
            row = {"period": per, "gate": name, "rule": _rule_text(name, body),
                   "alone": metrics(u, am),
                   "loo": metrics(u, lm),
                   "let_back_in": _set_stats(u[back]),
                   "full_kept": _set_stats(u[fm])}
            gates.append(row)
            if name in SWEEPS:
                key, values = SWEEPS[name]
                for v in values:
                    s_alone = _with({"gates": {}, "growth": [], **_only(body, name)}, name,
                                    key, v)
                    s_full = _with(body, name, key, v)
                    sens.append({"period": per, "gate": name, "key": key, "value": v,
                                 "current": _is_current(body, name, key, v),
                                 "alone": metrics(u, _mask(u, s_alone)),
                                 "in_screen": metrics(u, _mask(u, s_full))})
    return {"full": full, "gates": gates, "sensitivity": sens}


def _only(body: dict[str, Any], name: str) -> dict[str, Any]:
    if name.startswith("growth:"):
        return {"gates": {}, "growth": [g for g in body["growth"]
                                        if f"growth:{g['cagr']}" == name]}
    return {"gates": {name: body["gates"][name]}, "growth": []}


def _is_current(body: dict[str, Any], name: str, key: str, v: Any) -> bool:
    if name.startswith("growth:"):
        g = next((g for g in body["growth"] if f"growth:{g['cagr']}" == name), None)
        return g is not None and v is not None and float(g["min_cagr"]) == float(v)
    rule = body["gates"].get(name) or {}
    return v is not None and key in rule and float(rule[key]) == float(v)


def _rule_text(name: str, body: dict[str, Any]) -> str:
    if name.startswith("growth:"):
        g = next(g for g in body["growth"] if f"growth:{g['cagr']}" == name)
        return f"{g['cagr']} ≥ {g['min_cagr']} or recovered from {g['level_5y_ago']} ≤ 0"
    rule = body["gates"][name]
    sym = {"min": "≥", "max": "≤", "gt": ">", "lt": "<"}
    parts = [f"{sym[k]} {v}" for k, v in rule.items() if k in sym]
    if "on_null" in rule:
        parts.append(f"blank → {rule['on_null']}")
    return f"{name} " + ", ".join(parts)


def _set_stats(s: pd.DataFrame) -> dict[str, Any]:
    if s.empty:
        return {"n": 0}
    return {"n": len(s), "names_per_date": float(s.groupby("q").size().mean()),
            "p_win": float(s["win_p"].mean()), "p_lose": float(s["lose_p"].mean()),
            "a_win": float(s["win_a"].mean()), "a_lose": float(s["lose_a"].mean()),
            "double": float(s["double"].mean()), "bust": float(s["bust"].mean()),
            "median_24m": float(s["fwd_24m"].median()), "mean_24m": float(s["fwd_24m"].mean())}


# --------------------------------------------------------------------------- signals

# (column, direction, family, description). direction +1 = higher is expected better.
SIGNALS: list[tuple[str, int, str, str]] = [
    ("earnings_yield", 1, "valuation", "E/P (1 / P/E; loss-makers negative)"),
    ("ebitda_ev", 1, "valuation", "EBITDA / EV"),
    ("fcf_yield", 1, "valuation", "FCF / market cap"),
    ("book_to_price", 1, "valuation", "B/P (1 / P/B)"),
    ("sales_ev", 1, "valuation", "sales / EV"),
    ("roic", 1, "quality", "ROIC (TTM)"),
    ("roe", 1, "quality", "ROE (TTM)"),
    ("gross_margin", 1, "quality", "gross margin"),
    ("oper_margin", 1, "quality", "operating margin"),
    ("net_margin", 1, "quality", "net margin"),
    ("net_margin_chg_1y", 1, "quality", "net margin change vs 1y ago"),
    ("net_margin_chg_3y", 1, "quality", "net margin change vs 3y ago"),
    ("gross_margin_chg_1y", 1, "quality", "gross margin change vs 1y ago"),
    ("roic_chg_1y", 1, "quality", "ROIC change vs 1y ago"),
    ("roic_chg_3y", 1, "quality", "ROIC change vs 3y ago"),
    ("fcf_conversion", 1, "quality", "FCF / net income (net income > 0)"),
    ("accruals", -1, "quality", "(net income − CFO) / assets"),
    ("altman_z", 1, "balance sheet", "Altman Z"),
    ("debt_equity", -1, "balance sheet", "debt / equity"),
    ("net_cash_pct", 1, "balance sheet", "(cash − debt) / market cap"),
    ("current_ratio", 1, "balance sheet", "current ratio"),
    ("interest_cover", 1, "balance sheet", "EBIT / interest expense"),
    ("shares_cagr_5y", -1, "dilution", "5y diluted share CAGR"),
    ("shares_chg_1y", -1, "dilution", "1y change in basic shares"),
    ("sales_g_yr", 1, "growth", "sales growth, latest fiscal year"),
    ("sales_g_3y", 1, "growth", "sales CAGR 3y"),
    ("sales_g_5y", 1, "growth", "sales CAGR 5y"),
    ("eps_g_yr", 1, "growth", "EPS growth, latest fiscal year"),
    ("eps_g_3y", 1, "growth", "EPS CAGR 3y"),
    ("eps_g_5y", 1, "growth", "EPS CAGR 5y"),
    ("sales_accel", 1, "growth", "sales growth 1y − 3y CAGR"),
    ("mom_12_1", 1, "price", "12-1 month momentum"),
    ("mom_6", 1, "price", "6-month momentum"),
    ("mom_1", -1, "price", "1-month return (reversal)"),
    ("pct_below_high", -1, "price", "% below 52-week high"),
    ("vol_1y", -1, "price", "1y daily volatility (annualised)"),
    ("ins_net_buy_pct", 1, "ownership", "insider net open-market buying / mcap, 12m (2009+)"),
    ("ins_buyers", 1, "ownership", "distinct insider buyers, 12m (2009+)"),
    ("log_marketcap", 1, "size", "log10 market cap"),
    ("years_public", 1, "size", "years since first price"),
]


def _quintile(u: pd.DataFrame, col: str) -> pd.Series:
    """Quintile 1..5 within each date over non-null values (1 = lowest value)."""
    pr = u.groupby("q")[col].rank(pct=True, method="average")
    return np.ceil(pr * 5).clip(1, 5)


def _bucket_stats(s: pd.DataFrame) -> dict[str, Any]:
    if s.empty:
        return {"n": 0}
    return {"n": len(s),
            "mean_24m": float(s["fwd_24m"].mean()), "median_24m": float(s["fwd_24m"].median()),
            "mean_12m": float(s["fwd_12m"].mean()),
            "p_win": float(s["win_p"].mean()), "p_lose": float(s["lose_p"].mean()),
            "a_win": float(s["win_a"].mean()), "a_lose": float(s["lose_a"].mean()),
            "q12_win": float(s["win_12"].mean()), "q12_lose": float(s["lose_12"].mean()),
            "double": float(s["double"].mean()), "bust": float(s["bust"].mean())}


def _spearman5(vals: list[float | None]) -> float | None:
    v = [x for x in vals if x is not None]
    if len(v) < 5:
        return None
    return float(pd.Series(vals).rank().corr(pd.Series([1, 2, 3, 4, 5]), method="pearson"))


def signal_study(d: pd.DataFrame, spec: dict[str, Any],
                 periods: tuple[str, ...] = ("discovery",),
                 subset: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Quintile analysis per signal within the screen's universe (optionally within a
    sub-screen `subset` of it). Quintiles are formed within each date."""
    u = universe(d, spec, periods)
    if subset:
        u = u[_mask(u, subset)]
    out = []
    for col, direction, family, desc in SIGNALS:
        if col not in u.columns:
            continue
        x = pd.to_numeric(u[col], errors="coerce").replace([np.inf, -np.inf], np.nan)
        has = x.notna()
        uu = u[has].assign(_x=x[has])
        dates_cov = uu.groupby("q").size()
        uu = uu[uu["q"].isin(dates_cov[dates_cov >= 50].index)]
        row: dict[str, Any] = {"signal": col, "family": family, "description": desc,
                               "direction": direction,
                               "coverage": float(has.mean()) if len(u) else None,
                               "dates": int(uu["q"].nunique()), "n": len(uu)}
        if uu.empty:
            row["quintiles"] = []
            out.append(row)
            continue
        qn = _quintile(uu, "_x")
        qs = []
        for k in range(1, 6):
            s = uu[qn == k]
            b = _bucket_stats(s)
            b.update(quintile=k, lo=float(s["_x"].min()) if len(s) else None,
                     hi=float(s["_x"].max()) if len(s) else None)
            # median of the per-date boundary, for setting a threshold from this grid
            b["upper_breakpoint"] = (float(uu.groupby("q")["_x"].quantile(k / 5).median())
                                     if k < 5 else None)
            qs.append(b)
        row["quintiles"] = qs
        row["null"] = _bucket_stats(u[~has])
        net = [(b["p_win"] - b["p_lose"]) if b.get("n") else None for b in qs]
        row["net_by_quintile"] = net
        row["spearman_net"] = _spearman5(net)
        row["spearman_median"] = _spearman5([b.get("median_24m") for b in qs])
        good, bad = (qs[4], qs[0]) if direction > 0 else (qs[0], qs[4])
        row["spread_net"] = ((good["p_win"] - good["p_lose"]) - (bad["p_win"] - bad["p_lose"])
                             if good.get("n") and bad.get("n") else None)
        row["spread_median"] = (good["median_24m"] - bad["median_24m"]
                                if good.get("n") and bad.get("n") else None)
        row["spread_lose"] = (bad["p_lose"] - good["p_lose"]
                              if good.get("n") and bad.get("n") else None)
        row["spread_win"] = (good["p_win"] - bad["p_win"]
                             if good.get("n") and bad.get("n") else None)
        # Year-by-year consistency: share of dates where the expected-good extreme quintile
        # beat the expected-bad one on median forward return.
        yrs = []
        for _, g in uu.assign(_qn=qn).groupby("q"):
            gq = g[g["_qn"] == (5 if direction > 0 else 1)]["fwd_24m"].median()
            bq = g[g["_qn"] == (1 if direction > 0 else 5)]["fwd_24m"].median()
            if not (np.isnan(gq) or np.isnan(bq)):
                yrs.append(gq > bq)
        row["years_consistent"] = float(np.mean(yrs)) if yrs else None
        sp = row["spearman_net"]
        row["monotonic"] = bool(sp is not None and abs(sp) >= 0.9)
        row["agrees_with_prior"] = bool(sp is not None and np.sign(sp) == direction)
        out.append(row)
    out.sort(key=lambda r: -(abs(r.get("spread_net") or 0)))
    return out


# --------------------------------------------------------------------------- compare


def compare(d: pd.DataFrame, specs: list[dict[str, Any]],
            periods: tuple[str, ...] = ("discovery", "holdout")) -> list[dict[str, Any]]:
    """Selection metrics per screen per period, each within its own universe."""
    rows = []
    for spec in specs:
        for per in periods:
            u = universe(d, spec, (per,))
            if u.empty:
                continue
            m = metrics(u, _mask(u, _body(spec)))
            rows.append({"screen": spec["id"], "title": spec.get("title"), "period": per,
                         **m})
    return rows


def flat(prefix: str, m: dict[str, Any]) -> dict[str, Any]:
    """Flatten a nested metrics dict for CSV output."""
    out = {}
    for k, v in m.items():
        if isinstance(v, dict):
            out.update(flat(f"{prefix}{k}.", v))
        elif not isinstance(v, list):
            out[f"{prefix}{k}"] = v
    return out


def asof_dates(d: pd.DataFrame, per: str) -> list[date]:
    return sorted(d.loc[d["period"] == per, "q"].unique())


__all__ = ["OBJECTIVE", "universe", "label", "metrics", "gate_audit", "signal_study",
           "compare", "SWEEPS", "SIGNALS", "harness", "panel"]
