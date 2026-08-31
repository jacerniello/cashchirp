"""Bulk-download Sharadar tables once. Designed to be run on a daily schedule.

    python -m core.scripts.load.sharadar_bulk                 # default table set
    python -m core.scripts.load.sharadar_bulk SEP SF1         # specific tables
    python -m core.scripts.load.sharadar_bulk --list          # show available tables
    python -m core.scripts.load.sharadar_bulk --dir /tmp/shar # custom destination

Each table is written as <TABLE>.zip (one CSV inside), overwriting yesterday's.
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

from core.backend.ingest.sharadar.sharadar import DEFAULT_DEST, DEFAULT_TABLES, SHARADAR_TABLES, export_table
from core.backend.queries.meta.load_log import record_load


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk-download Sharadar tables.")
    parser.add_argument(
        "tables",
        nargs="*",
        default=[],
        help=f"Tables to download (default: {' '.join(DEFAULT_TABLES)})",
    )
    parser.add_argument("--dir", type=Path, default=DEFAULT_DEST, help="Destination dir")
    parser.add_argument("--list", action="store_true", help="List tables and exit")
    args = parser.parse_args()

    if args.list:
        for code, desc in SHARADAR_TABLES.items():
            print(f"  {code:<11} {desc}")
        return 0

    tables = [t.upper() for t in (args.tables or DEFAULT_TABLES)]
    failures = 0
    for table in tables:
        started = datetime.now()
        try:
            path = export_table(table, args.dir)
            size_mb = path.stat().st_size / 1_048_576
            elapsed = (datetime.now() - started).total_seconds()
            print(f"[{started:%Y-%m-%d %H:%M:%S}] {table:<11} {size_mb:7.1f} MB  {elapsed:5.1f}s  -> {path}")
            record_load(
                source="SHARADAR", dataset=f"SHARADAR/{table}", operation="download",
                requested_at=started, detail=f"{size_mb:.1f} MB -> {path}",
            )
        except Exception as exc:
            failures += 1
            print(f"[{started:%Y-%m-%d %H:%M:%S}] {table:<11} FAILED: {exc}", file=sys.stderr)
            record_load(
                source="SHARADAR", dataset=f"SHARADAR/{table}", operation="download",
                status="error", requested_at=started, detail=str(exc),
            )

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
