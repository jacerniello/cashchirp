"""Build this database from nothing, with a live progress display.

`update_all` refreshes a database that already exists. This is the step before that:
it takes someone from "I cloned the repo" to "I have my own populated copy", checks
the things that actually go wrong first, and shows where a multi-hour backfill has
got to instead of leaving them staring at a silent terminal.

    python -m core.setup.bootstrap --check      # preflight only, touches nothing
    python -m core.setup.bootstrap --plan       # print the step list and exit
    python -m core.setup.bootstrap --create-db  # create the database if missing, then run
    python -m core.setup.bootstrap              # preflight -> schema -> load -> derived
    python -m core.setup.bootstrap --only SEP SF1
    python -m core.setup.bootstrap --status     # what's in the DB right now
    python -m core.setup.bootstrap --watch      # follow a run started in another terminal

The load plan is NOT duplicated here: `SHARADAR_PLAN` and the rebuild guard are
imported from `update_all`, so the two stay in step by construction. What this adds
is the from-zero path (create database, create schema), the preflight, and progress.

A first run downloads tens of GB from Sharadar and takes hours. Every step is
idempotent and the run is resumable: re-running skips steps whose table already
holds rows, so a failure or a Ctrl-C costs only the step it happened in. `--force`
re-runs them anyway.

Progress is written to `core/data/bootstrap-state.json` after every step, which is
what `--watch` reads. That file is the reason you can close the laptop lid on a
6-hour backfill and still find out what happened.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime
from typing import Callable

from core.backend import sources
from core.config import CORE_DIR, settings

# Default state file. `--state-file` overrides it so that per-dataset jobs, which run
# concurrently, each write their own — one shared file would have them overwrite each
# other's progress and leave every job reporting the last writer's steps.
STATE_PATH = CORE_DIR / "data" / "bootstrap-state.json"

# Cooperative stop. A signal alone is not enough to stop this safely: a step blocked in a
# multi-minute Postgres call has SIGINT deferred by the interpreter, and when psycopg does
# surface it, it arrives as a driver error (PendingRollbackError) rather than
# KeyboardInterrupt - so the step is recorded as FAILED and the run marches on to the next
# one. Checking a sentinel file BETWEEN steps is immune to all of that: it always runs, in
# ordinary Python, at a point where stopping is clean and resumable.
STOP_PATH = CORE_DIR / "data" / "bootstrap.stop"

# Set by --full. The registry's Sharadar mode is `sync` — an incremental upsert from the
# stored watermark — which is what you want almost always. `--full` replaces it with a
# complete re-download of the bulk export, for when the local copy is suspect rather than
# merely stale.
FULL_REBUILD = False


def stop_requested() -> bool:
    return STOP_PATH.exists()


def clear_stop() -> None:
    STOP_PATH.unlink(missing_ok=True)

# Sizes and destination tables come from the data-source registry (core.backend.sources),
# the same place the load plan and the published provenance come from.
#

# Destination table per step, used two ways: to report row counts as steps finish, and to
# decide on a resume whether a step already ran. Steps absent here always re-run.
STEP_TABLE: dict[str, str] = sources.step_tables()


@dataclass
class Step:
    key: str
    label: str
    phase: str
    run: Callable[[Callable[[str], None]], object]
    table: str | None = None
    status: str = "pending"  # pending | running | ok | FAIL | skipped
    seconds: float = 0.0
    rows: int | None = None
    note: str = ""
    detail: str = ""     # live sub-step message from the loader
    frac: float = 0.0    # 0..1 completion REPORTED by the loader (not estimated)
    frac_known: bool = False  # False => the loader gave no denominator; frac is meaningless


# --------------------------------------------------------------------------- preflight

@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    fatal: bool = True
    fix: str = ""


def _server_dsn() -> str:
    """DSN for the `postgres` maintenance database — used to check the server is up and
    to create the target database, neither of which can go through the app engine (it
    connects to a database that may not exist yet)."""
    pw = f":{settings.postgres_password}" if settings.postgres_password else ""
    return (f"postgresql://{settings.postgres_user}{pw}"
            f"@{settings.postgres_host}:{settings.postgres_port}/postgres")


def _database_exists() -> bool:
    import psycopg
    with psycopg.connect(_server_dsn(), connect_timeout=5) as conn:
        cur = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s",
                           (settings.postgres_db,))
        return cur.fetchone() is not None


def create_database() -> str:
    """CREATE DATABASE, or report it already existed. Needs autocommit — Postgres
    refuses CREATE DATABASE inside a transaction block."""
    import psycopg
    if _database_exists():
        return f"database {settings.postgres_db!r} already exists"
    with psycopg.connect(_server_dsn(), autocommit=True, connect_timeout=5) as conn:
        conn.execute(f'CREATE DATABASE "{settings.postgres_db}"')
    return f"created database {settings.postgres_db!r}"


def preflight() -> list[Check]:
    """The five things that actually stop a fresh setup, checked in the order they bite.
    Every failure carries the command that fixes it — a preflight that only says 'no'
    just moves the guesswork somewhere else."""
    checks: list[Check] = []

    env_file = CORE_DIR / ".env"
    checks.append(Check(
        "core/.env present", env_file.exists(),
        str(env_file) if env_file.exists() else "missing",
        fix="cp core/.env.example core/.env  # then add your API keys",
    ))

    # Credentials come from the data-source registry, so a new source that needs a key is
    # checked here the moment it is declared — nobody has to remember to add it.
    WHERE = {
        "NASDAQ_DATA_LINK_API_KEY": "https://data.nasdaq.com/account/profile",
        "FRED_API_KEY": "https://fredaccount.stlouisfed.org/apikeys",
        "SEC_USER_AGENT": "use your own name and e-mail, e.g. 'Jane Doe jane@example.com'",
    }
    for env, providers in sources.required_env():
        value = str(getattr(settings, env.lower(), "") or os.environ.get(env, "")).strip()
        where = WHERE.get(env, "")
        checks.append(Check(
            f"{env} set", bool(value),
            (f"…{value[-4:]}" if len(value) > 4 else "set") if value else "empty",
            # Only Sharadar is load-bearing for a full build; the others gate one phase
            # each, so a missing one is a warning you can build around, not a wall.
            fatal=(env == "NASDAQ_DATA_LINK_API_KEY"),
            fix=f"add {env} to core/.env ({', '.join(providers)}) — {where}",
        ))

    # Server reachable. Distinguished from "database missing" on purpose: they have
    # completely different fixes, and conflating them is why people restart Postgres
    # when all they needed was createdb.
    server_ok, server_detail = False, ""
    try:
        import psycopg
        with psycopg.connect(_server_dsn(), connect_timeout=5) as conn:
            server_detail = conn.execute("SHOW server_version").fetchone()[0]
        server_ok = True
    except Exception as exc:
        server_detail = f"{type(exc).__name__}: {exc}".split("\n")[0]
    checks.append(Check(
        f"Postgres reachable at {settings.postgres_host}:{settings.postgres_port}",
        server_ok, f"server {server_detail}" if server_ok else server_detail,
        fix="start Postgres, or: cd core && docker compose up -d",
    ))

    if server_ok:
        # "could not check" is NOT "does not exist". Under load the probe can time out,
        # and reporting that as `missing` both blocks a perfectly good run and offers
        # `--create-db` as the fix — which is the wrong action on a database that is
        # simply busy. A failed probe is retried, then surfaced as its own condition.
        exists, probe_error = None, ""
        for attempt in range(3):
            try:
                exists = _database_exists()
                break
            except Exception as exc:
                probe_error = f"{type(exc).__name__}: {exc}".split("\n")[0]
                if attempt < 2:
                    time.sleep(1.5)
        if exists is None:
            checks.append(Check(
                f"database {settings.postgres_db!r} reachable", False,
                f"could not check — {probe_error[:70]}",
                fix="the server answered but the database probe timed out — it is most "
                    "likely busy, not missing. Retry; do NOT pass --create-db.",
            ))
        else:
            checks.append(Check(
                f"database {settings.postgres_db!r} exists", exists,
                "ready" if exists else "missing",
                fix="re-run with --create-db (or: createdb "
                    f"{settings.postgres_db})",
            ))

    return checks


# ------------------------------------------------------------------------- db queries

def table_rows(table: str) -> int | None:
    """Row estimate from the planner's statistics, not COUNT(*). On a 9 GB table
    COUNT(*) is a full scan taking minutes — unusable for a progress display that
    refreshes per step. reltuples is exact enough to answer 'did this load'."""
    from sqlalchemy import text

    from core.backend.db.engine import engine
    schema, _, name = table.rpartition(".")
    try:
        with engine.connect() as conn:
            n = conn.execute(text("""
                SELECT c.reltuples::bigint
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = :name AND n.nspname = :schema
            """), {"name": name, "schema": schema or "public"}).scalar()
        # -1 is "never analyzed"; a freshly loaded table reads that way until autovacuum
        # catches up, so fall back to a real count only in that (small-table) case.
        if n is not None and n < 0:
            with engine.connect() as conn:
                n = conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()
        return n
    except Exception:
        return None


def db_status() -> list[tuple[str, int, str]]:
    """Every user table with its row estimate and on-disk size — the answer to
    'what do I actually have?', which is the question after any interrupted run."""
    from sqlalchemy import text

    from core.backend.db.engine import engine
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT n.nspname || '.' || c.relname AS name,
                   GREATEST(c.reltuples::bigint, 0) AS rows,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS size
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','m','p')
              AND n.nspname NOT IN ('pg_catalog','information_schema')
            ORDER BY pg_total_relation_size(c.oid) DESC
        """)).all()
    return [(r.name, r.rows, r.size) for r in rows]


