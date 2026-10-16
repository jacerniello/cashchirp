"""Keeps every API worker's scheduler thread visible and controllable from any worker.

The API runs as several worker processes, and each one has its own scheduler thread
(see `scheduler.py`). A request reaches only one worker, so neither an in-process
health check nor an in-process restart can see or reach the others.

Each worker therefore runs a small supervisor thread that, every SUPERVISE_SECONDS:

1. reads the shared control row and applies it to this worker's scheduler. If the row
   is paused, the thread is stopped. If the restart counter changed, the thread is
   restarted.
2. publishes this worker's scheduler state to `scheduler_worker`.

`health()` reads every worker's row, so it gives the same answer whichever worker
serves it. Stop and Restart only write the control row, so they reach every worker,
including one whose scheduler thread is dead.

A dead scheduler thread is never restarted automatically. A thread that crashes
should show up on screen, not be quietly replaced.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
from datetime import datetime, timezone
from typing import Any

from core.backend.jobs import scheduler
from core.backend.queries.meta import scheduler_state as q

log = logging.getLogger("cashchirp.scheduler.supervisor")

SUPERVISE_SECONDS = 5.0
# A row not refreshed in this long belongs to a worker that is gone.
WORKER_FRESH_SECONDS = 4 * SUPERVISE_SECONDS
# Rows of workers that died without cleaning up are deleted after a day.
PRUNE_AFTER_SECONDS = 24 * 3600

HOST = socket.gethostname()
PID = os.getpid()
WORKER_ID = f"{HOST}:{PID}"

_thread: threading.Thread | None = None
_stop = threading.Event()
_apply_lock = threading.Lock()
_seen_seq: int | None = None
_paused = False


def _apply(ctl: dict[str, Any]) -> None:
    """Bring this worker's scheduler in line with the control row."""
    global _seen_seq, _paused
    with _apply_lock:
        _paused = ctl["paused"]
        if ctl["paused"]:
            if scheduler.running():
                log.info("scheduler stopped by request (worker %s)", WORKER_ID)
                scheduler.stop()
        elif _seen_seq is not None and ctl["restart_seq"] != _seen_seq:
            log.info("scheduler restart requested (worker %s)", WORKER_ID)
            scheduler.restart()
        _seen_seq = ctl["restart_seq"]


def _publish() -> None:
    snap = scheduler.snapshot()
    q.publish_worker(WORKER_ID, HOST, PID, {**snap, "thread_alive": snap["alive"]})


def sync_now() -> None:
    """Apply the control row and publish now, rather than at the next supervisor pass."""
    _apply(q.read_control())
    _publish()


def _loop() -> None:
    last_prune = 0.0
    while not _stop.wait(SUPERVISE_SECONDS):
        try:
            sync_now()
            if time.monotonic() - last_prune > 3600:
                last_prune = time.monotonic()
                q.prune_workers(PRUNE_AFTER_SECONDS)
        except Exception:
            # Postgres is down or the tables are missing. The scheduler itself reports
            # the same failure through its ticks; keep trying.
            log.exception("scheduler supervisor pass failed")


def start() -> None:
    """Start this worker's scheduler (unless paused) and its supervisor.

    If the database cannot be read at startup, the scheduler starts anyway, as it did
    before the control row existed. The supervisor applies the row once it can.
    """
    global _thread, _seen_seq, _paused
    try:
        q.ensure_tables()
        ctl = q.read_control()
        _seen_seq, _paused = ctl["restart_seq"], ctl["paused"]
    except Exception:
        log.exception("could not read scheduler control; starting the scheduler anyway")
        ctl = {"paused": False}
    if not ctl["paused"]:
        scheduler.start()
    else:
        log.warning("scheduler is stopped by request; not starting it (worker %s)", WORKER_ID)
    if _thread is None or not _thread.is_alive():
        _stop.clear()
        _thread = threading.Thread(target=_loop, name="cashchirp-scheduler-supervisor",
                                   daemon=True)
        _thread.start()
    try:
        _publish()
    except Exception:
        pass


def stop() -> None:
    """On API shutdown: stop both threads and remove this worker's row."""
    _stop.set()
    scheduler.stop()
    try:
        q.drop_worker(WORKER_ID)
    except Exception:
        pass


def request_stop() -> dict[str, Any]:
    q.set_paused(True)
    sync_now()
    return health()


def request_restart() -> dict[str, Any]:
    q.request_restart()
    sync_now()
    return health()


def _iso(v: Any) -> Any:
    return v.isoformat(timespec="seconds") if isinstance(v, datetime) else v


def _worker_view(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    ref = row.get("heartbeat_at") or row.get("started_at") or row["reported_at"]
    since = max(0.0, (now - ref).total_seconds())
    status, reason = scheduler.classify(row["thread_alive"], since,
                                        row.get("consecutive_failures") or 0,
                                        row.get("last_error"))
    return {"status": status, "reason": reason, "seconds_since_heartbeat": round(since, 1),
            "this_worker": row["worker_id"] == WORKER_ID,
            **{k: _iso(v) for k, v in row.items()}}


# When no worker is ok, report the most informative failure.
_PRIORITY = {"failing": 0, "stalled": 1, "stopped": 2}


def health() -> dict[str, Any]:
    """Is scheduling working across all workers?

    Overall status:
      ok       - at least one worker's scheduler is ticking (one firer is enough)
      stopped  - stopped on purpose (`paused`), or no worker has a live thread
      stalled / failing - no worker is ok, and this is the best explanation

    `note` names any worker that is unhealthy while another covers for it.
    """
    base = {"tick_seconds": scheduler.TICK_SECONDS,
            "stall_seconds": scheduler.STALL_SECONDS,
            "supervise_seconds": SUPERVISE_SECONDS}
    try:
        ctl = q.read_control()
        rows = q.live_workers(WORKER_FRESH_SECONDS)
    except Exception as exc:
        # The cross-worker view needs Postgres. Fall back to this worker alone and say so.
        local = scheduler.local_health()
        if local["status"] == "ok":
            local.update(status="failing", healthy=False)
        local["reason"] = f"Cannot read scheduler state from the database: {exc}"[:500]
        return {**base, **local, "paused": False, "note": None, "workers": [],
                "source": "local"}

    now = datetime.now(timezone.utc)
    workers = [_worker_view(r, now) for r in rows]
    if not any(w["this_worker"] for w in workers):
        snap = scheduler.snapshot()
        workers.append(_worker_view({
            "worker_id": WORKER_ID, "host": HOST, "pid": PID, "reported_at": now,
            **{k: v for k, v in snap.items() if k not in ("alive", "seconds_since_heartbeat")},
            "thread_alive": snap["alive"]}, now))

    ok = [w for w in workers if w["status"] == "ok"]
    bad = [w for w in workers if w["status"] != "ok"]
    note = None
    if ctl["paused"]:
        status, reason = "stopped", "Stopped from the Setup page."
    elif ok:
        status, reason = "ok", None
        if bad:
            note = (f"{len(bad)} of {len(workers)} API workers' scheduler is "
                    f"{bad[0]['status']}; the others are covering.")
    else:
        worst = min(bad, key=lambda w: _PRIORITY.get(w["status"], 9))
        status, reason = worst["status"], worst["reason"]
        if len(workers) > 1:
            reason = f"{reason} (all {len(workers)} API workers)"

    return {**base, "status": status, "healthy": status == "ok", "reason": reason,
            "note": note, "paused": ctl["paused"], "restart_seq": ctl["restart_seq"],
            "workers": workers, "source": "database"}
