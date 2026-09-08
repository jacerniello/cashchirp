"""Setup endpoints — what this database actually contains, and what's missing.

    GET /api/v1/setup/status    per-dataset: expected vs loaded, plus preflight + live build
    GET /api/v1/setup/sources   the data-source registry (provenance)

This exists because of the degradation rule in CLAUDE.md. Every data page in this app
fails identically against an empty database — a 500 that reads like a broken deploy when
the real answer is "you haven't loaded SEP yet". This endpoint is the difference between
those two, and it is deliberately the ONE route that works when nothing else does:
`/status` answers from the registry and `pg_class` alone, so it still returns something
useful when there are no tables at all.

It reports; it does not build. Kicking off a multi-hour ingest from a web request would
outlive the request, hold no terminal to Ctrl-C, and give no way to answer "should I
really re-download 35 GB?" — so the page shows you the command and you run it yourself.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.backend import sources
from core.config import CORE_DIR, PROJECT_ROOT, settings

router = APIRouter(prefix="/setup", tags=["setup"])

STATE_PATH = CORE_DIR / "data" / "bootstrap-state.json"


def _table_stats() -> dict[str, dict[str, Any]]:
    """Row estimate + on-disk size per table, in one query.

    `reltuples` (an estimate) rather than `count(*)`: an exact count on `sep` is a
    45M-row scan, and this endpoint has to stay fast on the page that loads when
    everything else is broken. Returns {} rather than raising if the DB is unreachable —
    "can't connect" is itself a status worth rendering."""
    try:
        from sqlalchemy import text

        from core.backend.db.engine import engine
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT n.nspname AS schema, c.relname AS name,
                       GREATEST(c.reltuples::bigint, 0) AS rows,
                       pg_total_relation_size(c.oid) AS bytes,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'm', 'p')
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            """)).all()
        # Keyed BOTH ways: not every table is in `public` (derived.insider isn't), so a
        # registry entry may name it either bare or schema-qualified and must still match.
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            stat = {"rows": int(r.rows), "bytes": int(r.bytes), "size": r.size}
            out[f"{r.schema}.{r.name}"] = stat
            out.setdefault(r.name, stat)
        return out
    except Exception:
        return {}