# ----------------------------------------------------------------------------- display

class Display:
    """Two renderers behind one interface. On a TTY the step list is redrawn in place;
    piped to a file or a CI log it degrades to one line per transition, because a
    redrawing display in a log file is thousands of lines of escape codes."""

    def __init__(self, steps: list[Step], plain: bool | None = None):
        self.steps = steps
        self.started = time.time()
        self.plain = (not sys.stdout.isatty()) if plain is None else plain
        self._drawn = 0
        self._last = 0.0
        self._last_detail = ""
        self._last_detail_at = 0.0
        self._hb: threading.Thread | None = None
        self._hb_stop = threading.Event()
        self._step_started = time.time()

    def _bar(self, frac: float, width: int = 28) -> str:
        filled = int(frac * width)
        return "█" * filled + "░" * (width - filled)

    def _progress(self) -> tuple[float, int, int]:
        """Overall completion from what the loaders actually REPORT, not from a size
        estimate. Finished steps count 1.0; a running step counts the fraction it has
        reported (rows or bytes against a stated total) and 0 if it hasn't reported one.

        Deliberately not weighted by predicted size: a step that turns out to be a no-op
        (already loaded, skipped on resume) would otherwise swing the bar by 20% for no
        work, and a table whose real size differs from the estimate makes the bar lie in
        the other direction. Equal steps plus real in-step reporting is a number that
        never claims progress that didn't happen."""
        n = len(self.steps) or 1
        done = sum(1.0 for s in self.steps if s.status in ("ok", "skipped", "FAIL"))
        running = sum(s.frac for s in self.steps if s.status == "running" and s.frac_known)
        return (done + running) / n, int(done), len(self.steps)

    def log(self, msg: str) -> None:
        print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)

    def _plain_progress(self) -> None:
        """Echo the running step's own progress in plain mode.

        Without this the log jumps straight from `-> step` to its result, so a step that
        takes an hour looks indistinguishable from one that hung — which is exactly the
        thing you open a log to rule out. Printed when the message CHANGES, plus a
        heartbeat every 60s so a long silent stage still proves it is alive."""
        cur = next((st for st in self.steps if st.status == "running"), None)
        if not cur or not cur.detail:
            return
        now = time.time()
        changed = cur.detail != self._last_detail
        stale = now - self._last_detail_at > 60
        if not (changed or stale):
            return
        self._last_detail, self._last_detail_at = cur.detail, now
        # Loader messages already carry their own timestamp and table prefix.
        self.log(f"     {cur.detail}" if changed else f"     still: {cur.detail}")

    def refresh(self, force: bool = False) -> None:
        if self.plain:
            self._plain_progress()
            return
        if not force and time.time() - self._last < 0.2:  # cap redraws; loaders are chatty
            return
        self._last = time.time()
        width = shutil.get_terminal_size((100, 40)).columns
        out = []
        frac, ndone, ntotal = self._progress()
        el = _hms(time.time() - self.started)
        out.append(f"\x1b[1mBuilding {settings.postgres_db}\x1b[0m  "
                   f"{settings.postgres_host}:{settings.postgres_port}   elapsed {el}")
        out.append("")
        for s in self.steps:
            mark, colour = {
                "pending": ("·", "\x1b[90m"), "running": ("▶", "\x1b[36m"),
                "ok": ("✔", "\x1b[32m"), "skipped": ("–", "\x1b[90m"),
                "FAIL": ("✗", "\x1b[31m"),
            }[s.status]
            right = ""
            if s.status == "running":
                pct = f"{s.frac * 100:.0f}%  " if s.frac_known else ""
                right = pct + (s.detail or "working…")
            elif s.status == "ok":
                right = f"{_hms(s.seconds)}" + (f"   {s.rows:,} rows" if s.rows else "")
            elif s.status == "skipped":
                right = s.note or "already loaded"
            elif s.status == "FAIL":
                right = s.note
            line = f" {colour}{mark}\x1b[0m {s.label:<38} {right}"
            out.append(line[:width + len(colour) + 5])
        out.append("")
        out.append(f" {self._bar(frac)}  {frac * 100:5.1f}%   {ndone}/{ntotal} steps"
                   f"   (reported, not estimated)")

        if self._drawn:
            sys.stdout.write(f"\x1b[{self._drawn}A")
        for line in out:
            sys.stdout.write("\x1b[2K" + line + "\n")
        self._drawn = len(out)
        sys.stdout.flush()

    def transition(self, step: Step) -> None:
        if self.plain:
            if step.status == "running":
                self._last_detail, self._last_detail_at = "", 0.0
                self._step_started = time.time()
                self.log(f"START    {step.label}")
            else:
                word = {"ok": "FINISHED", "skipped": "SKIPPED ", "FAIL": "FAILED  "}.get(
                    step.status, step.status.upper())
                extra = f" · {step.rows:,} rows" if step.rows else ""
                note = f" — {step.note}" if step.note else ""
                self.log(f"{word} {step.label} · {_hms(step.seconds)}{extra}{note}")
        else:
            self.refresh(force=True)

    def start_heartbeat(self, every: float = 60.0) -> None:
        """Tick while a step is running, in plain mode only.

        Echoing the loader's messages is not enough on its own: a step can go quiet for an
        hour (a single long Postgres rebuild emits one line, then nothing), and silence in
        a log is indistinguishable from a hang. A timer proves liveness regardless of
        whether the loader has anything to say. Daemon thread, so it can never hold the
        process open."""
        if not self.plain or self._hb is not None:
            return
        self._hb_stop.clear()

        def tick() -> None:
            while not self._hb_stop.wait(every):
                cur = next((st for st in self.steps if st.status == "running"), None)
                if not cur:
                    continue
                detail = f" · {cur.detail}" if cur.detail else ""
                self.log(f"RUNNING  {cur.label} · {_hms(time.time() - self._step_started)}"
                         f"{detail}")

        self._hb = threading.Thread(target=tick, daemon=True, name="bootstrap-heartbeat")
        self._hb.start()

    def stop_heartbeat(self) -> None:
        self._hb_stop.set()
        self._hb = None

    def finish(self) -> None:
        self.stop_heartbeat()
        self.refresh(force=True)


