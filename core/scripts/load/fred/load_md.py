"""Load the FRED-MD / FRED-QD macro panels into Postgres.

By DEFAULT this loads the **point-in-time vintage history** (backtest-grade): a
bundled set of monthly snapshots, each tagged with the month it was published, so a
backtest can ask "what was known as of date X". Real-time vintages start 2015-01
(FRED-MD) / 2018-05 (FRED-QD); there is no point-in-time FRED data before then.

    python -m core.scripts.load.fred.load_md                 # FRED-MD vintages (default)
    python -m core.scripts.load.fred.load_md --qd            # FRED-QD vintages
    python -m core.scripts.load.fred.load_md --limit 3       # first 3 vintages (quick test)
    python -m core.scripts.load.fred.load_md --revised       # REVISED current.csv — latest
                                                        #   values, NOT point-in-time;
                                                        #   exploratory only, never backtest

Idempotent (upserts on series+date+vintage). The full vintage backfill is large
(~120 monthly snapshots x ~100k obs ≈ 12M rows) — expect a few minutes. Run
`python -m core.scripts.setup.init_db` first to create the fred_* tables.

The revised-vs-point-in-time distinction is documented in
`research/sources/sources.md` ("Backtesting with FRED").
"""
import argparse
from datetime import datetime

from core.backend.ingest.fred.fred_md import FRED_MD_URL, FRED_MD_VINTAGES_URL, FRED_QD_URL, FRED_QD_VINTAGES_URL, ingest_fred, ingest_fred_vintages


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load FRED-MD/QD macro panels into Postgres "
        "(point-in-time vintages by default)."
    )
    parser.add_argument("--qd", action="store_true", help="FRED-QD (quarterly)")
    parser.add_argument(
        "--revised",
        action="store_true",
        help="Load REVISED current.csv (latest values). NOT point-in-time — "
        "exploratory only; never backtest on this.",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Re-ingest every vintage (repair). Default is incremental: skip "
        "vintages already loaded — they're immutable point-in-time snapshots.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Vintage mode: load only the first N snapshots (quick test).",
    )
    args = parser.parse_args()

    dataset = "FRED-QD" if args.qd else "FRED-MD"
    started = datetime.now()

    if args.revised:
        url = FRED_QD_URL if args.qd else FRED_MD_URL
        print(
            f"[{started:%H:%M:%S}] loading REVISED {dataset} current.csv "
            "(vintage=current) — exploratory only, NOT for backtests ..."
        )
        stats = ingest_fred(url=url, dataset=dataset, vintage="current")
        elapsed = (datetime.now() - started).total_seconds()
        lo, hi = stats["date_range"]
        print(
            f"[{datetime.now():%H:%M:%S}] done in {elapsed:.0f}s — "
            f"{stats['rows']:,} obs across {stats['series']} series ({lo}..{hi})"
        )
        return

    url = FRED_QD_VINTAGES_URL if args.qd else FRED_MD_VINTAGES_URL
    mode = "FULL re-ingest" if args.full else "incremental"
    suffix = f" [limit {args.limit}]" if args.limit else ""
    print(
        f"[{started:%H:%M:%S}] loading {dataset} POINT-IN-TIME vintages "
        f"(backtest-grade, {mode}){suffix} ..."
    )

    def progress(vintage: str, rows: int) -> None:
        print(f"  [{datetime.now():%H:%M:%S}] {vintage}: {rows:,} obs")

    stats = ingest_fred_vintages(
        url=url, dataset=dataset, limit=args.limit, full=args.full,
        on_vintage=progress
    )
    elapsed = (datetime.now() - started).total_seconds()
    lo, hi = stats["range"]
    print(
        f"[{datetime.now():%H:%M:%S}] done in {elapsed:.0f}s — "
        f"{stats['rows']:,} obs across {stats['vintages']} vintages ({lo}..{hi})"
    )


if __name__ == "__main__":
    main()
