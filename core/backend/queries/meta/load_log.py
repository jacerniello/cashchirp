"""Load-ledger helpers: record each ingestion and read back the latest per dataset."""
from datetime import datetime

from sqlalchemy import select

from core.backend.db.engine import session_scope
from core.backend.db.models import LoadLog


def record_load(
    *,
    source: str,
    dataset: str,
    operation: str,
    status: str = "ok",
    rows: int | None = None,
    requested_at: datetime | None = None,
    detail: str | None = None,
) -> None:
    """Append one ingestion event. Best-effort: never let logging break a load."""
    try:
        with session_scope() as session:
            session.add(
                LoadLog(
                    source=source,
                    dataset=dataset,
                    operation=operation,
                    status=status,
                    rows=rows,
                    requested_at=requested_at,
                    detail=detail,
                )
            )
    except Exception:
        pass


def latest_by_dataset() -> list[LoadLog]:
    """Most recent run per dataset — the 'what have we loaded and when' summary."""
    with session_scope() as session:
        stmt = (
            select(LoadLog)
            .order_by(LoadLog.dataset, LoadLog.completed_at.desc())
            .distinct(LoadLog.dataset)
        )
        rows = list(session.scalars(stmt))
        for r in rows:  # detach so attributes are usable after the session closes
            session.expunge(r)
        return rows