def _hms(secs: float) -> str:
    secs = int(secs)
    h, m, s = secs // 3600, (secs % 3600) // 60, secs % 60
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


# ------------------------------------------------------------------------- state file

def write_state(steps: list[Step], started: float, phase: str) -> None:
    """Best-effort: a failed status write must never abort a six-hour load."""
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "database": settings.postgres_db,
            "host": f"{settings.postgres_host}:{settings.postgres_port}",
            "phase": phase,
            # A build has no --state-file in its argv, so the state path cannot prove the
            # pid is ours. The module name is in every bootstrap command line and is.
            "marker": "core.setup.bootstrap",
            "pid": os.getpid(),
            "started_at": datetime.fromtimestamp(started).isoformat(timespec="seconds"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "elapsed_seconds": round(time.time() - started, 1),
            "steps": [
                {"key": s.key, "label": s.label, "phase": s.phase, "status": s.status,
                 "seconds": round(s.seconds, 1), "rows": s.rows,
                 "note": s.note, "detail": s.detail,
                 "frac": round(s.frac, 4), "frac_known": s.frac_known}
                for s in steps
            ],
        }
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(STATE_PATH)  # atomic: --watch never reads a half-written file
    except Exception:
        pass


def watch(interval: float = 1.0) -> int:
    """Follow a run happening in another terminal by tailing the state file."""
    if not STATE_PATH.exists():
        print(f"No run state at {STATE_PATH}.\n"
              f"Start one with: python -m core.setup.bootstrap")
        return 1
    drawn = 0
    try:
        while True:
            try:
                st = json.loads(STATE_PATH.read_text())
            except Exception:
                time.sleep(interval)
                continue
            lines = [f"\x1b[1m{st['database']}\x1b[0m @ {st['host']}   "
                     f"phase {st['phase']}   elapsed {_hms(st['elapsed_seconds'])}"
                     f"   (updated {st['updated_at'].split('T')[1]})", ""]
            for s in st["steps"]:
                mark, colour = {
                    "pending": ("·", "\x1b[90m"), "running": ("▶", "\x1b[36m"),
                    "ok": ("✔", "\x1b[32m"), "skipped": ("–", "\x1b[90m"),
                    "FAIL": ("✗", "\x1b[31m"),
                }.get(s["status"], ("?", ""))
                if s["status"] == "running":
                    pct = f"{s.get('frac', 0) * 100:.0f}%  " if s.get("frac_known") else ""
                    right = pct + (s["detail"] or "working…")
                else:
                    right = (f"{_hms(s['seconds'])}"
                             + (f"   {s['rows']:,} rows" if s.get("rows") else ""))
                lines.append(f" {colour}{mark}\x1b[0m {s['label']:<38} {right}")
            done = sum(1 for s in st["steps"] if s["status"] in ("ok", "skipped", "FAIL"))
            running = sum(s.get("frac", 0) for s in st["steps"]
                          if s["status"] == "running" and s.get("frac_known"))
            frac = (done + running) / max(len(st["steps"]), 1)
            lines += ["", f" {frac * 100:5.1f}%   {done}/{len(st['steps'])} steps"
                          f"   (reported, not estimated)"]
            if drawn:
                sys.stdout.write(f"\x1b[{drawn}A")
            for ln in lines:
                sys.stdout.write("\x1b[2K" + ln + "\n")
            drawn = len(lines)
            sys.stdout.flush()
            if st["phase"] in ("done", "failed", "interrupted"):
                return 0
            time.sleep(interval)
    except KeyboardInterrupt:
        return 0


