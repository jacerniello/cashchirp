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
from typing import Any

from fastapi import APIRouter

from core.backend import sources
from core.config import CORE_DIR, settings

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
        "datasets": datasets,
        "build": _live_build(),
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
