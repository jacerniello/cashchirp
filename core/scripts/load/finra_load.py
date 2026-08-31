"""Load / update FINRA Consolidated Equity Short Interest.

    python -m core.scripts.load.finra_load            # incremental sync (default)
    python -m core.scripts.load.finra_load --backfill # full history 2017-12-29 -> today
    python -m core.scripts.load.finra_load --backfill --start 2020-01-01

Public FINRA Query API — no key, no auth. Loads date-by-date (the settlement date
is the API's partition key) and prints progress per settlement date. Resolution to
permaticker is a read-time view (`finra_short_interest_resolved`), not stored. See
`core/backend/ingest/finra_short_interest.py`.
"""
import argparse
import time
from datetime import date

from core.backend.ingest.finra import finra_short_interest as fsi


def _progress(settlement_date: str, rows: int) -> None:
    print(f"  {settlement_date}: {rows:,} rows")


def main() -> None:
    p = argparse.ArgumentParser(description="Load FINRA short interest.")
    p.add_argument("--backfill", action="store_true",
                   help="full history load (default: incremental sync)")
    p.add_argument("--start", type=date.fromisoformat, default=fsi._HISTORY_START,
                   help="backfill start date YYYY-MM-DD (default 2017-12-29)")
    args = p.parse_args()

    t = time.time()
    if args.backfill:
        print(f"Backfilling FINRA short interest from {args.start} …")
        res = fsi.backfill_short_interest(start=args.start, on_date=_progress)
    else:
        print("Syncing FINRA short interest (new settlement dates) …")
        res = fsi.sync_short_interest(on_date=_progress)

    lo, hi = res["range"]
    print(f"Done: {res['rows']:,} rows across {res['dates']} settlement dates "
          f"({lo}..{hi}) in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
