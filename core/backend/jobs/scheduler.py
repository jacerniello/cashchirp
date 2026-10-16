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
import time
from datetime import datetime, timezone
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
# Bumped on every start. A thread only reports into the health record while it is the
# current generation, so a stalled thread that wakes up after a restart cannot overwrite
# the replacement's heartbeat and make a dead loop look alive.
_generation = 0
_health_lock = threading.Lock()
_health: dict[str, Any] = {}

# A loop that has not reported in this long is stalled, not between ticks. Three missed
# ticks, with a floor so a slow tick that spawns a job is not called a hang.
STALL_SECONDS = max(3 * TICK_SECONDS, 120.0)
# A thread that is alive and ticking but fails every tick (Postgres down, a bad
# migration) fires nothing, so it is unhealthy in the way that matters.
FAILING_AFTER = 3


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _report(gen: int, **fields: Any) -> None:
    with _health_lock:
        if gen == _generation:
            _health.update(fields)


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


# A rate-limit reading every 30 minutes (one tiny API call), so the Setup chart has
# points between ingests and the spacing of resets reveals the window length.
PROBE_SECONDS = 30 * 60
_last_probe = 0.0


def _maybe_probe() -> None:
    global _last_probe
    now = time.monotonic()
    if now - _last_probe < PROBE_SECONDS:
        return
    _last_probe = now
    try:
        from core.backend.ingest.sharadar import ratelimit
        ratelimit.probe()
    except Exception:
        log.exception("rate-limit probe failed")


def _loop(stop_event: threading.Event, gen: int) -> None:
    try:
        while not stop_event.wait(TICK_SECONDS):
            _report(gen, heartbeat_at=_now(), heartbeat_mono=time.monotonic())
            _maybe_probe()
            try:
                res = tick()
                for f in res.get("fired", []):
                    log.info("scheduled run started: %s (pid %s)", f["key"], f.get("pid"))
                for s in res.get("skipped", []):
                    log.warning("scheduled run skipped: %s — %s", s["key"], s.get("reason"))
                t = _now()
                _report(gen, last_tick_at=t, heartbeat_at=t, heartbeat_mono=time.monotonic(),
                        consecutive_failures=0, holds_lock=bool(res.get("locked")))
            except Exception as exc:
                # A scheduler that dies on one bad tick is worse than one that logs and
                # carries on; the next tick may well succeed (a transient DB blip).
                log.exception("scheduler tick failed")
                with _health_lock:
                    if gen == _generation:
                        _health["consecutive_failures"] = _health.get("consecutive_failures", 0) + 1
                        _health["last_error"] = f"{type(exc).__name__}: {exc}"[:500]
                        _health["last_error_at"] = _health["heartbeat_at"] = _now()
                        _health["heartbeat_mono"] = time.monotonic()
    except BaseException as exc:                   # pragma: no cover - last resort
        # Anything that escapes the loop ends the thread. Record why, so the health
        # check can say more than "stopped".
        log.exception("scheduler thread exited")
        _report(gen, last_error=f"thread exited: {type(exc).__name__}: {exc}"[:500],
                last_error_at=_now())
        raise


def start() -> bool:
    """Start the background thread. Idempotent."""
    global _thread, _stop, _generation
    if _thread is not None and _thread.is_alive():
        return False
    with _health_lock:
        _generation += 1
        gen = _generation
        restarts = _health.get("restarts", -1) + 1
        _health.clear()
        _health.update(started_at=_now(), heartbeat_mono=time.monotonic(),
                       consecutive_failures=0, restarts=restarts)
    # A fresh event per thread: setting the old one tells a stalled thread to exit when
    # it wakes, without also stopping the replacement.
    _stop = threading.Event()
    _thread = threading.Thread(target=_loop, args=(_stop, gen),
                               name=f"cashchirp-scheduler-{gen}", daemon=True)
    _thread.start()
    log.info("scheduler started (tick %.0fs, generation %d)", TICK_SECONDS, gen)
    return True


def stop() -> None:
    """Tell the current thread to exit after its current tick (or wait)."""
    _stop.set()


def restart() -> dict[str, Any]:
    """Replace the scheduler thread, whatever state the old one is in.

    Python cannot kill a thread, so a stalled one is only told to stop and orphaned; it
    exits when its current call returns. That is safe to run beside the replacement:
    the advisory lock admits one tick at a time, whichever thread holds it.
    """
    global _thread
    stop()
    old = _thread
    if old is not None:
        old.join(timeout=2.0)
    orphaned = old is not None and old.is_alive()
    if orphaned:
        log.warning("scheduler thread %s did not stop; orphaning it", old.name)
    _thread = None
    start()
    return {"restarted": True, "orphaned_previous": orphaned}


def running() -> bool:
    return _thread is not None and _thread.is_alive()


def classify(alive: bool, since: float, fails: int,
             last_error: str | None) -> tuple[str, str | None]:
    """One worker's status from what it reported. Shared by the in-process view and the
    cross-worker one, so both apply the same thresholds.

      ok       - alive and reported in recently
      failing  - alive, but the last FAILING_AFTER ticks all raised
      stalled  - alive, but silent for STALL_SECONDS (stuck inside a tick)
      stopped  - no live thread
    """
    if not alive:
        return "stopped", last_error or "The scheduler thread is not running."
    if since > STALL_SECONDS:
        return "stalled", f"No heartbeat for {since:.0f}s — stuck inside a tick."
    if fails >= FAILING_AFTER:
        return "failing", f"The last {fails} ticks failed: {last_error}"
    return "ok", None


def snapshot() -> dict[str, Any]:
    """This process's scheduler as raw fields: what the supervisor publishes."""
    with _health_lock:
        h = dict(_health)
    since = time.monotonic() - h.pop("heartbeat_mono", time.monotonic())
    return {**h, "alive": running(), "seconds_since_heartbeat": since,
            "generation": _generation}


def local_health() -> dict[str, Any]:
    """THIS process's scheduler only. With several API workers, use supervisor.health()."""
    snap = snapshot()
    status, reason = classify(snap["alive"], snap["seconds_since_heartbeat"],
                              snap.get("consecutive_failures", 0), snap.get("last_error"))
    out = {k: (v.isoformat(timespec="seconds") if isinstance(v, datetime) else v)
           for k, v in snap.items()}
    out["seconds_since_heartbeat"] = round(snap["seconds_since_heartbeat"], 1)
    return {"status": status, "healthy": status == "ok", "reason": reason, **out}
