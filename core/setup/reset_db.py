"""Stop everything, then return the database to bare. Runs as its own job, with a log.

    python -m core.setup.reset_db                 # stop all builds, then reset
    python -m core.setup.reset_db --confirm NAME  # refuse unless NAME matches

A reset takes precedence over any running work. Refusing while a build is in flight would
be the wrong behaviour: the reason to reset is usually that the database is in a state you
no longer want, and being blocked by the very job producing that state is a trap. So this
stops the builds first — cooperatively, then forcibly — and only drops schemas once
nothing is still writing.

It runs detached with its own log for the same reason the ingests do: stopping a build can
take until its current step reaches a boundary, which is minutes on a large table, and
that is far longer than an HTTP request should live.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

from core.config import CORE_DIR, settings

DATA = CORE_DIR / "data"
JOBS_DIR = DATA / "jobs"
BUILD_STOP = DATA / "bootstrap.stop"
BUILD_STATE = DATA / "bootstrap-state.json"

# How long to wait for a cooperative stop before escalating. A step blocked in a long
# Postgres call can take a while to reach the next boundary; past this we stop asking.
GRACE_SECONDS = 45


def say(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _running_pids() -> dict[str, int]:
    """Every bootstrap process this app started: the whole-build run plus per-dataset
    jobs. Read from the state files rather than by scanning, so we only ever signal
    processes this deployment owns."""
    found: dict[str, int] = {}
    if BUILD_STATE.exists():
        try:
            st = json.loads(BUILD_STATE.read_text())
            if _alive(st.get("pid")) and st.get("phase") not in ("done", "failed", "interrupted"):
                found["build"] = int(st["pid"])
        except (OSError, ValueError, KeyError):
            pass
    if JOBS_DIR.is_dir():
        me = os.getpid()
        for f in sorted(JOBS_DIR.glob("*.json")):
            # Skip this job's own state. The API writes jobs/reset.json the instant it
            # spawns us, so without this the reset finds itself in the job list and
            # SIGINTs its own pid — which it does, immediately, every time.
            if f.stem == "reset":
                continue
            try:
                st = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            pid = st.get("pid")
            if pid == me:
                continue
            if _alive(pid) and st.get("phase") not in ("done", "failed", "interrupted"):
                found[f.stem] = int(pid)
    return found


def stop_everything() -> None:
    """Cooperative stop first, then SIGTERM, then SIGKILL.

    The sentinel is what stops a build cleanly — it is checked between steps, so the run
    ends at a resumable boundary. But a reset discards the data anyway, so there is no
    point waiting indefinitely for grace: past the deadline we take the process down."""
    running = _running_pids()
    if not running:
        say("no builds running")
        return

    say(f"stopping {len(running)} running job(s): {', '.join(running)}")
    BUILD_STOP.parent.mkdir(parents=True, exist_ok=True)
    BUILD_STOP.write_text("stop requested by database reset\n")
    if JOBS_DIR.is_dir():
        for name in running:
            if name != "build":
                (JOBS_DIR / f"{name}.stop").write_text("stop requested by database reset\n")
    for name, pid in running.items():
        try:
            os.kill(pid, signal.SIGINT)   # break a step blocked in a driver call
            say(f"  SIGINT -> {name} (pid {pid})")
        except OSError:
            pass

    deadline = time.time() + GRACE_SECONDS
    while time.time() < deadline:
        still = {n: p for n, p in running.items() if _alive(p)}
        if not still:
            say("all jobs stopped cleanly")
            return
        time.sleep(1)

    for name, pid in running.items():
        if _alive(pid):
            say(f"  {name} (pid {pid}) did not stop in {GRACE_SECONDS}s — SIGKILL")
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    time.sleep(1)
    say("all jobs stopped")


def clear_job_files(keep: Path | None) -> int:
    """Job state and logs describe a database that is about to stop existing. `keep` is
    this reset's own log, which must survive — it is what the page is displaying."""
    removed = 0
    for path in (list(JOBS_DIR.glob("*")) if JOBS_DIR.is_dir() else []) + [BUILD_STATE, BUILD_STOP]:
        if keep is not None and path.resolve() == keep.resolve():
            continue
        if path.is_file():
            try:
                path.unlink(); removed += 1
            except OSError:
                pass
    return removed


def main() -> int:
    ap = argparse.ArgumentParser(description="Stop all builds, then reset the database.")
    ap.add_argument("--confirm", default=None,
                    help="Must equal the database name; refuses otherwise.")
    ap.add_argument("--keep-log", default=None,
                    help="Path of this job's own log, so clearing job files spares it.")
    args = ap.parse_args()

    if args.confirm is not None and args.confirm != settings.postgres_db:
        say(f"REFUSED: --confirm must be {settings.postgres_db!r}")
        return 2

    say(f"resetting {settings.postgres_db} on {settings.postgres_host}:{settings.postgres_port}")

    stop_everything()

    from core.backend.db.reset import inventory, reset_database

    before = inventory()
    say(f"before: {before['objects']} objects, {before['size']}")
    say("dropping schemas…")
    result = reset_database()
    after = result["after"]
    say(f"after:  {after['objects']} objects, {after['size']}")
    say(f"recreated {len(result['recreated_tables'])} model tables: "
        f"{', '.join(result['recreated_tables'])}")

    n = clear_job_files(Path(args.keep_log) if args.keep_log else None)
    say(f"cleared {n} stale job file(s)")
    say("reset complete — the database is empty; run a build to repopulate it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