# ------------------------------------------------------------------------------ plan

def _runner(ds: sources.Dataset) -> Callable[[Callable[[str], None]], object]:
    """The callable that actually ingests one registry dataset.

    Dispatch is by phase, and everything variable (Sharadar sync mode and kwargs, the
    FRED vintage URL, the derived rebuild function) is read off the Dataset — so adding a
    source is a registry entry, not another branch here."""

    if ds.phase == "schema":
        def run_schema(progress):
            from core.backend.db import models  # noqa: F401  (registers tables on Base)
            from core.backend.db.base import Base
            from core.backend.db.engine import engine
            progress("creating tables…")
            Base.metadata.create_all(engine)
            return f"{len(Base.metadata.tables)} tables"
        return run_schema

    if ds.phase == "sharadar":
        table = ds.key.split(":", 1)[1]

        def run_sharadar(progress, table=table, mode=ds.mode, kwargs=dict(ds.kwargs)):
            # FULL_REBUILD overrides the registry's incremental mode with a complete
            # re-download from the bulk export. The sync kwargs (sync_col, chunk_key)
            # describe how to find NEW rows, so they are meaningless here and passing
            # them would be a TypeError.
            if FULL_REBUILD:
                from core.backend.ingest.sharadar.sharadar_generic import load_table
                return load_table(table, skip_derived=True, progress=lambda *a: progress(
                    " ".join(str(x) for x in a)))
            from core.backend.ingest.sharadar.sharadar_generic import load_table, sync_coarse_table, sync_table
            fn = {"sync": sync_table, "quarters": sync_coarse_table,
                  "full": load_table}[mode]
            # skip_derived: derived objects are rebuilt once at the end, not after each
            # table — same reasoning as update_all, and it matters far more here, where
            # every table is a full backfill.
            return fn(table, skip_derived=True, progress=lambda *a: progress(" ".join(
                str(x) for x in a)), **kwargs)
        return run_sharadar

    if ds.key in ("fred:FRED-MD", "fred:FRED-QD"):
        dataset = ds.key.split(":", 1)[1]

        def run_fred_vintages(progress, dataset=dataset):
            from core.backend.ingest.fred.fred_md import FRED_MD_VINTAGES_URL, FRED_QD_VINTAGES_URL, ingest_fred_vintages
            url = FRED_MD_VINTAGES_URL if dataset == "FRED-MD" else FRED_QD_VINTAGES_URL
            progress(f"downloading {dataset} vintages…")
            return ingest_fred_vintages(url=url, dataset=dataset, full=False)
        return run_fred_vintages

    if ds.key == "fred:spot":
        def run_fred_spot(progress):
            from core.backend.ingest.fred.fred_api import COMMODITY_SPOT_SERIES, ingest_fred_series
            for i, sid in enumerate(COMMODITY_SPOT_SERIES, 1):
                progress(f"{sid} ({i}/{len(COMMODITY_SPOT_SERIES)})")
                ingest_fred_series(sid)
            return f"{len(COMMODITY_SPOT_SERIES)} series"
        return run_fred_spot

    if ds.phase == "finra":
        def run_finra(progress):
            from core.backend.ingest.finra import finra_short_interest as fsi
            # FINRA pages the whole US short-interest tape per settlement date, so this
            # step runs for a long time. Hand it `progress` so it says which date it is
            # on out of how many, rather than one line and then silence.
            return fsi.sync_short_interest(progress=progress)
        return run_finra

    if ds.phase == "sec":
        def run_sec(progress):
            from core.backend.ingest.sec.sec_fund_classes import load
            progress("company_tickers_mf.json…")
            return f"{load()} rows"
        return run_sec

    if ds.phase == "derived":
        # endpoint is the FULL dotted path of the rebuild function. Full, not relative:
        # the previous version assembled the package prefix here, which broke silently
        # when the query modules moved and failed every derived step at runtime.
        module, fname = ds.endpoint.rsplit(".", 1)

        def run_derived(progress, module=module, fname=fname, name=ds.label):
            import importlib
            import inspect

            from core.backend.db.engine import session_scope
            mod = importlib.import_module(module)
            progress(f"rebuilding {name}…")
            fn = getattr(mod, fname)
            # Hand the builder our progress sink when it takes one. A derived rebuild is
            # minutes of CTAS on tens of millions of rows, and "rebuilding X…" followed by
            # silence is indistinguishable from a hang. Checked rather than assumed so a
            # builder without the parameter still runs instead of raising TypeError.
            kw = {"progress": progress} if "progress" in inspect.signature(fn).parameters else {}
            with session_scope() as session:
                return fn(session, **kw)
        return run_derived

    raise ValueError(f"registry dataset {ds.key!r} has no runner (phase {ds.phase!r})")


