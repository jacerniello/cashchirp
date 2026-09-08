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
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.backend import sources
# The job runtime lives in core.backend.jobs so the scheduler and these endpoints
# spawn work through one code path rather than two that can drift apart.
from core.backend.jobs.runtime import (
    _JOBS_DIR,
    _LOGS_DIR,
    _STOP_PATH,
    UnknownRun,
    _alive,
    _job_paths,
    _job_state,
    _last_runs,
    _log_runs,
    _mark_starting,
    _new_log,
    _pick_run,
    _read_log,
    _rotate_logs,
    _run_meta,
)
from core.backend.jobs import runtime as rt
from core.backend.jobs import scheduler
from core.backend.queries.meta import jobs as jobsq
from core.config import CORE_DIR, PROJECT_ROOT, settings


def _pick(runs: list[Path], run: str | None) -> Path:
    """`_pick_run`, translated into an HTTP 404. The runtime raises a plain lookup error
    because it is also used by the scheduler, which has no HTTP layer to raise into."""
    try:
        return _pick_run(runs, run)
    except UnknownRun as exc:
        raise HTTPException(404, str(exc)) from exc

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
        })
    return {"sources": out}


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

    # `missing` is the only mode that leaves populated tables alone; the other two both
    # re-run every step, differing in whether Sharadar syncs new rows or re-downloads.
    mode = "update" if req.force and req.mode == "missing" else req.mode
    # The argv and phase selection live in the runtime, so a scheduled build and this one
    # are literally the same command rather than two lists that agree today.
    info = rt.spawn_build(req.kind, mode, phases=req.phases, only=req.only)
    run_id = jobsq.start_run(key=f"build:{req.kind}", kind="build", trigger="manual",
                             label=f"{req.kind} build", mode=mode, pid=info["pid"],
                             log=info["log_name"])
    return {"started": True, "kind": req.kind, "mode": mode, "pid": info["pid"],
            "phases": info["phases"], "argv": info["argv"], "log": info["log"],
            "run_id": run_id}


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
    chosen = _pick(runs, run)
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
    chosen = _pick(runs, run)
    try:
        lines = _read_log(chosen, n)
    except OSError as exc:
        raise HTTPException(500, f"Could not read {runs[0]}: {exc}") from exc
    return {
        "lines": lines, "path": str(chosen), "exists": True, "run": chosen.name,
        "runs": [_run_meta(p) for p in runs],
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

    mode = "update" if req.force and req.mode == "missing" else req.mode
    try:
        info = rt.spawn_dataset(req.key, mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    run_id = jobsq.start_run(key=ds.key, kind="dataset", trigger="manual",
                             label=ds.label, mode=mode, pid=info["pid"],
                             log=info["log_name"])
    return {"started": True, "key": ds.key, "mode": mode, "pid": info["pid"],
            "log": info["log"], "run_id": run_id}


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
    chosen = _pick(runs, run)
    try:
        lines = _read_log(chosen, n)
    except OSError as exc:
        raise HTTPException(500, f"Could not read {runs[0]}: {exc}") from exc
    return {
        "key": key, "lines": lines, "exists": True, "path": str(chosen),
        "run": chosen.name, "runs": [_run_meta(p) for p in runs],
    }




# ------------------------------------------------------------------ schedules

# A schedule can only ask for something you could have clicked: a registry dataset, or a
# whole build. Validating the key here means a typo is a 400 now, rather than a schedule
# that sits in the table failing silently at 3am for a week.
def _valid_job_key(key: str) -> str | None:
    """The human label for a job key, or None if nothing can run it."""
    if key.startswith("build:"):
        kind = key.split(":", 1)[1]
        return f"{kind} build" if kind in rt.BUILD_KINDS else None
    ds = sources.BY_KEY.get(key)
    return ds.label if ds else None


class ScheduleRequest(BaseModel):
    key: str
    cadence: str = "daily"                  # interval | daily | weekly
    mode: str = "update"                    # update | missing | full
    interval_minutes: int | None = None
    at_time: str | None = "03:00"           # local wall-clock
    weekday: int | None = None              # 0=Mon .. 6=Sun, weekly only
    enabled: bool = True
    note: str | None = None


class SchedulePatch(BaseModel):
    cadence: str | None = None
    mode: str | None = None
    interval_minutes: int | None = None
    at_time: str | None = None
    weekday: int | None = None
    enabled: bool | None = None
    note: str | None = None


@router.get("/schedules")
@router.get("/schedules/")
def list_schedules() -> dict[str, Any]:
    """Every standing schedule, plus what the runner can be pointed at.

    `jobs` is served alongside so the UI builds its picker from the registry rather than
    a hardcoded list that drifts the moment a dataset is added."""
    return {
        "scheduler_running": scheduler.running(),
        "tick_seconds": scheduler.TICK_SECONDS,
        "now": jobsq.now_local().isoformat(timespec="seconds"),
        "schedules": jobsq.list_schedules(),
        "jobs": (
            [{"key": f"build:{k}", "label": f"{k} build", "phase": "build"}
             for k in rt.BUILD_KINDS]
            + [{"key": d.key, "label": d.label, "phase": d.phase} for d in sources.DATASETS]
        ),
        "cadences": list(jobsq.CADENCES),
        "modes": list(jobsq.MODES),
        "min_interval_minutes": jobsq.MIN_INTERVAL_MINUTES,
    }


@router.post("/schedules")
@router.post("/schedules/")
def create_schedule(req: ScheduleRequest) -> dict[str, Any]:
    if _valid_job_key(req.key) is None:
        raise HTTPException(404, f"Nothing can run {req.key!r}.")
    try:
        return jobsq.create_schedule(
            key=req.key, cadence=req.cadence, mode=req.mode,
            interval_minutes=req.interval_minutes, at_time=req.at_time,
            weekday=req.weekday, enabled=req.enabled, note=req.note)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/schedules/{schedule_id}")
def patch_schedule(schedule_id: int, req: SchedulePatch) -> dict[str, Any]:
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "Nothing to change.")
    try:
        out = jobsq.update_schedule(schedule_id, **fields)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if out is None:
        raise HTTPException(404, f"No schedule {schedule_id}.")
    return out


@router.delete("/schedules/{schedule_id}")
def remove_schedule(schedule_id: int) -> dict[str, Any]:
    if not jobsq.delete_schedule(schedule_id):
        raise HTTPException(404, f"No schedule {schedule_id}.")
    return {"deleted": True, "id": schedule_id}


@router.post("/schedules/{schedule_id}/run")
def run_schedule_now(schedule_id: int) -> dict[str, Any]:
    """Fire a schedule immediately, without waiting for its next slot.

    Recorded as `manual`, because that is what it was — attributing a button press to the
    schedule would make the history claim the cadence fired when it did not."""
    for s in jobsq.list_schedules():
        if s["id"] == schedule_id:
            res = scheduler.fire({**s, "id": None})
            if not res.get("fired"):
                raise HTTPException(409, res.get("reason", "could not start"))
            return res
    raise HTTPException(404, f"No schedule {schedule_id}.")


# ------------------------------------------------------------------ run history


@router.get("/runs")
@router.get("/runs/")
def list_runs(limit: int = 100, key: str | None = None,
              trigger: str | None = None) -> dict[str, Any]:
    """Every process this app has run, newest first, tagged with how it was triggered.

    Reconciles first: jobs are detached, so a run stays `running` in the ledger until
    something notices its pid is gone. Doing it on read means the history is never stale
    just because the scheduler thread happened to be between ticks."""
    if trigger and trigger not in jobsq.TRIGGERS:
        raise HTTPException(400, f"trigger must be one of {jobsq.TRIGGERS}")
    closed = scheduler.reconcile_runs()
    return {
        "runs": jobsq.recent_runs(limit=limit, key=key, trigger=trigger),
        "reconciled": closed,
        "triggers": list(jobsq.TRIGGERS),
    }


@router.get("/runs/log")
def run_log(name: str, tail: int = 200) -> dict[str, Any]:
    """The log of a specific run, addressed by its file name.

    Matched against the listing rather than joined onto a directory — the name comes from
    a client, so it must never be able to steer at the filesystem."""
    n = max(1, min(int(tail), 2000))
    for stem_runs in (_log_runs(None), *(_log_runs(d.key) for d in sources.DATASETS)):
        for p in stem_runs:
            if p.name == name:
                return {"name": name, "lines": _read_log(p, n), "exists": True,
                        "archived": p.suffix == ".gz"}
    raise HTTPException(404, f"No log named {name!r}.")
