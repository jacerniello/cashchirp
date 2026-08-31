"""Precompute every holder's quarterly positions → `holder_timeseries` table.

    python -m core.scripts.build.build_holder_timeseries

For every security, ranks each 13F (SHR) holder by its largest-ever position value
and materialises every holder's full quarterly series with that rank — the
long-format, paginatable input for the Company page's holdings-over-time bubble
chart. Persisting it turns "rank and page through all of a security's holders"
(a 46M-row `sf3` self-join) into a `(permaticker, rank)` range scan. ~33M rows;
takes a few minutes. Idempotent: re-run to refresh (the loader also calls this
after an SF3 load). See `core/backend/queries/institutional.py`.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.ownership import institutional


def main() -> None:
    t = time.time()
    print("Building holder_timeseries …")
    with session_scope() as session:
        n = institutional.refresh_holder_timeseries(session)
    print(f"  wrote {n:,} rows to holder_timeseries in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
