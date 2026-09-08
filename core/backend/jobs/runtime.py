"""How a job actually runs: a detached process, its state file, and its own dated log.

Extracted from the setup router so that the scheduler and the manual controls spawn work
through **one** code path. Two implementations of "start an ingest" would drift, and the
difference would only show up as a scheduled run behaving unlike the button that claims
to do the same thing.

The router is HTTP glue on top of this; nothing here knows about FastAPI.
"""
from __future__ import annotations

import gzip
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from core.config import CORE_DIR, PROJECT_ROOT, settings


class UnknownRun(LookupError):
    """Asked for a log run that does not exist."""

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


# What one of our job processes looks like on the process table.
#
# Matched on the `-m ...setup.bootstrap` INVOCATION rather than a hardcoded dotted path,
# because that path has moved twice — out of `core/` into `core/scripts/setup/`, then back
# to `core/setup/` — and each move silently broke this. The failure is quiet and bad: every
# running job reports dead, so the UI shows nothing running AND the duplicate-start guard
# stops guarding, which is how a second bulk load gets launched on top of a live one.
#
# Requiring `-m` also makes it stricter than the substring test it replaces, which matched
# any command line that merely mentioned the module — an editor, a grep, a shell one-liner.
_BOOTSTRAP_INVOCATION = re.compile(r"(?:^|\s)-m\s+[\w.]*\bsetup\.bootstrap(?:\s|$)")


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
            if pid_s.isdigit() and _BOOTSTRAP_INVOCATION.search(cmd):
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
    name is an error, not a silent fallback to the newest — quietly showing a different
    run than the one asked for is how you debug the wrong failure.

    Raises `UnknownRun` rather than an HTTP error: this module has no business knowing it
    is behind a web API, and the scheduler calls it too."""
    if not name:
        return runs[0]
    for p in runs:
        if p.name == name:
            return p
    raise UnknownRun(f"No run {name!r}. Available: {[p.name for p in runs][:10]}")


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


# ------------------------------------------------------------------ spawning

# The full build writes here; per-dataset jobs each write their own (see `_job_paths`).
STATE_PATH = CORE_DIR / "data" / "bootstrap-state.json"

MODES = ("update", "missing", "full")
BUILD_KINDS = ("all", "ingest", "derive")


def _spawn(argv: list[str], log_path: Path) -> int:
    """Start a detached child writing to `log_path`. Returns its pid.

    `-u` is not optional: Python block-buffers stdout when it is a file rather than a
    terminal, so without it the first few KB — preflight and the early steps — sit in the
    child's buffer while the live log looks empty. Streaming output defeated by a 4 KB
    buffer is worse than no streaming, because it looks like nothing is happening.

    `start_new_session` gives the job its own session, so it outlives this request, the
    connection, and a reload of the API.
    """
    log = open(log_path, "ab", buffering=0)  # noqa: SIM115 - owned by the child
    try:
        proc = subprocess.Popen(
            argv, cwd=str(PROJECT_ROOT), stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
    finally:
        log.close()
    return proc.pid


def build_running() -> bool:
    """Whether a full build is alive right now, by state file plus a liveness check.

    The phase alone cannot answer this: a killed process leaves its last phase behind
    forever, so anything trusting it reports a build that died days ago.
    """
    try:
        st = json.loads(STATE_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    return (_alive(st.get("pid"))
            and st.get("phase") not in ("done", "failed", "interrupted"))


def spawn_dataset(key: str, mode: str = "update") -> dict[str, Any]:
    """Pull ONE dataset as its own detached process, with its own state file and log."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    state_p, _, stop_p = _job_paths(key)
    _JOBS_DIR.mkdir(parents=True, exist_ok=True)
    stop_p.unlink(missing_ok=True)      # a stale stop would halt it immediately
    _rotate_logs(key)
    log_path = _new_log(key)

    argv = [sys.executable, "-u", "-m", "core.setup.bootstrap", "--plain",
            "--dataset", key, "--state-file", str(state_p)]
    if mode == "full":
        argv.append("--full")
    elif mode == "update":
        argv.append("--force")

    pid = _spawn(argv, log_path)
    _mark_starting(state_p, pid, log_path)
    return {"pid": pid, "log": str(log_path), "log_name": log_path.name, "mode": mode,
            "argv": argv[1:]}


def spawn_build(kind: str = "all", mode: str = "update",
                phases: list[str] | None = None,
                only: list[str] | None = None) -> dict[str, Any]:
    """Start (or resume) a whole build. Resume is the same call — `bootstrap` skips steps
    whose table already holds rows, so there is no separate resume operation."""
    from core.backend import sources    # local: avoids a cycle at import time

    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    if kind not in BUILD_KINDS:
        raise ValueError(f"kind must be one of {BUILD_KINDS}, got {kind!r}")

    argv = [sys.executable, "-u", "-m", "core.setup.bootstrap", "--create-db",
            "--plain"]
    chosen = list(phases or [])
    # Schema rides along with an ingest run: it is idempotent, and an ingest into
    # missing tables fails.
    if not chosen and kind == "ingest":
        chosen = ["schema", *sources.INGEST_PHASES]
    elif not chosen and kind == "derive":
        chosen = list(sources.DERIVE_PHASES)
    if chosen:
        argv += ["--only-phase", *chosen]
    if only:
        argv += ["--only", *(t.upper() for t in only)]
    if mode == "full":
        argv.append("--full")
    elif mode == "update":
        argv.append("--force")

    _STOP_PATH.unlink(missing_ok=True)
    _rotate_logs(None)
    log_path = _new_log(None)
    pid = _spawn(argv, log_path)
    _mark_starting(STATE_PATH, pid, log_path)
    return {"pid": pid, "log": str(log_path), "log_name": log_path.name,
            "kind": kind, "mode": mode, "phases": chosen or "all", "argv": argv[1:]}