def _live_build() -> dict[str, Any] | None:
    """The in-flight (or last) `bootstrap` run, read off the state file it writes after
    every step. Lets the page show a six-hour backfill's progress without a terminal."""
    if not STATE_PATH.exists():
        return None
    try:
        state = json.loads(STATE_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None       # a half-written file is not an error worth surfacing
    if not isinstance(state, dict):
        return None
    # Guarantee the shape the client indexes into. A state file written by an older
    # version, or by hand, would otherwise reach the page missing `steps` and crash it.
    state.setdefault("steps", [])
    if not isinstance(state["steps"], list):
        state["steps"] = []
    return state


@router.get("/status")
@router.get("/status/")
def status() -> dict[str, Any]:
    """Expected (from the registry) vs actual (from the database), dataset by dataset."""
    stats = _table_stats()
    connected = bool(stats) or _db_reachable()
    last = _last_runs()
    # `load_log` keys ingest rows by the provider's dataset name, not our registry key —
    # match on the endpoint (SHARADAR/SEP) and fall back to the table name.
    def _last_for(d, job: dict[str, Any]) -> dict[str, Any] | None:
        for cand in (d.endpoint, d.endpoint.split("/")[-1], *d.tables):
            if cand in last:
                return {**last[cand], "source": "load_log"}
        # Derived rebuilds don't write load_log rows, so their only record of a run is
        # their own job state. Reported with `source` so "never run here" is not confused
        # with "never run" — the nightly orchestrator rebuilds them without touching this.
        if job.get("updated_at") and job.get("status"):
            return {"status": job["status"], "rows": job.get("rows"),
                    "at": job["updated_at"], "source": "job"}
        return None

    datasets = []
    loaded_mb = 0
    for d in sources.DATASETS:
        tables = [{"name": t, **stats.get(t, {"rows": 0, "bytes": 0, "size": "—"})}
                  for t in d.tables]
        have_rows = sum(t["rows"] for t in tables)
        have_bytes = sum(t["bytes"] for t in tables)
        loaded_mb += have_bytes / 1_048_576
        # No declared table (schema, some derived rebuilds) => nothing to measure; report
        # "unknown" rather than implying it's missing.
        state = ("unknown" if not d.tables
                 else "loaded" if have_rows > 0
                 else "missing")
        src = sources.SOURCES[d.source]
        job = _job_state(d.key)
        datasets.append({
            "key": d.key, "label": d.label, "phase": d.phase,
            "source": {"id": d.source, "provider": src.provider, "short": src.short,
                       "licence": src.licence, "url": src.url},
            "endpoint": d.endpoint, "mode": d.mode, "note": d.note,
            "expected_mb": d.size_mb, "expected_size": d.size_h,
            "tables": tables, "rows": have_rows,
            "size": _human(have_bytes) if have_bytes else "—",
            "state": state,
            # Its own job (own process, own log) and when it last completed.
            "job": job,
            "last_run": _last_for(d, job),
        })

    phases = []
    for phase, desc in sources.PHASES:
        ds = [x for x in datasets if x["phase"] == phase]
        phases.append({
            "id": phase, "description": desc, "count": len(ds),
            "loaded": sum(1 for x in ds if x["state"] == "loaded"),
            "missing": sum(1 for x in ds if x["state"] == "missing"),
            "expected_size": sources.size_h(sources.total_mb((phase,))),
        })

    n_loaded = sum(1 for d in datasets if d["state"] == "loaded")
    n_known = sum(1 for d in datasets if d["state"] != "unknown")
    return {
        "database": {
            "name": settings.postgres_db,
            "host": f"{settings.postgres_host}:{settings.postgres_port}",
            "connected": connected,
            "tables": len(stats),
        },
        "summary": {
            "datasets": len(datasets),
            "loaded": n_loaded,
            "missing": n_known - n_loaded,
            "expected_size": sources.size_h(sources.total_mb()),
            "loaded_size": _human(int(loaded_mb * 1_048_576)),
            "complete": n_known > 0 and n_loaded == n_known,
            "empty": n_loaded == 0,
        },
        "credentials": [
            {"env": env, "unlocks": providers,
             "set": bool(str(getattr(settings, env.lower(), "") or "").strip())}
            for env, providers in sources.required_env()
        ],
        "phases": phases,
        "work": {
            kind: {
                "datasets": sum(1 for d in datasets if d["phase"] in ph),
                "loaded": sum(1 for d in datasets
                              if d["phase"] in ph and d["state"] == "loaded"),
                "expected_size": sources.size_h(sources.total_mb(ph)),
            }
            for kind, ph in (("ingest", sources.INGEST_PHASES),
                             ("derive", sources.DERIVE_PHASES))
        },
        "datasets": datasets,
        "build": _live_build(),
        "build_status": _build_status(),
    }


@router.get("/sources")
@router.get("/sources/")
def source_registry() -> dict[str, Any]:
    """The data-source registry — provider, licence, credential, cadence, size."""
    out = []
    for sid, src in sources.SOURCES.items():
        ds = sources.by_phase(sid) or [d for d in sources.DATASETS if d.source == sid]
        if not ds:
            continue
        out.append({
            "id": sid, "provider": src.provider, "short": src.short,
            "blurb": src.blurb, "licence": src.licence, "cadence": src.cadence,
            "auth_env": src.auth_env, "url": src.url, "docs_url": src.docs_url,
            "caveat": src.caveat,
            "datasets": len(ds),
            "size": sources.size_h(sum(d.size_mb for d in ds)),
        })
    return {"sources": out, "total_size": sources.size_h(sources.total_mb())}


def _db_reachable() -> bool:
    try:
        from sqlalchemy import text

        from core.backend.db.engine import engine
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} PB"


# --------------------------------------------------------------- build control

