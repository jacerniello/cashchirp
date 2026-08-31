"""Backfill the stable `permaticker` id onto every security table.

    python -m core.scripts.load.enrich_permaticker

Rebuilds the ticker->permaticker map from `tickers`, then adds + populates a
`permaticker` column on securities, daily_prices, and every ticker-keyed table.
New loads keep it automatically (wired into the generic loader); run this to
(re)backfill existing tables.
"""
from datetime import datetime

from core.backend.ingest.permaticker import enrich_all


def main() -> None:
    print(f"[{datetime.now():%H:%M:%S}] enriching permaticker across tables ...")
    enrich_all()
    print(f"[{datetime.now():%H:%M:%S}] done.")


if __name__ == "__main__":
    main()
