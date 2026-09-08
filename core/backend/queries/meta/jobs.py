"""Job schedules and the run history behind them.

Two things live here:

- **schedules** — standing instructions to run a job on a cadence, plus the arithmetic
  for "when does this fire next".
- **runs** — the process-level ledger. Every job the app spawns is written here the
  instant it starts, tagged with *how it was triggered*, so the history can say which
  runs were scheduled and which somebody clicked.

Why a separate table from `load_log`: that ledger is written by the loaders, per ingested
dataset, and knows nothing about who asked or whether the process survived. It also never
sees a build or a reset. This one is about processes, not rows.

Times are local wall-clock. "Run it at 03:00" means the reader's 03:00, not UTC, so the
cadence maths works on aware local datetimes and stores them as-is.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable

from sqlalchemy import select

from core.backend.db.engine import session_scope
from core.backend.db.models import JobRun, JobSchedule

CADENCES = ("interval", "daily", "weekly")
MODES = ("update", "missing", "full")
TRIGGERS = ("manual", "scheduled", "cli")

# Below this an "interval" schedule is really a busy-loop against a paid API, and the
# jobs it starts would overlap themselves. Rejected rather than silently clamped: a
# schedule that does not do what its own row says is worse than an error.
MIN_INTERVAL_MINUTES = 5


def now_local() -> datetime:
    """Aware local time. One definition, so scheduling and display cannot disagree."""
    return datetime.now().astimezone()


# --------------------------------------------------------------------------- cadence


def _parse_hhmm(at_time: str | None) -> tuple[int, int]:
    try:
        h, m = (at_time or "03:00").split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"at_time must be HH:MM, got {at_time!r}") from exc
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError(f"at_time out of range: {at_time!r}")
    return h, m


def next_occurrence(
    cadence: str,
    *,
    interval_minutes: int | None = None,
    at_time: str | None = None,
    weekday: int | None = None,
    after: datetime | None = None,
) -> datetime:
    """The first firing strictly after `after`.

    Strictly after, always: computing "the next one" from a time that is itself due
    would return that same instant and the scheduler would fire it forever.
    """
    after = after or now_local()

    if cadence == "interval":
        mins = int(interval_minutes or 0)
        if mins < MIN_INTERVAL_MINUTES:
            raise ValueError(
                f"interval must be at least {MIN_INTERVAL_MINUTES} minutes, got {mins}")
        return after + timedelta(minutes=mins)

    h, m = _parse_hhmm(at_time)
    candidate = after.replace(hour=h, minute=m, second=0, microsecond=0)

    if cadence == "daily":
        if candidate <= after:
            candidate += timedelta(days=1)
        return candidate

    if cadence == "weekly":
        wd = 6 if weekday is None else int(weekday)
        if not (0 <= wd <= 6):
            raise ValueError(f"weekday must be 0..6 (Mon..Sun), got {weekday}")
        ahead = (wd - candidate.weekday()) % 7
        candidate += timedelta(days=ahead)
        if candidate <= after:
            candidate += timedelta(days=7)
        return candidate

    raise ValueError(f"cadence must be one of {CADENCES}, got {cadence!r}")


def describe(s: JobSchedule) -> str:
    """The cadence in words, for the UI and the logs."""
    if s.cadence == "interval":
        mins = s.interval_minutes or 0
        if mins % 1440 == 0:
            return f"every {mins // 1440}d"
        if mins % 60 == 0:
            return f"every {mins // 60}h"
        return f"every {mins}m"
    if s.cadence == "daily":
        return f"daily at {s.at_time}"
    days = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    wd = days[s.weekday] if s.weekday is not None and 0 <= s.weekday <= 6 else "?"
    return f"{wd} at {s.at_time}"


def as_dict(s: JobSchedule) -> dict[str, Any]:
    return {
        "id": s.id, "key": s.key, "mode": s.mode, "cadence": s.cadence,
        "interval_minutes": s.interval_minutes, "at_time": s.at_time,
        "weekday": s.weekday, "enabled": s.enabled, "note": s.note,
        "summary": describe(s),
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
    }


# --------------------------------------------------------------------------- schedules


def list_schedules() -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = list(session.scalars(
            select(JobSchedule).order_by(JobSchedule.enabled.desc(),
                                         JobSchedule.next_run_at.asc().nullslast(),
                                         JobSchedule.id.asc())))
        return [as_dict(r) for r in rows]


def create_schedule(
    *, key: str, cadence: str, mode: str = "update",
    interval_minutes: int | None = None, at_time: str | None = None,
    weekday: int | None = None, enabled: bool = True, note: str | None = None,
) -> dict[str, Any]:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    nxt = next_occurrence(cadence, interval_minutes=interval_minutes,
                          at_time=at_time, weekday=weekday)
    with session_scope() as session:
        s = JobSchedule(
            key=key, mode=mode, cadence=cadence, interval_minutes=interval_minutes,
            at_time=at_time, weekday=weekday, enabled=enabled, note=note,
            next_run_at=nxt if enabled else None,
        )
        session.add(s)
        session.flush()
        return as_dict(s)


def update_schedule(schedule_id: int, **fields: Any) -> dict[str, Any] | None:
    """Patch a schedule. Any change to cadence — or re-enabling — recomputes
    `next_run_at`, so the stored answer can never describe the old cadence."""
    touches_cadence = {"cadence", "interval_minutes", "at_time", "weekday"} & fields.keys()
    with session_scope() as session:
        s = session.get(JobSchedule, schedule_id)
        if s is None:
            return None
        for k, v in fields.items():
            if hasattr(s, k):
                setattr(s, k, v)
        if s.mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}, got {s.mode!r}")
        if not s.enabled:
            s.next_run_at = None
        elif touches_cadence or "enabled" in fields or s.next_run_at is None:
            s.next_run_at = next_occurrence(
                s.cadence, interval_minutes=s.interval_minutes,
                at_time=s.at_time, weekday=s.weekday)
        session.flush()
        return as_dict(s)


def delete_schedule(schedule_id: int) -> bool:
    with session_scope() as session:
        s = session.get(JobSchedule, schedule_id)
        if s is None:
            return False
        session.delete(s)
        return True


def due_schedules(at: datetime | None = None) -> list[dict[str, Any]]:
    """Enabled schedules whose next firing has arrived."""
    at = at or now_local()
    with session_scope() as session:
        rows = list(session.scalars(
            select(JobSchedule)
            .where(JobSchedule.enabled.is_(True), JobSchedule.next_run_at.isnot(None),
                   JobSchedule.next_run_at <= at)
            .order_by(JobSchedule.next_run_at.asc())))
        return [as_dict(r) for r in rows]


def advance_schedule(schedule_id: int, fired_at: datetime | None = None) -> None:
    """Move a schedule past the firing that just happened.

    Called whether or not the job actually started — a schedule that could not run
    because its job was already running must still move on, or it stays due forever and
    retries every tick.
    """
    fired_at = fired_at or now_local()
    with session_scope() as session:
        s = session.get(JobSchedule, schedule_id)
        if s is None:
            return
        s.last_run_at = fired_at
        s.next_run_at = next_occurrence(
            s.cadence, interval_minutes=s.interval_minutes, at_time=s.at_time,
            weekday=s.weekday, after=fired_at) if s.enabled else None


# --------------------------------------------------------------------------- runs


def start_run(
    *, key: str, kind: str, trigger: str, label: str | None = None,
    mode: str | None = None, pid: int | None = None, log: str | None = None,
    schedule_id: int | None = None,
) -> int | None:
    """Record a run at the moment it is spawned. Best-effort: the ledger must never be
    the reason a job fails to start."""
    try:
        with session_scope() as session:
            r = JobRun(key=key, kind=kind, trigger=trigger, label=label, mode=mode,
                       pid=pid, log=log, schedule_id=schedule_id, status="running")
            session.add(r)
            session.flush()
            return r.id
    except Exception:
        return None


def finish_run(run_id: int | None, *, status: str, rows: int | None = None,
               detail: str | None = None) -> None:
    if run_id is None:
        return
    try:
        with session_scope() as session:
            r = session.get(JobRun, run_id)
            if r is None or r.status != "running":
                return
            r.status = status
            r.rows = rows
            r.detail = detail
            r.finished_at = now_local()
    except Exception:
        pass


def reconcile(is_alive: Callable[[int | None], bool],
              outcome: Callable[[JobRun], tuple[str, int | None, str | None]] | None = None,
              ) -> int:
    """Close out runs whose process is gone.

    Jobs are detached, so nothing observes a child exiting. Rather than leave rows stuck
    in `running` forever — which would make the history lie, and would block the next
    scheduled firing — every read of the history first checks liveness and finalises
    what has died. `outcome` lets the caller supply the real status from the job's own
    state file; without it a dead run is recorded as finished with unknown detail.
    """
    closed = 0
    try:
        with session_scope() as session:
            for r in session.scalars(select(JobRun).where(JobRun.status == "running")):
                if is_alive(r.pid):
                    continue
                status, rows, detail = ("unknown", None, None)
                if outcome is not None:
                    try:
                        status, rows, detail = outcome(r)
                    except Exception:
                        pass
                r.status = status
                r.rows = rows if rows is not None else r.rows
                r.detail = detail or r.detail
                r.finished_at = now_local()
                closed += 1
    except Exception:
        return closed
    return closed


def recent_runs(limit: int = 100, key: str | None = None,
                trigger: str | None = None) -> list[dict[str, Any]]:
    with session_scope() as session:
        stmt = select(JobRun).order_by(JobRun.started_at.desc()).limit(max(1, min(limit, 500)))
        if key:
            stmt = stmt.where(JobRun.key == key)
        if trigger:
            stmt = stmt.where(JobRun.trigger == trigger)
        out = []
        for r in session.scalars(stmt):
            secs = None
            if r.finished_at and r.started_at:
                secs = round((r.finished_at - r.started_at).total_seconds(), 1)
            out.append({
                "id": r.id, "key": r.key, "label": r.label, "kind": r.kind,
                "trigger": r.trigger, "schedule_id": r.schedule_id, "mode": r.mode,
                "status": r.status, "pid": r.pid, "log": r.log, "rows": r.rows,
                "detail": r.detail,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "seconds": secs,
            })
        return out
