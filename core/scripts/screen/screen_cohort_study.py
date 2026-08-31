"""Cohort / event study of a screen — what happens to its names, one name at a time.

    python -m core.scripts.screen.screen_cohort_study [SCREEN] [--start 2004-12-31] [--end YYYY-MM-DD]

Tests a per-name claim ("these names double") rather than portfolio compounding, which is a
different question with a different answer. For every quarter a name passes (point-in-time,
survivorship-free), measures forward 1/2/3y total return and pools the base rates of ≥100%
(double), ≥200% (triple) and ≤−50% (halve) against the equal-weight eligible universe.

SCREEN defaults to ACTIVE_SCREEN.

Caveat: overlapping quarterly cohorts are NOT independent samples (heavy 3y-window overlap), so
read the screen-vs-universe *spread* in base rates, not the absolute significance.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from core.backend import screens
from core.backend.db.engine import session_scope
from core.backend.queries.discovery import backtest

RESULTS_DIR = Path("research/experiments/results")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screen", nargs="?", default=None,
                    help="screen id from config/screens/ (default: ACTIVE_SCREEN)")
    ap.add_argument("--start", default="2004-12-31")
    ap.add_argument("--end", default=None)
    args = ap.parse_args()

    spec = screens.load_screen(args.screen) if args.screen else screens.active_screen()
    print(f"Screen: {spec['id']} — {spec.get('title', '')}")

    with session_scope() as s:
        res = backtest.cohort_study(s, start=args.start, end=args.end, spec=spec)
    if res.empty:
        print("No cohorts produced — check date range / data.")
        return

    piv = res.set_index(["horizon_y", "cohort"])
    print(f"\nForward total-return base rates — screen passers vs eligible universe")
    print(f"{'horizon':>8}  {'cohort':<9} {'n':>6} {'median':>8} {'double%':>8} "
          f"{'triple%':>8} {'halve%':>7}")
    for hy in sorted(res["horizon_y"].unique()):
        for cohort in ("screen", "universe"):
            if (hy, cohort) not in piv.index:
                continue
            r = piv.loc[(hy, cohort)]
            print(f"{hy:>6}y  {cohort:<9} {int(r['n']):>6} {r['median']*100:>7.1f}% "
                  f"{r['double_rate']*100:>7.1f}% {r['triple_rate']*100:>7.1f}% "
                  f"{r['halve_rate']*100:>6.1f}%")
        # the headline spread
        if (hy, "screen") in piv.index and (hy, "universe") in piv.index:
            d = (piv.loc[(hy, "screen"), "double_rate"]
                 - piv.loc[(hy, "universe"), "double_rate"]) * 100
            print(f"          → screen double-rate edge: {d:+.1f}pp")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"{spec['id']}-cohort-study.csv"
    res.to_csv(out, index=False)
    print(f"\nSeries → {out}")
    print("There is no per-name edge if the screen's 3y double-rate ≤ the universe's. "
          "Overlapping cohorts ⇒ read the spread, not significance.")


if __name__ == "__main__":
    main()
