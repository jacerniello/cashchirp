"""Load individual FRED series via the FRED API — commodity spot prices by default.

These back the Commodities page's spot benchmark (WTI, Brent, Henry Hub gas, copper).
They're market price quotes (revision-free), so the currently-published series is also
the point-in-time series — safe to backtest, unlike the revised FRED-MD/QD current.csv.

    python -m core.scripts.load.fred.load_spot                 # curated commodity spots
    python -m core.scripts.load.fred.load_spot DCOILWTICO GVZCLS   # specific series ids

Idempotent (upserts). Needs FRED_API_KEY in core/.env. Run `python -m
core.scripts.setup.init_db` first if the fred_* tables don't exist yet.
"""
import argparse
from datetime import datetime

from core.backend.ingest.fred.fred_api import COMMODITY_SPOT_SERIES, ingest_fred_series


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load FRED series (commodity spot prices by default) via the API."
    )
    parser.add_argument(
        "series", nargs="*",
        help="FRED series ids to load (default: the curated commodity spot set).",
    )
    args = parser.parse_args()
    series = args.series or COMMODITY_SPOT_SERIES

    started = datetime.now()
    print(f"[{started:%H:%M:%S}] loading {len(series)} FRED series via API ...")
    for sid in series:
        stats = ingest_fred_series(sid)
        lo, hi = stats["date_range"]
        flag = "updated" if stats["changed"] else "unchanged"
        print(f"  {sid:14} {stats['rows']:>7,} obs  {lo}..{hi}  [{flag}]  "
              f"{stats['title']}")
    elapsed = (datetime.now() - started).total_seconds()
    print(f"[{datetime.now():%H:%M:%S}] done in {elapsed:.0f}s.")


if __name__ == "__main__":
    main()
