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

import json
import os
import re
import signal
import subprocess
import sys
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
        return json.loads(STATE_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None       # a half-written file is not an error worth surfacing


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
_LOG_PATH = CORE_DIR / "data" / "bootstrap.log"
_STOP_PATH = CORE_DIR / "data" / "bootstrap.stop"


def _alive(pid: int | None) -> bool:
    """Is that PID still running? `signal 0` checks without touching the process."""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, TypeError):
        return False
    return True


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
        "log": str(_LOG_PATH),
        "stopping": _STOP_PATH.exists(),
    }


class BuildRequest(BaseModel):
    """What to build.

    `kind` is the main control and maps to registry phase groups:
      * `ingest`  — download from the providers (hours, network-bound, spends the paid
                    Sharadar subscription)
      * `derive`  — recompute the derived tables from data already local (minutes, free,
                    safe to re-run)
      * `all`     — schema, then ingest, then derive, in dependency order

    `phases` / `only` narrow it further. Every value is validated against the registry —
    nothing here is ever passed to a subprocess as free text."""

    kind: str = "all"
    phases: list[str] = []
    only: list[str] = []
    force: bool = False


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
    argv = [sys.executable, "-m", "core.scripts.setup.bootstrap", "--create-db", "--plain"]
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
    if req.force:
        argv.append("--force")

    # A sentinel left by a previous stop would halt this run before it began.
    _STOP_PATH.unlink(missing_ok=True)
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = open(_LOG_PATH, "ab", buffering=0)  # noqa: SIM115 - owned by the child
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
    return {"started": True, "kind": req.kind, "pid": proc.pid,
            "phases": phases or "all", "argv": argv[1:], "log": str(_LOG_PATH)}


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


@router.get("/build/log")
def build_log(tail: int = 200) -> dict[str, Any]:
    """The tail of the build log, so a run can be followed without a terminal.

    Reads a FIXED path — nothing about the file is caller-controlled, so there is no path
    to traverse. `tail` is clamped: the log of a full build is tens of thousands of lines
    and shipping all of it to a browser every two seconds would be its own outage."""
    n = max(1, min(int(tail), 2000))
    if not _LOG_PATH.exists():
        return {"lines": [], "path": str(_LOG_PATH), "exists": False, "bytes": 0}
    try:
        # Read the end only: a long build's log grows to megabytes and this endpoint is
        # polled while it runs.
        size = _LOG_PATH.stat().st_size
        with _LOG_PATH.open("rb") as fh:
            window = min(size, 256 * 1024)
            fh.seek(size - window)
            text = fh.read().decode("utf-8", errors="replace")
        lines = text.splitlines()
        if window < size and lines:
            lines = lines[1:]          # drop the half-line the window started mid-way through
        return {"lines": lines[-n:], "path": str(_LOG_PATH), "exists": True, "bytes": size}
    except OSError as exc:
        raise HTTPException(500, f"Could not read {_LOG_PATH}: {exc}") from exc


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


def _job_state(key: str) -> dict[str, Any]:
    """Live state of one dataset's own job."""
    state_p, log_p, _ = _job_paths(key)
    st: dict[str, Any] = {}
    if state_p.exists():
        try:
            st = json.loads(state_p.read_text())
        except (json.JSONDecodeError, OSError):
            st = {}
    pid = st.get("pid")
    running = _alive(pid) and st.get("phase") not in ("done", "failed", "interrupted")
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
        "has_log": log_p.exists(),
    }


class DatasetJobRequest(BaseModel):
    key: str
    force: bool = False


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

    state_p, log_p, stop_p = _job_paths(req.key)
    _JOBS_DIR.mkdir(parents=True, exist_ok=True)
    stop_p.unlink(missing_ok=True)          # a stale stop would halt it immediately

    argv = [sys.executable, "-m", "core.scripts.setup.bootstrap", "--plain",
            "--dataset", ds.key, "--state-file", str(state_p)]
    if req.force:
        argv.append("--force")

    log = open(log_p, "ab", buffering=0)  # noqa: SIM115 - handed to the child
    try:
        proc = subprocess.Popen(
            argv, cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
    finally:
        log.close()
    return {"started": True, "key": ds.key, "pid": proc.pid, "log": str(log_p)}


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
def dataset_log(key: str, tail: int = 200) -> dict[str, Any]:
    """Tail of ONE dataset's own log."""
    if key not in sources.BY_KEY:
        raise HTTPException(404, f"Unknown dataset {key!r}.")
    _, log_p, _ = _job_paths(key)
    n = max(1, min(int(tail), 2000))
    if not log_p.exists():
        return {"key": key, "lines": [], "exists": False, "path": str(log_p)}
    size = log_p.stat().st_size
    with log_p.open("rb") as fh:
        window = min(size, 256 * 1024)
        fh.seek(size - window)
        lines = fh.read().decode("utf-8", errors="replace").splitlines()
    if window < size and lines:
        lines = lines[1:]
    return {"key": key, "lines": lines[-n:], "exists": True, "path": str(log_p)}
