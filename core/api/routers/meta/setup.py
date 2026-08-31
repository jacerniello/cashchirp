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
        datasets.append({
            "key": d.key, "label": d.label, "phase": d.phase,
            "source": {"id": d.source, "provider": src.provider, "short": src.short,
                       "licence": src.licence, "url": src.url},
            "endpoint": d.endpoint, "mode": d.mode, "note": d.note,
            "expected_mb": d.size_mb, "expected_size": d.size_h,
            "tables": tables, "rows": have_rows,
            "size": _human(have_bytes) if have_bytes else "—",
            "state": state,
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