def build_steps(only: list[str] | None,
                phases: list[str] | None = None,
                datasets: list[str] | None = None) -> list[Step]:
    """The step list, built from the data-source registry (`core.backend.sources`).

    The registry is the single source of truth: `update_all` derives its SHARADAR_PLAN
    from the same list and `docs/setup/sources.md` is generated from it, so what runs,
    what refreshes, and what the docs claim cannot drift apart.

    Two ways to build a subset, because there are two different reasons to want one:

    - `only`   — named Sharadar tables. For re-running one table that failed, so the other
                 phases are skipped entirely.
    - `phases` — whole phases (`fred`, `derived`, …). For a deliberately smaller database:
                 the macro layer without the paid Sharadar bundle, or a derived-only
                 rebuild after changing a repository.
    - `datasets` — exact registry keys (`sharadar:SEP`). For running ONE dataset as its own
                 process, so a single table can be pulled, watched and stopped on its own
                 without touching anything else."""
    only_up = {t.upper() for t in only} if only else None
    want_phases = {p.lower() for p in phases} if phases else None
    want_keys = set(datasets) if datasets else None
    steps: list[Step] = []
    for ds in sources.DATASETS:
        if want_keys is not None and ds.key not in want_keys:
            continue
        if want_phases is not None and ds.phase not in want_phases:
            continue
        if only_up is not None:
            if ds.phase != "sharadar" or ds.key.split(":", 1)[1] not in only_up:
                continue
        mode = f"  ({ds.mode})" if ds.mode else ""
        steps.append(Step(
            key=ds.key,
            label=f"{ds.phase} {ds.label}{mode}" if ds.phase != "schema" else ds.label,
            phase=ds.phase,
            run=_runner(ds),
            table=ds.table,
        ))
    return steps


# ------------------------------------------------------------------------------- run

# The loaders report free text, and only some of it carries a denominator. This pulls a
# REAL completion fraction out of the messages that do; everything else leaves frac_known
# False, and the display shows no per-step percentage rather than inventing one.
#   "permaticker: 8,400,000/41,000,000 rows" -> an explicit ratio
#
# There is deliberately NO rule for the bulk COPY. The loader announces the download as
# "zip ready (661 MB)" and then reports "COPY 1049 MB ...", and it is tempting to read the
# first as the denominator of the second. It is not: the zip is compressed and the COPY
# counts uncompressed bytes, so the ratio passes 1.0 early and stays there. Clamping it
# only hid that — SF1 sat at "running 100%" for the ten minutes it was still copying,
# which is worse than no number, because a wrong percentage is one people act on. The
# byte count still shows in the step's detail line; it just no longer claims to be a
# fraction of anything.
_RE_RATIO = re.compile(r"([\d,]+)\s*/\s*([\d,]+)")


