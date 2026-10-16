"""Cross-worker scheduler state: each worker's published health, and the control row.

See `SchedulerWorker` and `SchedulerControl` in `core.backend.db.models` for why these
live in Postgres rather than in memory.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert

from core.backend.db.engine import engine, session_scope
from core.backend.db.models import SchedulerControl, SchedulerWorker

_CONTROL_ID = 1
_DDL_LOCK = 0x0CA55C3D  # advisory lock key for ensure_tables only


def ensure_tables() -> None:
    """Create the two tables if missing.

    Every other table is created by bootstrap. These are created at API start as well,
    so an existing database gains them on the next deploy without a rebuild.
    """
    # Every API worker runs this at once on startup. Without the lock, two of them both
    # see the table missing and the second CREATE fails.
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _DDL_LOCK})
        SchedulerWorker.__table__.create(conn, checkfirst=True)
        SchedulerControl.__table__.create(conn, checkfirst=True)


def read_control() -> dict[str, Any]:
    """The control row, created with defaults (running, seq 0) the first time it is read."""
    with session_scope() as session:
        session.execute(insert(SchedulerControl)
                        .values(id=_CONTROL_ID, paused=False, restart_seq=0)
                        .on_conflict_do_nothing(index_elements=["id"]))
        c = session.get(SchedulerControl, _CONTROL_ID)
        return {"paused": bool(c.paused), "restart_seq": int(c.restart_seq),
                "updated_at": c.updated_at}


def request_restart() -> dict[str, Any]:
    """Unpause, and bump the counter so every worker restarts its thread once."""
    read_control()
    with session_scope() as session:
        session.execute(update(SchedulerControl)
                        .where(SchedulerControl.id == _CONTROL_ID)
                        .values(paused=False,
                                restart_seq=SchedulerControl.restart_seq + 1,
                                updated_at=datetime.now(timezone.utc)))
    return read_control()


def set_paused(paused: bool) -> dict[str, Any]:
    read_control()
    with session_scope() as session:
        session.execute(update(SchedulerControl)
                        .where(SchedulerControl.id == _CONTROL_ID)
                        .values(paused=paused, updated_at=datetime.now(timezone.utc)))
    return read_control()


_WORKER_FIELDS = ("thread_alive", "started_at", "heartbeat_at", "last_tick_at",
                  "holds_lock", "consecutive_failures", "last_error", "last_error_at",
                  "generation", "restarts")


def publish_worker(worker_id: str, host: str, pid: int, state: dict[str, Any]) -> None:
    """Upsert this worker's row. `state` holds any of _WORKER_FIELDS."""
    values = {k: state.get(k) for k in _WORKER_FIELDS}
    values["consecutive_failures"] = values["consecutive_failures"] or 0
    values["generation"] = values["generation"] or 0
    values["restarts"] = values["restarts"] or 0
    values["thread_alive"] = bool(values["thread_alive"])
    row = {"worker_id": worker_id, "host": host, "pid": pid,
           "reported_at": datetime.now(timezone.utc), **values}
    stmt = insert(SchedulerWorker).values(**row)
    stmt = stmt.on_conflict_do_update(
        index_elements=["worker_id"],
        set_={k: stmt.excluded[k] for k in row if k != "worker_id"})
    with session_scope() as session:
        session.execute(stmt)


def live_workers(within_seconds: float) -> list[dict[str, Any]]:
    """Rows refreshed in the last `within_seconds`; older rows are workers that are gone."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=within_seconds)
    with session_scope() as session:
        rows = session.scalars(select(SchedulerWorker)
                               .where(SchedulerWorker.reported_at >= cutoff)
                               .order_by(SchedulerWorker.worker_id)).all()
        return [{"worker_id": r.worker_id, "host": r.host, "pid": r.pid,
                 "reported_at": r.reported_at,
                 **{k: getattr(r, k) for k in _WORKER_FIELDS}} for r in rows]


def drop_worker(worker_id: str) -> None:
    with session_scope() as session:
        session.execute(delete(SchedulerWorker).where(SchedulerWorker.worker_id == worker_id))


def prune_workers(older_than_seconds: float) -> int:
    """Delete rows of workers that stopped reporting long ago (crashed, never cleaned up)."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=older_than_seconds)
    with session_scope() as session:
        res = session.execute(delete(SchedulerWorker)
                              .where(SchedulerWorker.reported_at < cutoff))
        return res.rowcount or 0
