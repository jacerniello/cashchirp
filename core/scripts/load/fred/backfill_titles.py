"""Backfill human-readable titles onto the FRED series catalogue from the FRED API.

The FRED-MD/QD panels carry only mnemonics (`CPIAUCSL`, `RETAILx`); this fetches each
series' official FRED title so the Macro UI can show names and deep-link to FRED.

    python -m core.scripts.load.fred.backfill_titles            # fill missing titles
    python -m core.scripts.load.fred.backfill_titles --overwrite # re-fetch all
    python -m core.scripts.load.fred.backfill_titles --limit 5   # quick test

Idempotent; needs FRED_API_KEY in core/.env. Series FRED can't confirm (e.g. AMDMNOx,
the `S&P …` labels) are left untitled rather than guessed — they're listed at the end.
"""
import argparse
from datetime import datetime

from core.backend.ingest.fred.fred_titles import backfill_titles


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill FRED series titles from the FRED API."
    )
    parser.add_argument(
        "--overwrite", action="store_true", help="Re-fetch titles for all series."
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Only process the first N series."
    )
    args = parser.parse_args()

    started = datetime.now()
    print(f"[{started:%H:%M:%S}] backfilling FRED titles ...")
    stats = backfill_titles(overwrite=args.overwrite, limit=args.limit)
    elapsed = (datetime.now() - started).total_seconds()
    print(
        f"[{datetime.now():%H:%M:%S}] done in {elapsed:.0f}s — "
        f"{stats['resolved']}/{stats['total']} titled, "
        f"{stats['unresolved']} unresolved"
    )
    if stats["unresolved_ids"]:
        print("  unresolved (left untitled, no FRED match): "
              + ", ".join(stats["unresolved_ids"]))


if __name__ == "__main__":
    main()
