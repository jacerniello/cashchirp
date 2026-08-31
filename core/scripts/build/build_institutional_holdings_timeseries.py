"""Precompute every 13F filer's holdings over time → `institutional_holdings_timeseries`.

    python -m core.scripts.build.build_institutional_holdings_timeseries

The per-investor transpose of `build_holder_timeseries`: for every institutional
(13F) filer, ranks each SHR security it has held by the filer's largest-ever position
value and materialises that security's full quarterly series with the rank — the
long-format, paginatable input for the Institution page's holdings-over-time bubble
chart. Persisting it turns "rank and page through all of a filer's holdings" (a
46M-row `sf3` scan) into an `(investorname, rank)` range scan. ~33M rows; takes a few
minutes. Idempotent: re-run to refresh (the loader also calls this after an SF3 load).
See `core/backend/queries/institutional.py`.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.ownership import institutional


def main() -> None:
    t = time.time()
    print("Building institutional_holdings_timeseries …")
    with session_scope() as session:
        n = institutional.refresh_investor_holdings_timeseries(session)
    print(f"  wrote {n:,} rows to institutional_holdings_timeseries in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
