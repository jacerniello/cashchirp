"""Precompute the S&P 500 monthly member panel → `sp500_member_months`.

    python -m core.scripts.build.build_sp500_member_months

Builds the monthly (month × constituent) total-return + cap-weight panel that powers
the counterfactual index lab (`/sp500/lab`) — remove any companies/sectors and re-run
index history on the survivors. Idempotent: re-run to refresh (the `update_all`
orchestrator also calls this after the SP500/SEP/DAILY loads). See
`core/backend/queries/index_lab.py`.
"""
import time

from core.backend.db.engine import session_scope
from core.backend.queries.market import index_lab


def main() -> None:
    t = time.time()
    print("Building sp500_member_months …")
    with session_scope() as session:
        n = index_lab.refresh_member_months(session)
    print(f"  wrote {n:,} member-months in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
