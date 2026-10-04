"""Run a point-in-time backtest of a saved screen and save it as a report folder.

    python -m core.backend.backtest.run --screen quality-value --kind portfolio \\
        --start 2005-01-01 --end 2024-12-31 --rebalance 12

    --kind portfolio   equal-weight the passers each rebalance, hold to the next; NAV vs SPY
                       and vs the equal-weight eligible universe (net of --cost-bps)
    --kind cohort      each rebalance date's passers, forward --hold-months total return;
                       pooled base rates (double / halve) vs universe and SPY

Writes `<research_dir>/backtests/<YYYYMMDD-HHMM>-<slug>/` with report.json, periods.csv and
holdings.csv, and prints progress as it goes (the app tails this output). Exits non-zero on
failure. The run is recorded in the job-run ledger (Setup → Runs) unless --no-record.

A backtest is a falsification test, not a recommendation: write down what result would make
you abandon the screen BEFORE running it, or the number is just something to rationalise.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from core.backend import screens
from core.backend.backtest import harness, reports


def _write_state(path: Path | None, **fields: Any) -> None:
    """Update the job state file the API reads (`core/data/jobs/backtest.json`). Best-effort."""
    if path is None:
        return
    try:
        st = json.loads(path.read_text()) if path.exists() else {}
    except (OSError, ValueError):
        st = {}
    st.update(fields, updated_at=datetime.now().isoformat(timespec="seconds"))
    try:
        path.write_text(json.dumps(st, indent=2))
    except OSError:
        pass


def parse(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python -m core.backend.backtest.run",
                                 description=__doc__.split("\n\n")[0])
    ap.add_argument("--screen", required=True, help="screen id from config/screens/")
    ap.add_argument("--kind", choices=("portfolio", "cohort"), default="portfolio")
    ap.add_argument("--start", default="2005-01-01")
    ap.add_argument("--end", default=None, help="default: latest price date")
    ap.add_argument("--rebalance", type=int, default=12, help="months between rebalances")
    ap.add_argument("--hold-months", type=int, default=12, help="cohort forward horizon")
    ap.add_argument("--benchmark", default="SPY")
    ap.add_argument("--cost-bps", type=float, default=30.0, help="per unit of turnover")
    ap.add_argument("--min-price", type=float, default=3.0)
    ap.add_argument("--min-adv", type=float, default=1e6, help="min avg daily $ volume")
    ap.add_argument("--min-names", type=int, default=5)
    ap.add_argument("--name", default=None, help="report name (default: screen + kind)")
    ap.add_argument("--state-file", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--log", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--trigger", default="cli", choices=("cli", "manual", "scheduled"),
                    help=argparse.SUPPRESS)
    ap.add_argument("--no-record", action="store_true",
                    help="do not write this run to the job-run ledger")
    a = ap.parse_args(argv)
    if not 1 <= a.rebalance <= 60:
        ap.error("--rebalance must be 1..60 months")
    if not 1 <= a.hold_months <= 120:
        ap.error("--hold-months must be 1..120")
    return a


def main(argv: list[str] | None = None) -> int:
    a = parse(argv)
    state = Path(a.state_file) if a.state_file else None
    t0 = time.time()

    def say(msg: str) -> None:
        print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)

    run_id = None
    if not a.no_record:
        from core.backend.queries.meta import jobs as jobsq
        run_id = jobsq.start_run(key=f"backtest:{a.screen}", kind="backtest",
                                 trigger=a.trigger, label=f"Backtest · {a.screen} ({a.kind})",
                                 mode=a.kind, pid=os.getpid(), log=a.log and Path(a.log).name)
    _write_state(state, phase="running", pid=os.getpid(), run_id=run_id,
                 steps=[{"status": "running", "detail": f"{a.screen} {a.kind}"}])

    status, detail, report_id = "failed", None, None
    try:
        spec = screens.load_screen(a.screen)
        p = harness.Params(
            screen=a.screen, kind=a.kind, start=a.start, end=a.end,
            rebalance_months=a.rebalance, hold_months=a.hold_months,
            benchmark=a.benchmark.upper(), cost_bps=a.cost_bps, min_price=a.min_price,
            min_adv=a.min_adv, min_names=a.min_names)
        say(f"Backtest: screen '{spec['id']}' — {spec.get('title', '')}")
        say(f"  kind={p.kind} start={p.start} end={p.end or 'latest'} "
            f"rebalance={p.rebalance_months}m"
            + (f" hold={p.hold_months}m" if p.kind == "cohort" else f" cost={p.cost_bps}bps")
            + f" benchmark={p.benchmark}")

        from core.backend.db.engine import session_scope
        with session_scope() as session:
            res = harness.run(session, p, say)

        name = a.name or f"{spec['id']} {p.kind} {p.start[:4]}-{p.end[:4]}"
        report_id = reports.new_id(name)
        report = {
            "id": report_id, "name": name, "kind": p.kind,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "elapsed_seconds": round(time.time() - t0, 1),
            "params": asdict(p),
            "screen": {"id": spec["id"], "title": spec.get("title"),
                       "description": (spec.get("description") or "").strip(),
                       "criteria": spec.get("criteria") or [], "spec": spec},
            "series_kind": res.series_kind,
            "summary": res.summary,
            "series": res.series,
            "periods": res.periods,
            "warnings": res.warnings,
            "method": _method(p),
        }
        out = reports.write_report(report)
        _print_summary(say, res)
        serious = sum(w["level"] == "warn" for w in res.warnings)
        say(f"{len(res.warnings)} warning(s), {serious} serious" if res.warnings
            else "No sanity warnings.")
        say(f"Report saved → {out}")
        print(f"REPORT_ID={report_id}", flush=True)
        status, detail = "ok", report_id
        return 0
    except Exception as e:  # noqa: BLE001 - the process boundary: report, record, exit 1
        traceback.print_exc()
        say(f"FAILED: {e}")
        detail = str(e)[:500]
        return 1
    finally:
        _write_state(state, phase="done" if status == "ok" else "failed",
                     report_id=report_id, detail=detail,
                     steps=[{"status": "ok" if status == "ok" else "FAIL",
                             "detail": detail or ""}])
        _finish_run(run_id, status, detail)


def _finish_run(run_id: int | None, status: str, detail: str | None) -> None:
    """Record the outcome on this run's ledger row — even if a reconcile already closed it.

    `jobs.finish_run` only touches rows still marked running. But reconcile judges liveness
    by `ps` on whichever host runs the scheduler, and the database is shared: an API on
    another machine sees this pid as dead and closes the row as failed mid-run. The process
    that did the work is the authority on how it ended, so it writes the outcome directly."""
    if run_id is None:
        return
    try:
        from core.backend.db.engine import session_scope
        from core.backend.db.models import JobRun
        from core.backend.queries.meta import jobs as jobsq
        with session_scope() as session:
            r = session.get(JobRun, run_id)
            if r is not None:
                r.status, r.detail, r.finished_at = status, detail, jobsq.now_local()
    except Exception:  # noqa: BLE001 - the ledger must never fail the run
        pass


def _method(p: harness.Params) -> list[str]:
    """Plain-language statement of what was measured, stored with the report so it can
    never be read without its caveats."""
    lines = [
        "Point-in-time: fundamentals are the latest sf1 filing with datekey ≤ the date "
        f"(and no older than {harness.FUNDAMENTAL_STALE_DAYS} days); valuation is the latest "
        f"`daily` row within {harness.VALUATION_WINDOW_DAYS} days.",
        "Survivorship-free: the universe is every security with a `daily` row near the date; "
        "today's delisted flag is ignored; names that stop trading are valued at their last "
        "print.",
        f"Tradable at entry: a `sep` print within {harness.TRADABLE_WINDOW_DAYS} days, "
        f"unadjusted price ≥ ${p.min_price:g}, average daily dollar volume ≥ ${p.min_adv:,.0f}.",
        "Returns are total returns from closeadj (split- and dividend-adjusted), equal-weighted.",
        f"Benchmark {p.benchmark}: closeadj total return over identical dates. Universe: the "
        "screen's universe rules and market-cap band without its other gates, same liquidity "
        "floor, equal-weighted.",
    ]
    if p.kind == "portfolio":
        lines.append(
            f"Portfolio: rebalanced every {p.rebalance_months} months, buy-and-hold in between, "
            f"marked monthly. {p.cost_bps:g} bps charged per unit of turnover. Periods with "
            f"fewer than {p.min_names} tradable passers sit in cash. Volatility and drawdown are "
            "measured on the monthly marks.")
    else:
        lines.append(
            f"Cohort: every rebalance date's passers, forward {p.hold_months}-month total "
            "return per name, pooled. Overlapping cohorts are not independent samples.")
    return lines


def _print_summary(say, res: harness.Result) -> None:
    s = res.summary

    def pc(k: str) -> str:
        v = s.get(k)
        return "n/a" if v is None else f"{v * 100:.1f}%"
    if res.params.kind == "portfolio":
        say(f"RESULT {s['start']} → {s['end']} ({s['periods']} periods, "
            f"avg {s['avg_holdings']:.0f} names)")
        say(f"  strategy  CAGR {pc('cagr')}  total {pc('total_return')}  vol {pc('volatility')}"
            f"  maxDD {pc('max_drawdown')}")
        say(f"  {res.params.benchmark:<8}  CAGR {pc('bench_cagr')}  total "
            f"{pc('bench_total_return')}  maxDD {pc('bench_max_drawdown')}")
        say(f"  universe  CAGR {pc('universe_cagr')}  total {pc('universe_total_return')}")
        say(f"  excess vs {res.params.benchmark} {pc('excess_cagr')}/yr · vs universe "
            f"{pc('excess_cagr_vs_universe')}/yr · hit rate {pc('hit_rate')}")
    else:
        say(f"RESULT {s['cohorts']} cohorts, {s['observations']} name-observations, "
            f"{s['hold_months']}m forward")
        say(f"  screen    mean {pc('mean_return')}  median {pc('median_return')}  double "
            f"{pc('double_rate')}  halve {pc('halve_rate')}")
        say(f"  universe  mean {pc('universe_mean_return')}  median "
            f"{pc('universe_median_return')}  double {pc('universe_double_rate')}")
        say(f"  {res.params.benchmark} mean {pc('bench_mean_return')} · names beating it "
            f"{pc('beat_bench_rate')}")


if __name__ == "__main__":
    sys.exit(main())
