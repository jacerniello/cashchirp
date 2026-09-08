"""Who is connected to this database, what is blocking what, and how to clear a jam.

Was `core/scripts/ops/unjam.py`, a CLI you had to remember existed and reach a terminal
to run. The logic is the same; it lives here so the Setup UI can show the jam as it
happens rather than only offering to clear one you already diagnosed yourself.

The jam this exists for: a derived rebuild (`screener_snapshot`, `holder_timeseries`)
does DROP+rebuild. An `idle in transaction` connection holds a read lock, the `DROP`
waits for an exclusive lock behind it, and every later reader piles up behind the DROP.
The orchestrator wedges and the app hangs — from the outside, indistinguishable from a
crash.

Scope is deliberately narrow, because this terminates things:
  - **Processes**: only this project's own commands, matched on the project directory
    AND a known module path. Never this process or its parent.
  - **Backends**: only connections to *this* database. Never our own backend.
"""
from __future__ import annotations

import os
import signal
import subprocess
from typing import Any

from sqlalchemy import text

from core.backend.db.engine import engine
from core.config import PROJECT_ROOT

# Module paths this project runs. `core.setup.*` is nearly all bootstrap now, but the
# prefix keeps matching if another entry point is added.
_PROC_MARKERS = ("core.setup.", "core.api.main", "core.backend.jobs")

# The project directory name, taken from PROJECT_ROOT rather than hardcoded. It used to
# be the literal "investing"; the project was renamed to cashchirp and the matcher
# silently stopped finding anything — a kill switch that had quietly become a no-op.
_PATH_MARKER = PROJECT_ROOT.name


_ACTIVITY_SQL = text("""
    SELECT pid,
           coalesce(state, 'unknown')                         AS state,
           coalesce(usename, '')                              AS usename,
           coalesce(application_name, '')                     AS application_name,
           coalesce(client_addr::text, 'local')               AS client,
           coalesce(wait_event_type, '')                      AS wait_event_type,
           coalesce(wait_event, '')                           AS wait_event,
           pg_blocking_pids(pid)                              AS blocked_by,
           left(coalesce(query, ''), 300)                     AS query,
           extract(epoch FROM (now() - query_start))          AS query_seconds,
           extract(epoch FROM (now() - state_change))         AS state_seconds,
           pid = pg_backend_pid()                             AS is_self
    FROM pg_stat_activity
    WHERE datname = current_database()
    ORDER BY cardinality(pg_blocking_pids(pid)) DESC, query_start NULLS LAST
""")


def connections() -> list[dict[str, Any]]:
    """Every backend on this database, newest work first, with what it is waiting on."""
    with engine.connect() as c:
        rows = c.execute(_ACTIVITY_SQL).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["blocked_by"] = list(d["blocked_by"] or [])
        d["query"] = (d["query"] or "").strip()
        for k in ("query_seconds", "state_seconds"):
            d[k] = round(float(d[k]), 1) if d[k] is not None else None
        out.append(d)
    return out


def diagnose(conns: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Summarise a jam: who is blocked, who is doing the blocking, what is idle in
    transaction. `blockers` are the roots — the pids worth terminating first, because
    killing a *blocked* connection frees nothing."""
    conns = connections() if conns is None else conns
    by_pid = {c["pid"]: c for c in conns}

    blocked = [c for c in conns if c["blocked_by"]]
    blocker_pids: set[int] = set()
    for c in blocked:
        blocker_pids.update(c["blocked_by"])
    # A blocker that is itself blocked is not a root; the root is further up the chain.
    roots = [by_pid[p] for p in blocker_pids
             if p in by_pid and not by_pid[p]["blocked_by"]]
    idle_in_txn = [c for c in conns if c["state"] == "idle in transaction"]

    # `jammed` means something is ACTUALLY waiting on a lock. Idle-in-transaction is
    # reported separately and deliberately not treated as a jam on its own: an ingest
    # legitimately parks one to hold the derived-rebuild locks for its whole run
    # (see queries._rebuild.suppress_app_rebuilds). Calling that a jam would invite
    # someone to kill the guard protecting the ingest they are waiting on.
    return {
        "total": len(conns),
        "active": sum(1 for c in conns if c["state"] == "active"),
        "idle_in_transaction": [
            {"pid": c["pid"], "seconds": c["state_seconds"]} for c in idle_in_txn],
        "blocked": [{"pid": c["pid"], "blocked_by": c["blocked_by"]} for c in blocked],
        "blockers": [c["pid"] for c in roots],
        "jammed": bool(blocked),
    }


def jammed_pids() -> list[int]:
    """Backends worth terminating to clear a jam: idle-in-transaction, blocked, and the
    blockers themselves. Excludes our own backend."""
    conns = connections()
    d = diagnose(conns)
    pids = {*(x["pid"] for x in d["idle_in_transaction"]), *d["blockers"],
            *(b["pid"] for b in d["blocked"])}
    return sorted(p for p in pids if not (conns and next(
        (c["is_self"] for c in conns if c["pid"] == p), False)))


def our_processes() -> list[dict[str, Any]]:
    """This project's ingest/app processes, excluding ourselves and our parent."""
    me, parent = os.getpid(), os.getppid()
    try:
        out = subprocess.run(["ps", "-Ao", "pid=,command="],
                             capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return []
    found = []
    for line in out.splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue
        pid_s, cmd = line.split(" ", 1)
        if not pid_s.isdigit():
            continue
        pid = int(pid_s)
        if pid in (me, parent):
            continue
        if _PATH_MARKER in cmd and any(m in cmd for m in _PROC_MARKERS):
            short = cmd.split(" -m ", 1)[-1] if " -m " in cmd else cmd
            found.append({"pid": pid, "command": short[:120]})
    return found


def terminate_backend(pid: int) -> bool:
    """Terminate ONE backend. Refuses our own connection — killing it would drop the
    request doing the killing and report nothing back."""
    with engine.connect() as c:
        if c.execute(text("SELECT pid = pg_backend_pid() FROM pg_stat_activity "
                          "WHERE pid = :p"), {"p": pid}).scalar():
            raise ValueError(f"{pid} is this request's own backend.")
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        return bool(c.execute(text("SELECT pg_terminate_backend(:p)"), {"p": pid}).scalar())


def kill_process(pid: int) -> str:
    """SIGTERM one of *this project's* processes. Anything else is refused — this is a
    kill switch reachable from a browser, so the allowlist is the safety, not the caller."""
    if pid not in {p["pid"] for p in our_processes()}:
        raise ValueError(f"{pid} is not one of this project's processes.")
    try:
        os.kill(pid, signal.SIGTERM)
        return "terminated"
    except ProcessLookupError:
        return "already gone"


def unjam(*, dry_run: bool = False, db_only: bool = False,
          procs_only: bool = False) -> dict[str, Any]:
    """Stop this project's jobs and terminate jammed backends. Reports what it did."""
    procs = [] if db_only else our_processes()
    pids = [] if procs_only else jammed_pids()

    if dry_run:
        return {"dry_run": True, "processes": procs, "backends": pids,
                "would_stop": len(procs) + len(pids)}

    stopped = []
    for p in procs:
        try:
            stopped.append({"pid": p["pid"], "result": kill_process(p["pid"])})
        except ValueError:
            pass
    terminated = []
    for pid in pids:
        try:
            terminated.append({"pid": pid, "ok": terminate_backend(pid)})
        except (ValueError, Exception):
            terminated.append({"pid": pid, "ok": False})

    return {"dry_run": False, "stopped": stopped, "terminated": terminated,
            "residual": diagnose()}