def _report_frac(step: Step, msg: str) -> None:
    """Update `step.frac` from a loader message, if that message actually says how far
    along it is. Never guesses: a message with no denominator leaves the step unmeasured."""
    if m := _RE_RATIO.search(msg):
        done = float(m.group(1).replace(",", ""))
        total = float(m.group(2).replace(",", ""))
        # `done <= total` rejects the obvious false positive: a slash-date like 2020/01
        # parses as a ratio of 2020 to 1 and would otherwise pin the bar at 100%.
        if total > 0 and done <= total:
            step.frac = done / total
            step.frac_known = True



# --------------------------------------------------------------- per-step state

# A whole-build run used to write ONE state file and ONE log, so while it was loading
# SFP the /setup/ingest row for SFP still showed whatever its last standalone job did —
# "failed", in the case that prompted this. A row claiming FAIL while the dataset is
# actively loading is worse than a blank one.
#
# So the orchestrator now drives each dataset's own state file and log, exactly as if
# that dataset had been started on its own. One place produces the state, whoever ran it.


class StepStopped(Exception):
    """This one step was asked to stop; the run continues with the next."""


def _step_stop_requested(key: str) -> bool:
    """Has someone pressed Stop on THIS dataset's row?

    A build owns many steps, so a per-row Stop must not take the run down with it — which
    is what signalling the process would do, since every row reports the orchestrator's
    pid. The API writes `jobs/<slug>.stop`; the step checks it and abandons only itself.
    """
    try:
        from core.backend.jobs import runtime as rt
        return rt._job_paths(key)[2].exists()
    except Exception:
        return False


def _clear_step_stop(key: str) -> None:
    try:
        from core.backend.jobs import runtime as rt
        rt._job_paths(key)[2].unlink(missing_ok=True)
    except Exception:
        pass


def _step_key(step: "Step") -> str | None:
    """The registry key whose per-dataset state this step owns, if any."""
    return step.key if step.key in sources.BY_KEY else None


def _open_step_log(key: str) -> "Path | None":
    """Start this dataset's own dated log, rotating older ones."""
    try:
        from core.backend.jobs import runtime as rt
        rt._rotate_logs(key)
        return rt._new_log(key)
    except Exception:
        return None


def _write_step_state(key: str, step: "Step", log: "Path | None", phase: str) -> None:
    """Mirror one step into `core/data/jobs/<slug>.json` — the file the per-dataset UI
    row reads. Best-effort: reporting must never break the load it is reporting on."""
    try:
        from core.backend.jobs import runtime as rt
        state_p, _, _ = rt._job_paths(key)
        # A single-dataset job is already pointed at this exact file by --state-file, so
        # write_state() owns it. Writing it from here too would race two writers against
        # one path for no gain.
        if state_p.resolve() == STATE_PATH.resolve():
            return
        state_p.parent.mkdir(parents=True, exist_ok=True)
        tmp = state_p.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "database": settings.postgres_db,
            "host": f"{settings.postgres_host}:{settings.postgres_port}",
            "phase": phase,
            # A build has no --state-file in its argv, so the state path cannot prove the
            # pid is ours. The module name is in every bootstrap command line and is.
            "marker": "core.setup.bootstrap",
            "pid": os.getpid(),
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "elapsed_seconds": step.seconds,
            "log": str(log) if log else "",
            "steps": [{
                "key": step.key, "label": step.label, "phase": step.phase,
                "status": step.status, "seconds": step.seconds, "rows": step.rows,
                "note": step.note, "detail": step.detail,
                "frac": step.frac, "frac_known": step.frac_known,
            }],
        }, indent=2))
        tmp.replace(state_p)      # atomic: a reader never sees a half-written file
    except Exception:
        pass


