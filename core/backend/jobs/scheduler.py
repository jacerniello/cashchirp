"""The scheduler: fires due job schedules, and closes out runs whose process has gone.

A daemon thread inside the API process, not cron and not systemd timers. The trade is
deliberate: schedules live in Postgres, so they survive a restart and the UI can edit
them without root or a shell; the cost is that nothing fires while the API is stopped.
For a tool whose whole control surface is that same API, an ingest that runs while the
app is down would be a scheduled job nobody could watch, stop, or read the log of.

Two safeguards matter more than the cadence maths:

- **One firer.** A Postgres advisory lock is held for each tick, so two API processes
  (a reload, a second worker, a stray `uvicorn`) cannot start the same ingest twice.
- **No overlap.** A schedule whose job is already running is skipped and advanced, not
  queued. Two concurrent pulls of the same table would race on the same state file and
  the same rows.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from sqlalchemy import text

from core.backend import sources
from core.backend.db.engine import engine
from core.backend.jobs import runtime as rt
from core.backend.queries.meta import jobs as q

log = logging.getLogger("cashchirp.scheduler")

# Arbitrary but fixed: the pair identifies THIS lock among any other advisory locks.
_LOCK_KEY = (0x0CA5, 0x5CED)

# Ticks are cheap (one indexed query) and the finest cadence is 5 minutes, so 30s is
# frequent enough to feel prompt without polling hard.
TICK_SECONDS = 30.0

_thread: threading.Thread | None = None
_stop = threading.Event()


def _outcome(run: Any) -> tuple[str, int | None, str | None]:
    """The real result of a finished run, read from the job's own state file.

    Without this a dead process is only known to be dead, and the history would show
    "unknown" for every completed job — which is exactly the question the history exists
    to answer.
    """
    try:
        st = rt._job_state(run.key) if run.kind == "dataset" else {}
    except Exception:
        return ("unknown", None, None)
    phase, status = st.get("phase"), st.get("status")
    if status in ("ok", "FAIL", "skipped"):
        return ({"ok": "ok", "FAIL": "failed", "skipped": "ok"}[status],
                st.get("rows"), st.get("detail") or None)
    if phase == "done":
        return ("ok", st.get("rows"), st.get("detail") or None)
    if phase == "failed":
        return ("failed", None, st.get("detail") or None)
    if phase == "interrupted":
        return ("stopped", None, "stopped before finishing")
    # Spawned, then died without the state file ever leaving "starting": bootstrap exits
    # this way when preflight blocks it. The process is gone and it did no work, so that
    # is a failure — reporting "unknown" would hide a job that never ran behind a word
    # that sounds like a reporting gap.
    if phase in ("starting", None) and not st.get("running"):
        return ("failed", None, "exited before starting work — see the log")
    return ("unknown", None, None)


def reconcile_runs() -> int:
    """Finalise runs whose pid is gone. Safe to call from anywhere."""
    return q.reconcile(lambda pid: rt._alive(pid), _outcome)


def fire(schedule: dict[str, Any]) -> dict[str, Any]:
    """Start one schedule's job now, and record it as a scheduled run.

    Returns a result dict rather than raising: a schedule that cannot run (unknown key,
    already running) must not take down the tick that would have fired the others.
    """
    key, mode = schedule["key"], schedule.get("mode") or "update"
    sid = schedule["id"]

    if key.startswith("build:"):
        return _fire_build(sid, key.split(":", 1)[1] or "all", mode)

    ds = sources.BY_KEY.get(key)
    if ds is None:
        return {"fired": False, "reason": f"unknown dataset {key!r}"}
    if rt._job_state(key)["running"]:
        return {"fired": False, "reason": "already running"}

    try:
        info = rt.spawn_dataset(key, mode)
    except Exception as exc:                       # pragma: no cover - defensive
        q.start_run(key=key, kind="dataset", trigger="scheduled", label=ds.label,
                    mode=mode, schedule_id=sid)
        return {"fired": False, "reason": str(exc)}

    run_id = q.start_run(key=key, kind="dataset", trigger="scheduled", label=ds.label,
                         mode=mode, pid=info["pid"], log=info["log_name"],
                         schedule_id=sid)
    return {"fired": True, "pid": info["pid"], "run_id": run_id}


def _fire_build(sid: int, kind: str, mode: str) -> dict[str, Any]:
    if rt.build_running():
        return {"fired": False, "reason": "a build is already running"}
    try:
        info = rt.spawn_build(kind, mode)
    except Exception as exc:                       # pragma: no cover - defensive
        return {"fired": False, "reason": str(exc)}
    run_id = q.start_run(key=f"build:{kind}", kind="build", trigger="scheduled",
                         label=f"{kind} build", mode=mode, pid=info["pid"],
                         log=info["log_name"], schedule_id=sid)
    return {"fired": True, "pid": info["pid"], "run_id": run_id}


def tick() -> dict[str, Any]:
    """One pass: close out finished runs, then fire whatever is due.

    Holds an advisory lock for the whole pass. If another process holds it we do
    nothing at all rather than wait — the next tick is 30 seconds away, and a queue of
    blocked ticks all firing at once is the opposite of what a scheduler is for.
    """
    fired, skipped = [], []
    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:a, :b)"),
                           {"a": _LOCK_KEY[0], "b": _LOCK_KEY[1]}).scalar()
        if not got:
            return {"locked": False, "fired": [], "skipped": []}
        try:
            closed = reconcile_runs()
            for s in q.due_schedules():
                res = fire(s)
                # Advance whether or not it fired. A schedule that stays due because its
                # job was busy would retry every tick and, worse, fire the moment the
                # job ends — turning "every 6 hours" into "immediately, forever".
                q.advance_schedule(s["id"])
                (fired if res.get("fired") else skipped).append(
                    {"id": s["id"], "key": s["key"], **res})
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:a, :b)"),
                         {"a": _LOCK_KEY[0], "b": _LOCK_KEY[1]})
            conn.commit()
    return {"locked": True, "closed": closed, "fired": fired, "skipped": skipped}


def _loop() -> None:
    while not _stop.wait(TICK_SECONDS):
        try:
            res = tick()
            for f in res.get("fired", []):
                log.info("scheduled run started: %s (pid %s)", f["key"], f.get("pid"))
            for s in res.get("skipped", []):
                log.warning("scheduled run skipped: %s — %s", s["key"], s.get("reason"))
        except Exception:
            # A scheduler that dies on one bad tick is worse than one that logs and
            # carries on; the next tick may well succeed (a transient DB blip).
            log.exception("scheduler tick failed")


def start() -> bool:
    """Start the background thread. Idempotent."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return False
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="cashchirp-scheduler", daemon=True)
    _thread.start()
    log.info("scheduler started (tick %.0fs)", TICK_SECONDS)
    return True


def stop() -> None:
    _stop.set()


def running() -> bool:
    return _thread is not None and _thread.is_alive()
