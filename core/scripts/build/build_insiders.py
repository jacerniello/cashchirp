"""Precompute the insider (people) tables → `derived.insider`, `derived.insider_company`.

    python -m core.scripts.build.build_insiders

Builds the per-insider index (stable surrogate id, role flags, activity span) and the
per-(insider, company) valued rollup that powers the people pages (/insider/<owner_id>)
and the company Insiders tab's stat cards + top-insiders. The rollup values grants and
option exercises at the market close on the trade date (the SEC filing leaves them
blank), so 'acquired' isn't a column of zeros. Idempotent: re-run to refresh after any
SF2 load — nothing refreshes it automatically. See
`core/backend/queries/insiders.py` and docs/reference/schema.md.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.ownership import insiders


def main() -> None:
    t = time.time()
    print("Building derived.insider + derived.insider_company …")
    with session_scope() as session:
        counts = insiders.refresh(session)
    print(f"  derived.insider:          {counts['insider']:,} insiders")
    print(f"  derived.insider_company:  {counts['insider_company']:,} rows")
    print(f"  done in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