def _run_one(step: Step, steps: list[Step], display: Display, started: float,
             resume: bool) -> None:
    """Execute one step, keeping the display, the run state and this dataset's OWN
    state file and log current throughout."""
    key = _step_key(step)
    if resume and step.table:
        existing = table_rows(step.table)
        if existing and existing > 0:
            step.status, step.rows = "skipped", existing
            step.note = f"already has {existing:,} rows — use --force to rebuild"
            display.transition(step)
            write_state(steps, started, step.phase)
            if key:
                _write_step_state(key, step, None, "done")
            return

    step.status = "running"
    step.frac, step.frac_known = 0.0, False
    if key:
        _clear_step_stop(key)      # a stale sentinel would abort this step instantly
    step_log = _open_step_log(key) if key else None
    display.transition(step)
    write_state(steps, started, step.phase)
    if key:
        _write_step_state(key, step, step_log, "running")
    t0 = time.time()

    def progress(msg: str) -> None:
        # Raised from inside the loader, so an in-flight COPY unwinds and its transaction
        # rolls back — the same clean abandonment a standalone job gets from SIGINT.
        if key and _step_stop_requested(key):
            raise StepStopped(f"{key} stopped by request")
        step.detail = str(msg)[:70]
        _report_frac(step, str(msg))
        display.refresh()
        # The state file is what --watch and a post-mortem read, so it has to advance
        # during a long step, not only at its end. Throttled to once a second.
        now = time.time()
        if now - getattr(progress, "_last", 0.0) > 1.0:
            progress._last = now  # type: ignore[attr-defined]
            write_state(steps, started, step.phase)
            if key:
                step.seconds = now - t0
                _write_step_state(key, step, step_log, "running")
        # Every line also goes to this dataset's own log, so /setup/dataset/log shows the
        # run that is happening rather than the last standalone one.
        if step_log is not None:
            try:
                with step_log.open("a") as fh:
                    fh.write(f"[{datetime.now():%H:%M:%S}] {msg}\n")
            except OSError:
                pass

    try:
        out = step.run(progress)
        step.status = "ok"
        if isinstance(out, dict) and "rows" in out:
            step.rows = out.get("total") or out.get("rows")
        elif step.table:
            step.rows = table_rows(step.table)
        if step.rows is None and out is not None:
            step.note = str(out)[:60]
    except KeyboardInterrupt:
        raise
    except StepStopped:
        step.status = "stopped"
        step.note = "stopped by request — re-run to retry this dataset"
        if key:
            _clear_step_stop(key)
    except Exception as exc:
        step.status = "FAIL"
        step.note = f"{type(exc).__name__}: {exc}".split("\n")[0][:70]
    finally:
        step.seconds = time.time() - t0
        step.detail = ""
        step.frac = 1.0 if step.status in ("ok", "skipped") else step.frac
        display.transition(step)
        write_state(steps, started, step.phase)
        if key:
            _write_step_state(key, step, step_log,
                              {"ok": "done", "stopped": "interrupted"}.get(step.status, "failed"))


def execute(steps: list[Step], display: Display, resume: bool) -> int:
    from core.backend.queries._rebuild import suppress_app_rebuilds

    started = display.started
    write_state(steps, started, "starting")
    ingest = [s for s in steps if s.phase in ("sharadar", "fred", "finra", "sec")]
    derived = [s for s in steps if s.phase == "derived"]
    schema = [s for s in steps if s.phase == "schema"]

    # A stale sentinel from a previous run would stop this one before it began.
    clear_stop()
    display.start_heartbeat()

    class _Stop(Exception):
        """Raised between steps when a stop has been requested."""

    def _run_group(group, resume_flag):
        for step in group:
            if stop_requested():
                raise _Stop
            _run_one(step, steps, display, started, resume_flag)

    try:
        _run_group(schema, False)              # schema steps are always idempotent
        if ingest:
            with suppress_app_rebuilds(log=print):
                _run_group(ingest, resume)
        _run_group(derived, resume)
    except _Stop:
        for s in steps:
            if s.status in ("running", "pending"):
                s.status, s.note = ("FAIL", "stopped") if s.status == "running" else (
                    "pending", "not reached — stopped")
        display.finish()
        write_state(steps, started, "interrupted")
        clear_stop()
        print("\nStopped. Start again to resume — finished steps are skipped.")
        return 130
    except KeyboardInterrupt:
        for s in steps:
            if s.status == "running":
                s.status, s.note = "FAIL", "interrupted"
        display.finish()
        write_state(steps, started, "interrupted")
        print("\nInterrupted. Re-run the same command to resume "
              "— finished steps are skipped.")
        return 130

    display.finish()
    failed = [s for s in steps if s.status == "FAIL"]
    write_state(steps, started, "failed" if failed else "done")

    print()
    print(f"{'step':44} {'status':8} {'time':>8}  rows")
    print("-" * 78)
    for s in steps:
        rows = f"{s.rows:,}" if s.rows else ""
        print(f"{s.label:44} {s.status:8} {_hms(s.seconds):>8}  {rows}")
    total = _hms(time.time() - started)
    print(f"\n{len(steps) - len(failed)}/{len(steps)} steps ok in {total}.")
    if failed:
        print(f"{len(failed)} FAILED: {', '.join(s.key for s in failed)}")
        print("Re-run to retry only what's missing; add --force to redo everything.")
        return 1
    print(f"Database {settings.postgres_db!r} is ready. "
          f"Serve it with:  uvicorn core.api.main:app --port 8001")
    return 0


# ------------------------------------------------------------------------------ main

