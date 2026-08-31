"""Clear a stuck-ingest / locked-database jam by stopping the project's running jobs
and terminating jammed Postgres backends.

    python -m core.scripts.ops.unjam              # show the jam, then clear it (asks first)
    python -m core.scripts.ops.unjam --dry-run    # just report what would be stopped
    python -m core.scripts.ops.unjam --yes        # clear without the confirmation prompt
    python -m core.scripts.ops.unjam --db-only     # only terminate DB backends, leave processes
    python -m core.scripts.ops.unjam --procs-only  # only kill processes, leave DB backends

Why this exists: an ingest run (or several app workers) rebuilding a derived table
(`screener_snapshot`, `holder_timeseries`) with DROP+rebuild can deadlock — an
`idle in transaction` connection holds a read lock, a `DROP TABLE` waits for an
exclusive lock behind it, and every reader piles up behind the DROP. The result is a
wedged orchestrator and a hung app. This stops the contenders so you can start clean.

Scope is deliberately narrow:
  - Processes: only THIS project's commands (`core.scripts.*`, `core.api.main`,
    `core.frontend.app`) — matched by the `investing` path, so other projects are
    never touched. Never kills itself or its parent shell.
  - DB backends: only connections to this database that are `idle in transaction` or
    blocked/blocking on locks. Never terminates our own backend.
"""
import argparse
import os
import signal
import subprocess
import sys

from sqlalchemy import text

from core.backend.db.engine import engine

# A process is ours-to-stop if its command line references one of these AND the
# project path — narrow enough to never hit another project's python.
_PROC_MARKERS = ("core.scripts.", "core.api.main", "core.frontend.app")
_PATH_MARKER = "investing"


def _our_processes() -> list[tuple[int, str]]:
    """[(pid, cmdline)] for this project's ingest/app processes, excluding self,
    our parent, and this unjam run."""
    me, parent = os.getpid(), os.getppid()
    try:
        out = subprocess.run(["ps", "-eo", "pid=,command="], capture_output=True, text=True).stdout
    except Exception:
        return []
    found = []
    for line in out.splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue
        pid_s, cmd = line.split(" ", 1)
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        if pid in (me, parent):
            continue
        if "unjam" in cmd:  # never target another unjam (or our own shell wrapper)
            continue
        if _PATH_MARKER in cmd and any(m in cmd for m in _PROC_MARKERS):
            found.append((pid, cmd))
    return found


def _jammed_backends() -> list[tuple[int, str, str]]:
    """[(pid, state, query)] for backends in this DB that are idle-in-transaction or
    blocked/blocking on locks. Never includes our own backend."""
    sql = text("""
        WITH j AS (
            SELECT pid, state, pg_blocking_pids(pid) AS blk, left(query, 60) AS q
            FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
        ),
        targets AS (
            SELECT pid FROM j WHERE state = 'idle in transaction'
            UNION SELECT pid FROM j WHERE cardinality(blk) > 0          -- blocked
            UNION SELECT unnest(blk) FROM j                             -- blockers (roots)
        )
        SELECT j.pid, j.state, j.q FROM j JOIN targets t USING (pid) ORDER BY j.pid
    """)
    with engine.connect() as c:
        return [(r[0], r[1], (r[2] or "").strip()) for r in c.execute(sql)]


def _kill_processes(procs, dry: bool) -> int:
    for pid, cmd in procs:
        short = cmd.split(" -m ", 1)[-1][:70] if " -m " in cmd else cmd[:70]
        if dry:
            print(f"  would SIGTERM pid {pid}: {short}")
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            print(f"  SIGTERM pid {pid}: {short}")
        except ProcessLookupError:
            print(f"  pid {pid} already gone")
        except Exception as exc:
            print(f"  pid {pid} kill failed: {exc}")
    return len(procs)


def _terminate_backends(backends, dry: bool) -> int:
    if dry:
        for pid, st, q in backends:
            print(f"  would terminate backend {pid} [{st}]: {q[:50]}")
        return len(backends)
    n = 0
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        for pid, st, q in backends:
            ok = c.execute(text("SELECT pg_terminate_backend(:p)"), {"p": pid}).scalar()
            print(f"  terminate backend {pid} [{st}] -> {ok}: {q[:45]}")
            n += int(bool(ok))
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="Stop project jobs + clear jammed DB backends.")
    ap.add_argument("--dry-run", action="store_true", help="Report only; change nothing.")
    ap.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    ap.add_argument("--db-only", action="store_true", help="Only terminate DB backends.")
    ap.add_argument("--procs-only", action="store_true", help="Only kill processes.")
    args = ap.parse_args()

    procs = [] if args.db_only else _our_processes()
    backends = [] if args.procs_only else _jammed_backends()

    print(f"Project processes running: {len(procs)}")
    for pid, cmd in procs:
        print(f"  pid {pid}: {cmd.split(' -m ',1)[-1][:70] if ' -m ' in cmd else cmd[:70]}")
    print(f"Jammed DB backends (idle-in-txn / blocked / blocking): {len(backends)}")
    for pid, st, q in backends[:12]:
        print(f"  pid {pid} [{st}]: {q[:50]}")
    if len(backends) > 12:
        print(f"  ... and {len(backends) - 12} more")

    if not procs and not backends:
        print("\nNothing to clear — no project jobs running and no DB jam.")
        return 0
    if args.dry_run:
        print("\n--dry-run: nothing changed.")
        return 0
    if not args.yes:
        if input("\nStop all of the above? [y/N] ").strip().lower() not in ("y", "yes"):
            print("Aborted.")
            return 1

    print("\nStopping processes:")
    _kill_processes(procs, dry=False)
    print("Clearing DB backends:")
    cleared = _terminate_backends(backends, dry=False)

    # report residual jam
    residual = _jammed_backends() if not args.procs_only else []
    print(f"\nDone. Terminated {cleared} backend(s). Residual jam: {len(residual)} backend(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
