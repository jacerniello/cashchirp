"""Quarterly equal-weight portfolio backtest of a screen — does the filter compound?

    python -m core.scripts.screen.screen_portfolio_backtest [SCREEN] [--start 2004-12-31]
        [--end YYYY-MM-DD] [--cost-bps 30] [--min-price 3] [--min-adv 1e6] [--oos 2013-01-01]

Re-screens every quarter (point-in-time, survivorship-free), holds the passers equal-weighted,
and compares to the equal-weight **eligible universe** — the same size/sector gates from your
screen spec with its quality/value gates removed — so the spread is the filter's contribution,
not small-cap beta. Prints full-period and out-of-sample stats and writes the quarterly series
to research/experiments/results/<screen>-portfolio-backtest.csv.

SCREEN defaults to ACTIVE_SCREEN. Net of `--cost-bps` on turnover. This is a falsification
test, not a recommendation: write down what would make you abandon the screen (an experiment
file in research/experiments/) BEFORE you run it.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from core.backend import screens
from core.backend.db.engine import session_scope
from core.backend.queries.discovery import backtest

RESULTS_DIR = Path("research/experiments/results")


def _row(label: str, st: dict) -> str:
    if not st:
        return f"  {label:24} (no data)"
    return (f"  {label:24} CAGR {st['cagr']*100:6.1f}%  vol {st['vol_ann']*100:5.1f}%  "
            f"Sharpe {st['sharpe']:5.2f}  maxDD {st['max_drawdown']*100:6.1f}%  "
            f"n={st['periods']}")


def _report(title: str, res: pd.DataFrame) -> None:
    s, b = backtest.perf_stats(res["strat_net"]), backtest.perf_stats(res["bench"])
    sg = backtest.perf_stats(res["strat"])
    print(f"\n{title}  ({res.index[0]} → {res.index[-1]}, {len(res)} quarters)")
    print(_row("Screen (net)", s))
    print(_row("Screen (gross)", sg))
    print(_row("Eligible universe EW", b))
    if s and b:
        excess = s["cagr"] - b["cagr"]
        hit = (res["strat_net"] > res["bench"]).mean()
        print(f"  → annualised excess vs universe: {excess*100:+.1f}%/yr  "
              f"| quarters beating universe: {hit*100:.0f}%  "
              f"| avg names {res['n'].mean():.0f}, avg turnover {res['turnover'].mean()*100:.0f}%")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screen", nargs="?", default=None,
                    help="screen id from config/screens/ (default: ACTIVE_SCREEN)")
    ap.add_argument("--start", default="2004-12-31")
    ap.add_argument("--end", default=None)
    ap.add_argument("--cost-bps", type=float, default=30.0)
    ap.add_argument("--min-price", type=float, default=3.0)
    ap.add_argument("--min-adv", type=float, default=1e6)
    ap.add_argument("--oos", default="2013-01-01", help="out-of-sample split date")
    args = ap.parse_args()

    spec = screens.load_screen(args.screen) if args.screen else screens.active_screen()
    print(f"Screen: {spec['id']} — {spec.get('title', '')}")

    with session_scope() as s:
        res = backtest.portfolio_backtest(
            s, start=args.start, end=args.end, cost_bps=args.cost_bps,
            min_price=args.min_price, min_dollar_adv=args.min_adv, spec=spec)

    if res.empty:
        print("No quarters produced — check date range / data.")
        return

    _report("FULL PERIOD", res)
    oos = res[res.index >= args.oos]
    if len(oos) > 4:
        _report(f"OUT-OF-SAMPLE (≥ {args.oos})", oos)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"{spec['id']}-portfolio-backtest.csv"
    res.to_csv(out)
    print(f"\nQuarterly series → {out}")
    print("Read the SPREAD vs the eligible universe, not the absolute return — and check it "
          "against the falsification you pre-registered before running.")


if __name__ == "__main__":
    main()
