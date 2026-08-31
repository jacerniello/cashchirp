"""Run a screen spec and show what it finds — the main "does my filter work?" command.

    python -m core.scripts.screen.run_screen                    # the active screen, live
    python -m core.scripts.screen.run_screen quality-value      # a specific screen
    python -m core.scripts.screen.run_screen --list             # every screen in config/screens/
    python -m core.scripts.screen.run_screen --columns          # gateable snapshot columns
    python -m core.scripts.screen.run_screen --asof 2018-06-29  # point-in-time (no look-ahead)
    python -m core.scripts.screen.run_screen --csv out.csv      # write the basket

The screen is a YAML file in `config/screens/` (see `core.backend.screens` and
docs/CONFIGURATION.md). Editing one and re-running this is the whole personalisation loop:
change a gate, re-run, see who survives.
"""
from __future__ import annotations

import argparse
import sys

import pandas as pd

from core.backend import screens
from core.backend.db.engine import session_scope
from core.backend.queries.discovery import screener

# Shown per surviving name. Kept short on purpose — this is a check, not a report.
COLUMNS = [
    ("ticker", "Ticker", "{}"), ("name", "Name", "{}"), ("sector", "Sector", "{}"),
    ("marketcap", "Mkt cap", "{:,.0f}"), ("pe", "P/E", "{:.1f}"),
    ("ev_ebitda", "EV/EBITDA", "{:.1f}"), ("p_fcf", "P/FCF", "{:.1f}"),
    ("roic", "ROIC", "{:.1%}"), ("net_margin", "Net mgn", "{:.1%}"),
]


def _print_table(df: pd.DataFrame) -> None:
    cols = [(k, h, f) for k, h, f in COLUMNS if k in df.columns]
    rows = []
    for rec in df.to_dict("records"):
        rows.append([
            "—" if pd.isna(rec.get(k)) else f.format(rec[k]) for k, _, f in cols
        ])
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h)
              for i, (_, h, _) in enumerate(cols)]
    header = "  ".join(h.ljust(w) for (_, h, _), w in zip(cols, widths))
    print(header)
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("screen", nargs="?", default=None,
                    help="screen id (filename stem in config/screens/); default ACTIVE_SCREEN")
    ap.add_argument("--list", action="store_true", help="list available screens and exit")
    ap.add_argument("--columns", action="store_true",
                    help="list the snapshot columns a screen may gate on, and exit")
    ap.add_argument("--csv", help="write the surviving basket to this path")
    ap.add_argument("--limit", type=int, default=50, help="rows to print (default 50)")
    args = ap.parse_args(argv)

    if args.list:
        for s in screens.list_screens():
            print(f"{s['id']:<24} {s['title']}")
            if s["description"]:
                print(f"{'':<24} {s['description'].splitlines()[0]}")
        return 0

    with session_scope() as session:
        if args.columns:
            snap = screener.snapshot(session)
            print(f"{len(snap.columns)} gateable columns:\n")
            for c in sorted(snap.columns):
                print(f"  {c}")
            return 0

        spec = screens.load_screen(args.screen) if args.screen else screens.active_screen()
        print(f"Screen: {spec['id']} — {spec.get('title', '')}")
        snap = screener.snapshot(session)
        passed = screener.screen_candidates(snap, spec=spec)

    print(f"Universe: {len(snap):,} securities  ->  {len(passed):,} pass\n")
    if passed.empty:
        print("Nothing survives. Loosen a gate, or check that the gated columns are "
              "populated for your loaded tables.")
        return 0

    sort_col = "ev_ebitda" if "ev_ebitda" in passed.columns else passed.columns[0]
    passed = passed.sort_values(sort_col, na_position="last")
    _print_table(passed.head(args.limit))
    if len(passed) > args.limit:
        print(f"\n... {len(passed) - args.limit:,} more (raise --limit, or use --csv)")
    if args.csv:
        passed.to_csv(args.csv, index=False)
        print(f"\nWrote {len(passed):,} rows -> {args.csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
