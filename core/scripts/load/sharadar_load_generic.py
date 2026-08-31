"""Load or incrementally update any Sharadar table via the schema-driven loader.

    python -m core.scripts.load.sharadar_load_generic SF1              # full backfill
    python -m core.scripts.load.sharadar_load_generic SF1 --sync       # incremental (lastupdated)
    python -m core.scripts.load.sharadar_load_generic SF2 --sync --sync-col filingdate
    python -m core.scripts.load.sharadar_load_generic ACTIONS --sync --sync-col date
    python -m core.scripts.load.sharadar_load_generic SF3 --sync-quarters   # 13F: no lastupdated
    python -m core.scripts.load.sharadar_load_generic METRICS --no-download

Full backfill downloads the whole table; --sync pulls only rows changed since the
watermark via the query API and upserts. --sync keys on `lastupdated` by default;
pass --sync-col <date column> for tables Sharadar ships without one (catches new
rows, not retroactive edits). The fetch auto-windows by date to dodge the API's
per-call row cap.

--sync-quarters handles tables with no row-level change column at all (SF3): it
re-pulls the most recent N quarters, each fetched in key-chunks (--chunk-key,
default ticker) to stay under the cap, and upserts. Catches new + amended rows in
those quarters; older-quarter amendments need a full backfill. All print progress.
"""
import argparse
from datetime import date, datetime


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> None:
    parser = argparse.ArgumentParser(description="Schema-driven Sharadar table loader.")
    parser.add_argument("table", help="Sharadar table code, e.g. SF1, SF3, SFP")
    parser.add_argument("--dest", default=None, help="Destination table name")
    parser.add_argument("--sync", action="store_true", help="Incremental update (lastupdated)")
    parser.add_argument("--sync-col", default="lastupdated",
                        help="Watermark column for --sync (e.g. date, filingdate, calendardate). "
                             "Default lastupdated; use a date column for tables that lack it.")
    parser.add_argument("--sync-quarters", action="store_true",
                        help="Coarse incremental: re-pull recent quarters in key-chunks "
                             "(tables with no lastupdated/filingdate, e.g. SF3).")
    parser.add_argument("--quarter-col", default="calendardate",
                        help="Quarter-grain date column for --sync-quarters (default calendardate)")
    parser.add_argument("--chunk-key", default="ticker",
                        help="Key column to chunk each quarter by for --sync-quarters (default ticker)")
    parser.add_argument("--quarters", type=int, default=2,
                        help="How many recent quarters to refresh with --sync-quarters (default 2)")
    parser.add_argument("--since", type=_parse_date, default=None, help="Sync start date override (YYYY-MM-DD)")
    parser.add_argument("--lookback-days", type=int, default=1, help="Sync overlap days (default 1)")
    parser.add_argument("--no-download", action="store_true", help="Use existing zip (full load only)")
    args = parser.parse_args()

    from core.backend.ingest.sharadar.sharadar_generic import load_table, sync_coarse_table, sync_table

    if args.sync_quarters:
        sync_coarse_table(args.table, dest_table=args.dest, quarter_col=args.quarter_col,
                          chunk_key=args.chunk_key, quarters=args.quarters, since=args.since)
    elif args.sync:
        sync_table(args.table, dest_table=args.dest, since=args.since,
                   lookback_days=args.lookback_days, sync_col=args.sync_col,
                   chunk_key=args.chunk_key)
    else:
        load_table(args.table, dest_table=args.dest, download=not args.no_download)


if __name__ == "__main__":
    main()