# A build is a DETACHED subprocess, never work done inside the request. A 6-hour, 35 GB
# ingest cannot live in an HTTP handler: the request would time out, the client would
# retry, and there would be no way to interrupt it. So the API only ever starts, signals
# and reports on a process that owns itself — which is also why closing the browser (or
# restarting this API) leaves a running build untouched.
_STOP_PATH = CORE_DIR / "data" / "bootstrap.stop"


# One `ps` scan per second, shared by every liveness check. The previous version shelled
# out per PID, and /setup/status checks ~24 datasets — so a single poll spawned two dozen
# subprocesses, every two seconds, and the endpoint started timing out under load. The
# cache makes the whole page cost one `ps`.
_PS_TTL = 1.0
_ps_cache: dict[str, Any] = {"at": 0.0, "procs": {}}


def _bootstrap_procs() -> dict[int, str]:
    """`{pid: command}` for this project's bootstrap runs, cached briefly."""
    now = time.time()
    if now - _ps_cache["at"] < _PS_TTL:
        return _ps_cache["procs"]
    procs: dict[int, str] = {}
    try:
        out = subprocess.run(["ps", "-Ao", "pid=,command="],
                             capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            line = line.strip()
            pid_s, _, cmd = line.partition(" ")
            if "core.scripts.setup.bootstrap" in cmd and pid_s.isdigit():
                procs[int(pid_s)] = cmd
    except (OSError, subprocess.SubprocessError):
        # Can't enumerate — fall back to "assume alive" rather than declaring a live
        # build dead, which would let a second one start on top of it.
        return _ps_cache["procs"]
    _ps_cache.update(at=now, procs=procs)
    return procs


def _alive(pid: int | None, marker: str | None = None) -> bool:
    """Is that PID still running, and is it still OURS?

    PIDs are recycled, so a stale job file pointing at a number the OS has since handed to
    an unrelated process would report a build running for ever — and the start guard would
    refuse to launch a new one, with no way out but deleting files by hand. So the command
    line is checked too: it must be a bootstrap run, and match `marker` when given."""
    if not pid:
        return False
    cmd = _bootstrap_procs().get(int(pid))
    if cmd is None:
        return False
    return marker is None or marker in cmd


def _build_status() -> dict[str, Any]:
    """Current build, from the state file plus a liveness check on its PID.

    The phase alone is not enough: a killed process leaves `phase: sharadar` behind
    forever, so a page trusting it would show a build running that died days ago."""
    st = _live_build() or {}
    pid = st.get("pid")
    running = _alive(pid) and st.get("phase") not in ("done", "failed", "interrupted")
    steps = st.get("steps") or []
    done = sum(1 for s in steps if s.get("status") in ("ok", "skipped", "FAIL"))
    frac = sum(s.get("frac", 0) for s in steps
               if s.get("status") == "running" and s.get("frac_known"))
    return {
        "running": running,
        "pid": pid if running else None,
        "phase": st.get("phase"),
        "started_at": st.get("started_at"),
        "updated_at": st.get("updated_at"),
        "elapsed_seconds": st.get("elapsed_seconds"),
        # Anything that stopped before finishing can be picked up where it left off,
        # because bootstrap skips steps whose table already holds rows.
        "can_resume": (not running) and bool(steps)
                      and st.get("phase") in ("interrupted", "failed", "starting",
                                              "schema", "sharadar", "fred", "finra",
                                              "sec", "derived"),
        "progress_pct": round((done + frac) / len(steps) * 100, 1) if steps else 0.0,
        "steps_done": done,
        "steps_total": len(steps),
        "log": str(_LOGS_DIR),
        "stopping": _STOP_PATH.exists(),
    }


class BuildRequest(BaseModel):
    """What to build.

    `kind` is the main control and maps to registry phase groups:
      * `ingest`  — download from the providers (hours, network-bound, rate-limited)
      * `derive`  — recompute the derived tables from data already local (minutes, free,
                    safe to re-run)
      * `all`     — schema, then ingest, then derive, in dependency order

    `phases` / `only` narrow it further. Every value is validated against the registry —
    nothing here is ever passed to a subprocess as free text."""

    kind: str = "all"
    phases: list[str] = []
    only: list[str] = []
    # What to do with data that is already there:
    #   update  - pull only what changed since the last run (the routine action)
    #   missing - touch nothing that already has rows; fetch what was never loaded
    #   full    - re-download each table's bulk export from scratch (hours)
    mode: str = "update"
    force: bool = False   # deprecated alias for mode="update"


@router.post("/build")
def start_build(req: BuildRequest) -> dict[str, Any]:
    """Start (or resume) a build as a detached process.

    Resume is the same call: `bootstrap` skips steps whose table already holds rows, so
    restarting after a stop costs only the step it was interrupted in. There is no
    separate resume endpoint because there is no separate operation."""
    status = _build_status()
    if status["running"]:
        raise HTTPException(
            status_code=409,
            detail=f"A build is already running (pid {status['pid']}). Stop it first.",
        )

    if req.mode not in ("update", "missing", "full"):
        raise HTTPException(400, f"mode must be update|missing|full, got {req.mode!r}")
    if req.kind not in ("all", "ingest", "derive"):
        raise HTTPException(400, f"kind must be all|ingest|derive, got {req.kind!r}")

    valid_phases = {p for p, _ in sources.PHASES}
    bad = [p for p in req.phases if p not in valid_phases]
    if bad:
        raise HTTPException(400, f"Unknown phase(s) {bad}. Valid: {sorted(valid_phases)}")

    valid_tables = {d.key.split(":", 1)[1] for d in sources.DATASETS if d.phase == "sharadar"}
    bad = [t for t in req.only if t.upper() not in valid_tables]
    if bad:
        raise HTTPException(400, f"Unknown table(s) {bad}. Valid: {sorted(valid_tables)}")

    # argv list, never a shell string, and every element is either a literal or a value
    # that just passed a whitelist above.
    # `-u`: unbuffered stdout. Python block-buffers when stdout is a FILE rather than a
    # terminal, so without this the first few KB of output — preflight, the early steps —
    # sit in the child's buffer and the live log looks empty while work is plainly
    # happening. The whole point of streaming it is defeated by a 4 KB buffer.
    argv = [sys.executable, "-u", "-m", "core.scripts.setup.bootstrap", "--create-db",
            "--plain"]
    # An explicit phase list wins; otherwise `kind` selects the group. Schema rides along
    # with an ingest run because it is idempotent and an ingest into missing tables fails.
    phases = req.phases
    if not phases and req.kind == "ingest":
        phases = ["schema", *sources.INGEST_PHASES]
    elif not phases and req.kind == "derive":
        phases = list(sources.DERIVE_PHASES)
    if phases:
        argv += ["--only-phase", *phases]
    if req.only:
        argv += ["--only", *(t.upper() for t in req.only)]
    # `missing` is the only mode that leaves populated tables alone; the other two both
    # re-run every step, differing in whether Sharadar syncs new rows or re-downloads.
    mode = "update" if req.force and req.mode == "missing" else req.mode
    if mode == "full":
        argv.append("--full")
    elif mode == "update":
        argv.append("--force")

    # A sentinel left by a previous stop would halt this run before it began.
    _STOP_PATH.unlink(missing_ok=True)
    _rotate_logs(None)
    log_path = _new_log(None)
    log = open(log_path, "ab", buffering=0)  # noqa: SIM115 - owned by the child
    try:
        proc = subprocess.Popen(
            argv, cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            # Its own session: the build outlives this request, this connection, and a
            # restart of the API. Without it, a reload would take the ingest down with it.
            start_new_session=True,
        )
    finally:
        log.close()
    _mark_starting(STATE_PATH, proc.pid, log_path)
    return {"started": True, "kind": req.kind, "mode": mode, "pid": proc.pid,
            "phases": phases or "all", "argv": argv[1:], "log": str(log_path)}


@router.post("/build/stop")
def stop_build() -> dict[str, Any]:
    """Ask a running build to stop, leaving it resumable.

    Two mechanisms, because neither is sufficient alone:

      1. A **sentinel file** the build checks between steps. This is the one that actually
         stops it, and it stops it at a clean, resumable boundary.
      2. **SIGINT**, to break a step already blocked in a long Postgres call so it reaches
         that boundary in seconds rather than minutes.

    Signals alone were not enough: the interpreter defers SIGINT during a blocking driver
    call, and when psycopg surfaces it, it arrives as a driver error rather than
    KeyboardInterrupt — so the step was recorded as failed and the run continued to the
    next one. Hence the sentinel.

    Stopping is therefore not instantaneous: the in-flight step is abandoned (and will
    re-run), but nothing after it starts."""
    status = _build_status()
    if not status["running"]:
        raise HTTPException(status_code=409, detail="No build is running.")
    _STOP_PATH.parent.mkdir(parents=True, exist_ok=True)
    _STOP_PATH.write_text("stop requested via /api/v1/setup/build/stop\n")
    try:
        os.kill(status["pid"], signal.SIGINT)
    except OSError:
        pass          # the sentinel still stops it at the next step boundary
    return {"stopping": True, "pid": status["pid"],
            "note": "Stopping at the next step boundary — the in-flight step is abandoned "
                    "and will re-run. Start again to resume."}


class ResetRequest(BaseModel):
    """`confirm` must equal the database name. Typing the target back is the point:
    it makes a reset something you can only do on purpose, and it makes a mis-aimed
    request (right button, wrong deployment) fail instead of succeeding."""
    confirm: str


@router.post("/reset")
def reset_db(req: ResetRequest) -> dict[str, Any]:
    """Stop every running build, then drop the database back to bare.

    A reset TAKES PRECEDENCE over running work. Refusing while a build is in flight would
    be the wrong behaviour: the usual reason to reset is that the database is in a state
    you no longer want, and being blocked by the very job producing that state is a trap.
    So the job stops the builds first — sentinel, then SIGINT, then SIGKILL past a grace
    period — and only drops schemas once nothing is still writing.

    It runs DETACHED with its own log, like the ingests, because waiting for a build to
    reach a stoppable boundary can take minutes and an HTTP request should not.

    The database name must still be typed back: that guards against doing this to the
    right button on the wrong deployment, which is the mistake actually worth preventing.
    """
    expected = settings.postgres_db
    if req.confirm != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Type the database name ({expected!r}) to confirm.",
        )

    job = _job_state("reset")
    if job["running"]:
        raise HTTPException(409, f"A reset is already running (pid {job['pid']}).")

    state_p, _, stop_p = _job_paths("reset")
    _JOBS_DIR.mkdir(parents=True, exist_ok=True)
    stop_p.unlink(missing_ok=True)
    _rotate_logs("reset")
    log_p = _new_log("reset")

    argv = [sys.executable, "-u", "-m", "core.scripts.setup.reset_db",
            "--confirm", expected, "--keep-log", str(log_p)]
    log = open(log_p, "ab", buffering=0)  # noqa: SIM115 - handed to the child
    try:
        proc = subprocess.Popen(
            argv, cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
    finally:
        log.close()
    _mark_starting(state_p, proc.pid, log_p)
    return {"started": True, "key": "reset", "pid": proc.pid, "log": str(log_p),
            "note": "Stopping any running builds, then resetting. Follow the log."}


@router.get("/reset/log")
def reset_log(tail: int = 200, run: str | None = None) -> dict[str, Any]:
    """State and log of the reset job.

    Separate from /dataset/log because that one 404s anything absent from the source
    registry, and "reset" is a job rather than a dataset. Returns the job's live state
    alongside its log so the page can show a past reset after a refresh — the browser's
    own "I just started one" flag does not survive a reload, and the server's does.
    """
    n = max(1, min(int(tail), 2000))
    job = _job_state("reset")
    runs = _log_runs("reset")
    if not runs:
        return {"running": job["running"], "pid": job.get("pid"),
                "lines": [], "exists": False, "runs": [], "run": None}
    chosen = _pick_run(runs, run)
    try:
        lines = _read_log(chosen, n)
    except OSError as exc:
        raise HTTPException(500, f"Could not read {chosen}: {exc}") from exc
    return {
        "running": job["running"], "pid": job.get("pid"),
        "lines": lines, "exists": True, "path": str(chosen),
        "run": chosen.name, "runs": [_run_meta(p) for p in runs],
    }


@router.get("/build/log")
def build_log(tail: int = 200, run: str | None = None) -> dict[str, Any]:
    """The tail of the most recent build's log, plus the list of earlier runs.

    Reads only files this module named, in a fixed directory — nothing about the path is
    caller-controlled. `tail` is clamped: a full build's log is tens of thousands of lines
    and shipping all of it to a browser every two seconds would be its own outage."""
    n = max(1, min(int(tail), 2000))
    runs = _log_runs(None)
    if not runs:
        return {"lines": [], "path": str(_LOGS_DIR), "exists": False, "runs": [],
                "run": None}
    chosen = _pick_run(runs, run)
    try:
        lines = _read_log(chosen, n)
    except OSError as exc:
        raise HTTPException(500, f"Could not read {runs[0]}: {exc}") from exc
    return {
        "lines": lines, "path": str(chosen), "exists": True, "run": chosen.name,
        "runs": [_run_meta(p) for p in runs],
    }


# ------------------------------------------------------- per-dataset jobs

# Each dataset can be pulled as ITS OWN process, with its own state file and its own log.
# One shared state file would have concurrent jobs overwrite each other's progress, and a
# shared log would interleave two downloads into something neither readable nor
# attributable. The directory is the job registry.
_JOBS_DIR = CORE_DIR / "data" / "jobs"


def _job_slug(key: str) -> str:
    """`sharadar:SEP` -> `sharadar__SEP`. Keys come from the registry, but this is what
    reaches the filesystem, so it is sanitised rather than trusted."""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", key)


def _job_paths(key: str) -> tuple[Path, Path, Path]:
    slug = _job_slug(key)
    return (_JOBS_DIR / f"{slug}.json", _JOBS_DIR / f"{slug}.log",
            _JOBS_DIR / f"{slug}.stop")


def _last_runs() -> dict[str, dict[str, Any]]:
    """Most recent completed load per dataset, from `load_log` — the authoritative record,
    because it also covers runs from the CLI and the nightly job, not just this UI."""
    try:
        from sqlalchemy import text

        from core.backend.db.engine import engine
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT DISTINCT ON (dataset) dataset, status, rows, completed_at
                FROM load_log
                WHERE completed_at IS NOT NULL
                ORDER BY dataset, completed_at DESC
            """)).all()
        return {r.dataset: {"status": r.status, "rows": r.rows,
                            "at": r.completed_at.isoformat() if r.completed_at else None}
                for r in rows}
    except Exception:
        return {}


def _mark_starting(state_path: Path, pid: int, log: Path) -> None:
    """Record a run the instant it is spawned.

    `bootstrap` writes its own state only after preflight — a second or two in. Until then
    the status endpoint would report nothing running, so the UI you just clicked would
    bounce straight back to the idle buttons and an empty log. Writing a placeholder here
    closes that window: the process really has started, so saying so is not optimism, it
    is the truth arriving on time. bootstrap overwrites this moments later."""
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            "database": settings.postgres_db,
            "host": f"{settings.postgres_host}:{settings.postgres_port}",
            "phase": "starting",
            "pid": pid,
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "elapsed_seconds": 0.0,
            "log": str(log),
            "steps": [],
        }, indent=2))
    except OSError:
        pass          # a missing placeholder only costs a second of stale UI


def _job_state(key: str) -> dict[str, Any]:
    """Live state of one dataset's own job."""
    state_p, _, _ = _job_paths(key)
    st: dict[str, Any] = {}
    if state_p.exists():
        try:
            st = json.loads(state_p.read_text())
        except (json.JSONDecodeError, OSError):
            st = {}
    pid = st.get("pid")
    running = (_alive(pid, str(state_p))
               and st.get("phase") not in ("done", "failed", "interrupted"))
    step = (st.get("steps") or [{}])[0]
    return {
        "running": running,
        "pid": pid if running else None,
        "phase": st.get("phase"),
        "status": step.get("status"),
        "detail": step.get("detail") or "",
        "frac": step.get("frac", 0.0) if step.get("frac_known") else None,
        "rows": step.get("rows"),
        "seconds": step.get("seconds"),
        "updated_at": st.get("updated_at"),
        "has_log": bool(_log_runs(key)),
    }


class DatasetJobRequest(BaseModel):
    key: str
    mode: str = "update"      # update | missing | full  (see BuildRequest)
    force: bool = False       # deprecated alias for mode="update"


@router.post("/dataset/run")
def run_dataset(req: DatasetJobRequest) -> dict[str, Any]:
    """Pull ONE dataset, as its own detached process with its own state file and log.

    Independent by design: a table that fails, hangs, or gets stopped affects nothing
    else, and you can pull `SEP` without committing to the other 17."""
    ds = sources.BY_KEY.get(req.key)
    if ds is None:
        raise HTTPException(404, f"Unknown dataset {req.key!r}.")

    job = _job_state(req.key)
    if job["running"]:
        raise HTTPException(409, f"{req.key} is already running (pid {job['pid']}).")

    state_p, _, stop_p = _job_paths(req.key)
    _JOBS_DIR.mkdir(parents=True, exist_ok=True)
    stop_p.unlink(missing_ok=True)          # a stale stop would halt it immediately
    _rotate_logs(req.key)
    log_p = _new_log(req.key)

    mode = "update" if req.force and req.mode == "missing" else req.mode
    if mode not in ("update", "missing", "full"):
        raise HTTPException(400, f"mode must be update|missing|full, got {mode!r}")
    argv = [sys.executable, "-u", "-m", "core.scripts.setup.bootstrap", "--plain",
            "--dataset", ds.key, "--state-file", str(state_p)]
    if mode == "full":
        argv.append("--full")
    elif mode == "update":
        argv.append("--force")

    log = open(log_p, "ab", buffering=0)  # noqa: SIM115 - handed to the child
    try:
        proc = subprocess.Popen(
            argv, cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
    finally:
        log.close()
    _mark_starting(state_p, proc.pid, log_p)
    return {"started": True, "key": ds.key, "mode": mode, "pid": proc.pid,
            "log": str(log_p)}


@router.post("/dataset/stop")
def stop_dataset(req: DatasetJobRequest) -> dict[str, Any]:
    """Stop one dataset's job, leaving it resumable — sentinel plus SIGINT, same as a
    full build."""
    job = _job_state(req.key)
    if not job["running"]:
        raise HTTPException(409, f"{req.key} is not running.")
    _, _, stop_p = _job_paths(req.key)
    stop_p.parent.mkdir(parents=True, exist_ok=True)
    stop_p.write_text("stop requested\n")
    try:
        os.kill(job["pid"], signal.SIGINT)
    except OSError:
        pass
    return {"stopping": True, "key": req.key, "pid": job["pid"]}


@router.get("/dataset/log")
def dataset_log(key: str, tail: int = 200, run: str | None = None) -> dict[str, Any]:
    """Tail of ONE dataset's most recent run, plus its earlier runs."""
    if key not in sources.BY_KEY:
        raise HTTPException(404, f"Unknown dataset {key!r}.")
    n = max(1, min(int(tail), 2000))
    runs = _log_runs(key)
    if not runs:
        return {"key": key, "lines": [], "exists": False, "path": str(_LOGS_DIR),
                "runs": [], "run": None}
    chosen = _pick_run(runs, run)
    try:
        lines = _read_log(chosen, n)
    except OSError as exc:
        raise HTTPException(500, f"Could not read {runs[0]}: {exc}") from exc
    return {
        "key": key, "lines": lines, "exists": True, "path": str(chosen),
        "run": chosen.name, "runs": [_run_meta(p) for p in runs],
    }


# ------------------------------------------------------------------ log files

# One file per RUN, not one per job. Appending every run to a single log makes the useful
# question — "what happened the last time this failed?" — require reading past everything
# that came after it. Dated files keep each run whole and let old ones be archived.
_LOGS_DIR = CORE_DIR / "data" / "logs"

# Newest few stay plain text so they can be tailed; older ones are gzipped (they compress
# ~10x and are read rarely); past the age limit they go. Bounded without ever silently
# discarding the run you are currently looking at.
_KEEP_PLAIN = 5
_MAX_AGE_DAYS = 30


def _log_stem(key: str | None) -> str:
    """`None` -> the full build; a dataset key -> that dataset's own runs."""
    return "build" if key is None else _job_slug(key)


def _new_log(key: str | None) -> Path:
    """Path for a run starting now. Second precision is enough: the start guard prevents
    two runs of the same thing at once."""
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return _LOGS_DIR / f"{_log_stem(key)}-{stamp}.log"


def _log_runs(key: str | None) -> list[Path]:
    """Every run's log for this key, newest first (plain and archived)."""
    if not _LOGS_DIR.exists():
        return []
    stem = _log_stem(key)
    runs = [p for p in _LOGS_DIR.iterdir()
            if p.name.startswith(f"{stem}-") and p.suffix in (".log", ".gz")]
    return sorted(runs, key=lambda p: p.name, reverse=True)


def _rotate_logs(key: str | None) -> None:
    """Archive and expire this key's older runs. Best-effort: housekeeping must never be
    the reason a build fails to start."""
    try:
        runs = _log_runs(key)
        cutoff = time.time() - _MAX_AGE_DAYS * 86400
        for i, p in enumerate(runs):
            if p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                continue
            if i >= _KEEP_PLAIN and p.suffix == ".log":
                with p.open("rb") as src, gzip.open(f"{p}.gz", "wb") as dst:
                    shutil.copyfileobj(src, dst)
                p.unlink(missing_ok=True)
    except OSError:
        pass


def _read_log(path: Path, tail: int) -> list[str]:
    """Last `tail` lines, transparently handling an archived (.gz) run."""
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as fh:
            return fh.read().splitlines()[-tail:]
    size = path.stat().st_size
    with path.open("rb") as fh:
        window = min(size, 256 * 1024)   # a full build's log is megabytes; read the end
        fh.seek(size - window)
        lines = fh.read().decode("utf-8", errors="replace").splitlines()
    if window < size and lines:
        lines = lines[1:]                # drop the partial line the window began mid-way
    return lines[-tail:]


def _pick_run(runs: list[Path], name: str | None) -> Path:
    """The requested run, or the newest.

    Matched by EXACT name against the listing rather than joined onto a directory: the
    name reaches the filesystem, so a caller must never be able to steer it. An unknown
    name is a 404, not a silent fallback to the newest — quietly showing a different run
    than the one asked for is how you debug the wrong failure."""
    if not name:
        return runs[0]
    for p in runs:
        if p.name == name:
            return p
    raise HTTPException(404, f"No run {name!r}. Available: {[p.name for p in runs][:10]}")


def _run_meta(p: Path) -> dict[str, Any]:
    st = p.stat()
    # The timestamp comes from the FILENAME, which records when the run started. mtime is
    # wrong for archived runs — gzipping rewrites it, so an old run would display as
    # newer than runs that actually followed it.
    at = datetime.fromtimestamp(st.st_mtime)
    m = re.search(r"-(\d{8}-\d{6})\.log(?:\.gz)?$", p.name)
    if m:
        try:
            at = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S")
        except ValueError:
            pass
    return {
        "name": p.name,
        "archived": p.suffix == ".gz",
        "bytes": st.st_size,
        "at": at.isoformat(timespec="seconds"),
    }
