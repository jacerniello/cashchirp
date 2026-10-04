"""Backtest report folders: `<research_dir>/backtests/<id>/` holding report.json + CSVs.

Reports are plain files, not database rows, so they live with the rest of the research
(gitignored by default — the apparatus is in the repo, the results are not) and can be read,
diffed or archived without the app. Ids are `<YYYYMMDD-HHMM>-<slug>`; every id and file name
that reaches the filesystem is validated here, so an API caller can never steer a path.
"""
from __future__ import annotations

import csv
import json
import math
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from core.config import settings

REPORT_FILE = "report.json"
# The only files a client may download from a report folder. The last five belong to the
# study kinds (gate-audit, signal-study, screen-comparison — see backtest/study.py).
FILES = ("report.json", "periods.csv", "holdings.csv", "gates.csv", "sensitivity.csv",
         "signals.csv", "quintiles.csv", "comparison.csv")
STUDY_KINDS = ("gate-audit", "signal-study", "screen-comparison")

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ReportNotFound(LookupError):
    """No report with that id (or the id is not a valid report id)."""


def root() -> Path:
    """`<research_dir>/backtests`, read from settings each call so RESEARCH_DIR overrides
    (tests, throwaway runs) take effect without a restart of anything that imported us."""
    return Path(settings.research_dir) / "backtests"


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "backtest")[:60].rstrip("-")


def new_id(name: str, now: datetime | None = None) -> str:
    """`<YYYYMMDD-HHMM>-<slug>`, suffixed `-2`, `-3`… if that folder already exists."""
    base = f"{(now or datetime.now()).strftime('%Y%m%d-%H%M')}-{slugify(name)}"
    rid, n = base, 1
    while (root() / rid).exists():
        n += 1
        rid = f"{base}-{n}"
    return rid


def _dir(report_id: str) -> Path:
    if not _ID_RE.match(report_id or "") or ".." in report_id:
        raise ReportNotFound(report_id)
    d = (root() / report_id).resolve()
    if d.parent != root().resolve() or not d.is_dir():
        raise ReportNotFound(report_id)
    return d


def _clean(obj: Any) -> Any:
    """NaN/inf → None, recursively (JSON has no NaN; a bare NaN would make the file
    unreadable to the browser)."""
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if hasattr(obj, "item"):            # numpy scalar
        return _clean(obj.item())
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


_PERIOD_COLS = ("start", "end", "partial", "cash", "n_universe", "n_eligible", "n_passed",
                "n_held", "n_stopped", "turnover", "ret_gross", "ret_net", "median_ret",
                "double_rate", "halve_rate", "bench_ret", "universe_ret")
_HOLDING_COLS = ("start", "end", "permaticker", "ticker", "name", "sector", "marketcap",
                 "entry_px", "exit_px", "exit_date", "ret", "stopped_trading")


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    cols: list[str] = []
    for r in rows:
        cols.extend(k for k in r if k not in cols)
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def write_report(report: dict[str, Any],
                 tables: dict[str, list[dict[str, Any]]] | None = None) -> Path:
    """Write report.json, periods.csv and holdings.csv into a new folder named by
    `report["id"]`. Written to a temp name then renamed, so a half-written report is never
    listed. A study report (no periods) passes its flat tables as `tables`
    ({"gates.csv": rows, …}); each name must be in FILES."""
    rid = report["id"]
    if not _ID_RE.match(rid):
        raise ValueError(f"bad report id {rid!r}")
    root().mkdir(parents=True, exist_ok=True)
    final = root() / rid
    tmp = root() / f".{rid}.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    report = _clean(report)
    (tmp / REPORT_FILE).write_text(json.dumps(report, indent=1))
    for name, rows in (tables or {}).items():
        if name not in FILES:
            raise ValueError(f"{name!r} is not a downloadable report file")
        _write_csv(tmp / name, _clean(rows))
    if report.get("kind") in STUDY_KINDS:
        tmp.rename(final)
        return final
    with (tmp / "periods.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=_PERIOD_COLS, extrasaction="ignore")
        w.writeheader()
        for p in report["periods"]:
            w.writerow(p)
    with (tmp / "holdings.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=_HOLDING_COLS, extrasaction="ignore")
        w.writeheader()
        for p in report["periods"]:
            for h in p.get("holdings") or []:
                w.writerow({"start": p["start"], "end": p["end"], **h})
    tmp.rename(final)
    return final


def list_reports() -> list[dict[str, Any]]:
    """Every report's headline, newest first. A folder whose report.json is missing or
    unreadable is listed with an `error` rather than hidden or allowed to break the list."""
    out: list[dict[str, Any]] = []
    if not root().is_dir():
        return out
    for d in root().iterdir():
        if not d.is_dir() or d.name.startswith(".") or not _ID_RE.match(d.name):
            continue
        try:
            r = json.loads((d / REPORT_FILE).read_text())
            out.append({
                "id": d.name, "name": r.get("name"), "kind": r.get("kind"),
                "created_at": r.get("created_at"),
                "screen": {"id": (r.get("screen") or {}).get("id"),
                           "title": (r.get("screen") or {}).get("title")},
                "params": r.get("params"),
                "summary": r.get("summary") or {},
                "warnings": len(r.get("warnings") or []),
                "serious_warnings": sum(1 for w in r.get("warnings") or []
                                        if w.get("level") == "warn"),
            })
        except (OSError, ValueError, AttributeError) as e:
            out.append({"id": d.name, "name": d.name, "kind": None, "created_at": None,
                        "screen": None, "params": None, "summary": {}, "warnings": 0,
                        "serious_warnings": 0, "error": f"unreadable report: {e}"})
    out.sort(key=lambda r: (r.get("created_at") or "", r["id"]), reverse=True)
    return out


def read_report(report_id: str) -> dict[str, Any]:
    d = _dir(report_id)
    try:
        return json.loads((d / REPORT_FILE).read_text())
    except (OSError, ValueError) as e:
        raise ReportNotFound(f"{report_id}: {e}") from e


def report_file(report_id: str, name: str) -> Path:
    """Path of one downloadable file — only names in FILES, only inside the report."""
    if name not in FILES:
        raise ReportNotFound(name)
    p = _dir(report_id) / name
    if not p.is_file():
        raise ReportNotFound(name)
    return p


def delete_report(report_id: str) -> None:
    shutil.rmtree(_dir(report_id))
