"""Backtest endpoints — saved point-in-time backtest reports, and starting a new run.

    GET    /backtests                    every saved report's headline, newest first
    GET    /backtests/runs/current       is a run going, plus the tail of its log
    POST   /backtests/run                start a run (detached process); 409 if one is going
    GET    /backtests/{id}               the full report.json
    GET    /backtests/{id}/files/{name}  report.json | periods.csv | holdings.csv
    DELETE /backtests/{id}

Reports are folders under `<research_dir>/backtests/` (see core.backend.backtest.reports);
the runner is `python -m core.backend.backtest.run`, the same command a person runs by hand.
A run is a detached process, never work inside the request — it reads years of filings and
prices — so this router only starts, and reports on, a process that owns itself.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from core.backend import screens
from core.backend.backtest import reports
from core.backend.jobs import runtime as rt

router = APIRouter(prefix="/backtests", tags=["backtests"])

# The job key: one backtest at a time. Each reads all of sf1 and several weeks of `sep` per
# rebalance date; two at once would only make both slower and contend with ingests.
_JOB_KEY = "backtest"


@router.get("")
@router.get("/", include_in_schema=False)
def list_reports() -> dict[str, Any]:
    return {"root": str(reports.root()), "reports": reports.list_reports()}


def _state() -> dict[str, Any]:
    state_p, _, _ = rt._job_paths(_JOB_KEY)
    try:
        st = json.loads(state_p.read_text()) if state_p.exists() else {}
    except (OSError, ValueError):
        st = {}
    return st


@router.get("/runs/current")
def current_run(tail: int = 200) -> dict[str, Any]:
    """Whether a backtest is running, and the last lines of the newest run's log (running
    or just finished — so the page can show how it ended, and link the new report)."""
    job = rt._job_state(_JOB_KEY)
    st = _state()
    lines: list[str] = []
    log = st.get("log")
    if log and Path(log).is_file():
        try:
            lines = rt._read_log(Path(log), max(1, min(int(tail), 2000)))
        except OSError:
            lines = []
    return {
        "running": bool(job.get("running")),
        "phase": st.get("phase"),
        "pid": job.get("pid"),
        "started_at": st.get("started_at"),
        "updated_at": st.get("updated_at"),
        "log_name": Path(log).name if log else None,
        "report_id": st.get("report_id"),
        "detail": st.get("detail"),
        "lines": lines,
    }


class RunRequest(BaseModel):
    screen: str
    kind: str = Field("portfolio", pattern="^(portfolio|cohort)$")
    start: date = date(2005, 1, 1)
    end: date | None = None
    rebalance_months: int = Field(12, ge=1, le=60)
    hold_months: int = Field(12, ge=1, le=120)
    benchmark: str = Field("SPY", pattern=r"^[A-Za-z][A-Za-z0-9.\-]{0,9}$")
    cost_bps: float = Field(30.0, ge=0, le=1000)
    min_price: float = Field(3.0, ge=0)
    min_adv: float = Field(1e6, ge=0)
    min_names: int = Field(5, ge=1, le=500)
    name: str | None = Field(None, max_length=120)


@router.post("/run")
def start_run(req: RunRequest) -> dict[str, Any]:
    if rt._job_state(_JOB_KEY).get("running"):
        raise HTTPException(409, "A backtest is already running — wait for it to finish.")
    try:
        screens.load_screen.cache_clear()       # pick up a screen saved since startup
        screens.load_screen(req.screen)
    except screens.ScreenSpecError as e:
        raise HTTPException(400, str(e)) from e
    if req.end and req.end <= req.start:
        raise HTTPException(400, "end must be after start.")

    state_p, _, _ = rt._job_paths(_JOB_KEY)
    state_p.parent.mkdir(parents=True, exist_ok=True)
    rt._rotate_logs(_JOB_KEY)
    log_path = rt._new_log(_JOB_KEY)
    argv = [sys.executable, "-u", "-m", "core.backend.backtest.run",
            "--screen", req.screen, "--kind", req.kind,
            "--start", req.start.isoformat(),
            "--rebalance", str(req.rebalance_months), "--hold-months", str(req.hold_months),
            "--benchmark", req.benchmark.upper(), "--cost-bps", str(req.cost_bps),
            "--min-price", str(req.min_price), "--min-adv", str(req.min_adv),
            "--min-names", str(req.min_names),
            "--state-file", str(state_p), "--log", str(log_path), "--trigger", "manual"]
    if req.end:
        argv += ["--end", req.end.isoformat()]
    if req.name and req.name.strip():
        argv += ["--name", req.name.strip()]
    pid = rt._spawn(argv, log_path)
    # The placeholder makes /runs/current say "running" the instant this returns; the runner
    # then updates the same file (phase, report_id) as it goes.
    rt._mark_starting(state_p, pid, log_path)
    return {"pid": pid, "log_name": log_path.name}


def _missing(e: Exception):
    raise HTTPException(404, f"No backtest report {e}") from e


@router.get("/{report_id}")
def get_report(report_id: str) -> dict[str, Any]:
    try:
        return reports.read_report(report_id)
    except reports.ReportNotFound as e:
        _missing(e)


@router.get("/{report_id}/files/{name}")
def get_file(report_id: str, name: str):
    try:
        p = reports.report_file(report_id, name)
    except reports.ReportNotFound as e:
        _missing(e)
    media = "application/json" if name.endswith(".json") else "text/csv"
    return FileResponse(p, media_type=media, filename=f"{report_id}-{name}")


@router.delete("/{report_id}")
def delete_report(report_id: str) -> dict[str, Any]:
    try:
        reports.delete_report(report_id)
    except reports.ReportNotFound as e:
        _missing(e)
    return {"deleted": report_id}
