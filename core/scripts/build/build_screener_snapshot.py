"""Precompute the screener snapshot → `screener_snapshot` table.

    python -m core.scripts.build.build_screener_snapshot

Builds the per-security fundamentals snapshot the Screener page reads (P/E, margins,
growth, returns, ratios, …) and persists it so the page is instant. Idempotent: re-run to
refresh (the loader also calls this after a DAILY load). See
`core/backend/queries/screener.py`.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.discovery import screener


def main() -> None:
    t = time.time()
    print("Building screener_snapshot …")
    with session_scope() as session:
        n = screener.refresh_snapshot(session)
    print(f"  wrote {n:,} securities to screener_snapshot in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