def print_sources() -> int:
    """Where every byte comes from — the registry, grouped by provider.

    Printed rather than buried in a doc because the question "where did this number come
    from?" is asked while looking at the data, and an answer you have to go and find is an
    answer most people don't get."""
    print("Data sources — where every byte in this database comes from\n")
    for sid, src in sources.SOURCES.items():
        ds = [d for d in sources.DATASETS if d.source == sid]
        if not ds:
            continue
        print(f"{src.provider}")
        print(f"  licence   {src.licence}")
        print(f"  updates   {src.cadence}")
        if src.auth_env:
            have = "set" if os.environ.get(src.auth_env) or getattr(
                settings, src.auth_env.lower(), "") else "NOT SET"
            print(f"  auth      {src.auth_env}  [{have}]")
        if src.url:
            print(f"  url       {src.url}")
        if src.caveat:
            print(f"  note      {src.caveat}")
        print()
        for d in ds:
            tables = ", ".join(d.tables) or "—"
            print(f"    {d.endpoint}")
            print(f"      -> {tables:<40} {('mode: ' + d.mode) if d.mode else ''}")
        print()
    print("Generated table of the same registry: docs/setup/sources.md")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description="Build this database from scratch, with live progress.")
    p.add_argument("--check", action="store_true", help="Run preflight only and exit.")
    p.add_argument("--plan", action="store_true", help="Print the step list and exit.")
    p.add_argument("--sources", action="store_true",
                   help="Show where every dataset comes from (provider, licence, size).")
    p.add_argument("--status", action="store_true",
                   help="Show what the database currently holds and exit.")
    p.add_argument("--watch", action="store_true",
                   help="Follow a run started in another terminal.")
    p.add_argument("--create-db", action="store_true",
                   help="Create the database if it does not exist.")
    p.add_argument("--only", nargs="*", default=None,
                   help="Only these Sharadar tables (skips FRED/FINRA/SEC/derived).")
    p.add_argument("--dataset", nargs="*", default=None, metavar="KEY",
                   help="Only these registry dataset keys (e.g. sharadar:SEP). Runs one "
                        "dataset as its own job; see --state-file.")
    p.add_argument("--state-file", default=None, dest="state_file",
                   help="Where to write progress (default core/data/bootstrap-state.json). "
                        "Per-dataset jobs each get their own so they don't clobber.")
    p.add_argument("--only-phase", nargs="*", default=None, dest="only_phase",
                   metavar="PHASE",
                   help="Only these phases: " + " ".join(p for p, _ in sources.PHASES)
                        + ". Builds a deliberately smaller database.")
    p.add_argument("--force", action="store_true",
                   help="Re-run steps whose tables already hold rows. For Sharadar this "
                        "is an INCREMENTAL sync (new rows since the watermark), not a "
                        "re-download — see --full for that.")
    p.add_argument("--full", action="store_true",
                   help="Re-download each Sharadar table's bulk export from scratch and "
                        "upsert the lot. Implies --force. Hours; use when the local copy "
                        "is suspect, not merely stale.")
    p.add_argument("--plain", action="store_true",
                   help="One line per event instead of a redrawing display.")
    args = p.parse_args()

    if args.sources:
        return print_sources()

    if args.watch:
        return watch()

    if args.status:
        rows = db_status()
        if not rows:
            print(f"{settings.postgres_db}: no tables yet. "
                  f"Run: python -m core.setup.bootstrap")
            return 0
        print(f"{settings.postgres_db} @ {settings.postgres_host}:{settings.postgres_port}\n")
        print(f"{'table':52} {'rows':>14} {'size':>10}")
        print("-" * 78)
        for name, n, size in rows:
            print(f"{name:52} {n:>14,} {size:>10}")
        print(f"\n{len(rows)} tables. Load history: the Runs tab under /setup")
        return 0

    checks = preflight()
    print("Preflight")
    for c in checks:
        mark = "PASS" if c.ok else ("FAIL" if c.fatal else "WARN")
        print(f"  {mark}  {c.name:<52} {c.detail}")
    bad = [c for c in checks if not c.ok and c.fatal]
    warn = [c for c in checks if not c.ok and not c.fatal]

    # A missing database is the one failure this tool can fix itself.
    if args.create_db and any("exists" in c.name for c in bad):
        try:
            print(f"\n  {create_database()}")
            bad = [c for c in bad if "exists" not in c.name]
        except Exception as exc:
            print(f"\n  could not create database: {exc}")

    if bad:
        print("\nBlocked:")
        for c in bad:
            print(f"  {c.name}\n      {c.fix}")
        return 1

    # A missing optional credential gates one phase, not the build. Say which, and carry
    # on — refusing to start over a key you may not need is its own kind of wrong.
    if warn:
        print("\nWarnings (the build will run; these phases will fail):")
        for c in warn:
            print(f"  {c.name}\n      {c.fix}")
        print()
    else:
        print("  all checks passed\n")

    if args.check:
        return 0

    if args.state_file:
        globals()["STATE_PATH"] = Path(args.state_file)
        globals()["STOP_PATH"] = Path(args.state_file).with_suffix(".stop")

    if args.dataset:
        known = {d.key for d in sources.DATASETS}
        bad = [k for k in args.dataset if k not in known]
        if bad:
            print(f"Unknown dataset key(s): {bad}\nKnown: {sorted(known)}")
            return 1

    steps = build_steps(args.only, args.only_phase, args.dataset)
    if not steps:
        print("Nothing to do — that selection matched no datasets.")
        return 1

    if args.plan:
        print(f"{'step':42} {'mode':9} {'from':14} {'size on disk':>13}")
        print("-" * 88)
        phase = None
        for st in steps:
            ds = sources.BY_KEY.get(st.key)
            if ds and ds.phase != phase:
                phase = ds.phase
                desc = dict(sources.PHASES).get(phase, "")
                print(f"\n  {phase.upper()}  {desc}")
            src = sources.SOURCES[ds.source].short if ds else ""
            print(f"  {ds.label[:40]:40} {(ds.mode or ''):9} {src:14}")
        print(f"\n{len(steps)} steps.")
        if any(st.phase == "sharadar" for st in steps):
            print("This downloads tens of GB from Sharadar and takes hours. It is resumable.")
        else:
            print("No Sharadar steps in this plan — nothing paid is downloaded.")
        print("Provenance per source: python -m core.setup.bootstrap --sources")
        return 0

    if args.full:
        globals()["FULL_REBUILD"] = True

    display = Display(steps, plain=args.plain or None)
    return execute(steps, display, resume=not (args.force or args.full))


if __name__ == "__main__":
    raise SystemExit(main())
