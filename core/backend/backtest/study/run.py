"""Runner for the study kinds — gate-audit, signal-study, compare — called by `run.main`.

Loads (or builds) the cached panel, runs the study in `study.py`, and writes the report
folder (`report.json` + CSVs) with `reports.write_report`. `compare --with-backtests` also
runs the ordinary portfolio and cohort backtests per screen, over the holdout and the full
range, saves each as its own report (equity curve, holdings) and links them.
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime
from typing import Any, Callable

from core.backend import screens
from core.backend.backtest import harness, reports
from core.backend.backtest.study import analysis as study, panel

Say = Callable[[str], None]

KIND_NAME = {"gate-audit": "gate-audit", "signal-study": "signal-study",
             "compare": "screen-comparison"}


def _periods(a: argparse.Namespace, default: tuple[str, ...]) -> tuple[str, ...]:
    if not a.periods:
        return default
    ps = tuple(x.strip() for x in a.periods.split(",") if x.strip())
    bad = set(ps) - {"discovery", "holdout", "gap"}
    if bad:
        raise ValueError(f"unknown period(s) {sorted(bad)}")
    return ps


def _screen_block(spec: dict[str, Any]) -> dict[str, Any]:
    return {"id": spec["id"], "title": spec.get("title"),
            "description": (spec.get("description") or "").strip(),
            "criteria": spec.get("criteria") or [], "spec": spec}


def _method(d) -> list[str]:
    return [
        "Panel: harness.build_panel at each 1 January 2003–2022 (the same point-in-time "
        "snapshot the backtest screens: sf1 by filing date ≤ q and ≤ 18 months old, `daily` "
        "valuation within 21 days, today's delisted flag ignored), plus extra signals from "
        "data public by q.",
        "Forward returns: closeadj (total return) from the last print on/before q to the last "
        "print on/before q+12m / q+24m, on the one ticker series chosen at entry; a name that "
        "stops trading is valued at its final print (stopped = last print > 10 days before "
        "the horizon).",
        "Pooled metrics add up every (date, name) observation in the period; "
        "excess_median_by_date averages, over dates, the kept set's median 24m return minus "
        "the universe's — so one boom year cannot carry the number.",
        "Overlapping 24-month windows (yearly dates) are not independent: read differences "
        "as sizes, not significance.",
        f"Panel rows by period: {panel.info(d)}.",
    ]


def main(a: argparse.Namespace, say: Say) -> str:
    t0 = time.time()
    d = panel.load(rebuild=a.rebuild_panel, say=say)
    kind = KIND_NAME[a.kind]
    tables: dict[str, list[dict[str, Any]]] = {}
    report: dict[str, Any] = {"kind": kind, "objective": study.OBJECTIVE,
                              "method": _method(d), "warnings": []}

    if a.kind == "gate-audit":
        spec = screens.load_screen(a.screen)
        pers = _periods(a, ("discovery", "holdout"))
        say(f"Gate audit: {spec['id']} over {', '.join(pers)}")
        res = study.gate_audit(d, spec, pers)
        report.update(screen=_screen_block(spec), params={"screen": spec["id"],
                                                          "periods": list(pers)},
                      full=res["full"], gates=res["gates"], sensitivity=res["sensitivity"])
        summ: dict[str, Any] = {"periods": list(pers)}
        for per, m in res["full"].items():
            for k in ("p_retention", "p_removal", "p_edge", "a_edge", "names_per_date",
                      "median_24m_kept", "median_24m_univ"):
                summ[f"{per}_{k}"] = m.get(k)
            say(f"  {per}: full screen keeps {m['names_per_date']:.1f} names/date · winner "
                f"retention {m['p_retention']:.1%} · loser removal {m['p_removal']:.1%} · "
                f"edge {m['p_edge']:+.3f}")
        report["summary"] = summ
        tables["gates.csv"] = [{"period": g["period"], "gate": g["gate"], "rule": g["rule"],
                                **study.flat("alone.", g["alone"]),
                                **study.flat("loo.", g["loo"]),
                                **study.flat("let_back_in.", g["let_back_in"])}
                               for g in res["gates"]]
        tables["sensitivity.csv"] = [{"period": r["period"], "gate": r["gate"],
                                      "key": r["key"], "value": r["value"],
                                      "current": r["current"],
                                      **study.flat("alone.", r["alone"]),
                                      **study.flat("in_screen.", r["in_screen"])}
                                     for r in res["sensitivity"]]
        name = a.name or f"{spec['id']} gate audit ({'+'.join(pers)})"

    elif a.kind == "signal-study":
        spec = screens.load_screen(a.screen)
        pers = _periods(a, ("discovery",))
        say(f"Signal study within {spec['id']}'s universe over {', '.join(pers)}")
        rows = study.signal_study(d, spec, pers)
        report.update(screen=_screen_block(spec), params={"screen": spec["id"],
                                                          "periods": list(pers)},
                      signals=rows)
        mono = [r["signal"] for r in rows if r.get("monotonic")]
        report["summary"] = {"periods": list(pers), "signals": len(rows),
                             "monotonic": len(mono), "top": [r["signal"] for r in rows[:5]]}
        for r in rows[:12]:
            say(f"  {r['signal']:<20} spread(win−lose) {r.get('spread_net') or 0:+.3f} "
                f"spearman {r.get('spearman_net') or 0:+.2f} cov {r['coverage']:.0%}")
        tables["signals.csv"] = [{k: v for k, v in r.items()
                                  if k not in ("quintiles", "null", "net_by_quintile")}
                                 for r in rows]
        tables["quintiles.csv"] = [{"signal": r["signal"], **b}
                                   for r in rows for b in r.get("quintiles") or []]
        name = a.name or f"{spec['id']} signal study ({'+'.join(pers)})"

    else:  # compare
        ids = [x.strip() for x in a.screens.split(",") if x.strip()]
        specs = [screens.load_screen(i) for i in ids]
        pers = _periods(a, ("discovery", "holdout"))
        say(f"Comparing {', '.join(ids)} over {', '.join(pers)}")
        rows = study.compare(d, specs, pers)
        for r in rows:
            say(f"  {r['screen']:<22} {r['period']:<10} {r['names_per_date']:5.1f}/date  "
                f"retention {r['p_retention']:.1%} removal {r['p_removal']:.1%} "
                f"edge {r['p_edge']:+.3f} | abs edge {r['a_edge']:+.3f} | "
                f"median24 {r['median_24m_kept']:+.1%} vs univ {r['median_24m_univ']:+.1%}")
        backtests = _backtests(specs, d, say) if a.with_backtests else []
        report.update(params={"screens": ids, "periods": list(pers),
                              "with_backtests": bool(a.with_backtests)},
                      screen={"id": ",".join(ids), "title": " vs ".join(
                          s.get("title") or s["id"] for s in specs), "description": "",
                          "criteria": [], "spec": {}},
                      screens=[_screen_block(s) for s in specs],
                      comparison=rows, backtests=backtests)
        report["summary"] = {"periods": list(pers), "screens": ids,
                             **{f"{r['screen']}|{r['period']}|p_edge": r["p_edge"]
                                for r in rows}}
        tables["comparison.csv"] = rows
        name = a.name or f"compare {' vs '.join(ids)}"

    rid = reports.new_id(name)
    report.update(id=rid, name=name,
                  created_at=datetime.now().isoformat(timespec="seconds"),
                  elapsed_seconds=round(time.time() - t0, 1))
    out = reports.write_report(report, tables)
    say(f"Report saved → {out}")
    return rid


# Backtest windows for the comparison: the holdout's dates and the full range. `end` is the
# last day of 2024 so the final yearly period is complete and no 2025+ data is read.
BT_RANGES = (("holdout", "2015-01-01", "2024-12-31"), ("full", "2003-01-01", "2024-12-31"))


def _backtests(specs: list[dict[str, Any]], d, say: Say) -> list[dict[str, Any]]:
    from core.backend.backtest.run import save_result
    from core.backend.db.engine import session_scope
    out = []
    for spec in specs:
        for label, start, end in BT_RANGES:
            for kind in ("portfolio", "cohort"):
                t0 = time.time()
                p = harness.Params(screen=spec["id"], kind=kind, start=start, end=end,
                                   rebalance_months=12, hold_months=24 if kind == "cohort"
                                   else 12)
                say(f"Backtest {spec['id']} {kind} {start}→{end}")
                with session_scope() as s:
                    res = harness.run(s, p, lambda m: None, prebuilt=d)
                name = f"{spec['id']} {kind} {start[:4]}-{end[:4]}"
                rid, _ = save_result(res, spec, name, t0)
                sm = res.summary
                say(f"  → {rid}: " + (
                    f"CAGR {sm.get('cagr') or 0:.1%} (SPY {sm.get('bench_cagr') or 0:.1%}, "
                    f"universe {sm.get('universe_cagr') or 0:.1%}) maxDD "
                    f"{sm.get('max_drawdown') or 0:.1%}" if kind == "portfolio" else
                    f"mean {sm.get('mean_return') or 0:.1%} median "
                    f"{sm.get('median_return') or 0:.1%} (universe median "
                    f"{sm.get('universe_median_return') or 0:.1%})"))
                out.append({"screen": spec["id"], "range": label, "kind": kind,
                            "start": start, "end": end, "report_id": rid,
                            "summary": sm,
                            "serious_warnings": sum(w["level"] == "warn"
                                                    for w in res.warnings)})
    return out
