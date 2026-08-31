"""Precompute the S&P 500 concentration + sector-weight series.

    python -m core.scripts.build.build_sp500_concentration

Builds the two small derived tables the `/sp500` page reads — `sp500_concentration`
(one row per index snapshot date: top-N cap-weights, HHI, effective N) and
`sp500_sector_weights` (one row per date × sector) — from the `sp500` membership
log, `daily` market caps, and `tickers` sectors. Idempotent: re-run to refresh (the
`update_all` orchestrator also calls this after the SP500/DAILY loads). See
`core/backend/queries/sp500.py`.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.market import sp500


def main() -> None:
    t = time.time()
    print("Building sp500_concentration + sp500_sector_weights …")
    with session_scope() as session:
        n = sp500.refresh_concentration(session)
    print(f"  wrote {n:,} snapshot dates in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
