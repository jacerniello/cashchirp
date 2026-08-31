"""One-command refresh of the whole dataset: every Sharadar table in its correct
sync mode → FRED panels → FINRA short interest → the derived objects, in dependency order.

    python -m core.scripts.load.update_all                 # everything
    python -m core.scripts.load.update_all --dry-run       # print the plan, run nothing
    python -m core.scripts.load.update_all --only SEP SF1  # subset of Sharadar tables
    python -m core.scripts.load.update_all --no-fred --no-derived
    python -m core.scripts.load.update_all --no-sharadar --derived-only   # just rebuild derived

Why a plan instead of "sync every table the same way": Sharadar tables differ in
*what change-column they expose*, and the query API caps ~1M rows/call, so each table
needs a specific mode (see docs/reference/schema.md → "Updating"). This encodes that mapping once:

  - lastupdated delta (`sync`)                : tickers, sf1, metrics, daily, sep
  - lastupdated delta + ticker-chunk (`sync`) : sfp  — restamps >1M rows/day; chunk that day
  - date-column delta (`sync` + sync_col)     : actions/sp500/events (date), sf2 (filingdate),
                                                sf3a/sf3b (calendardate)
  - quarter re-pull, key-chunked (`quarters`) : sf3  — no change column at all

No table does a full re-download on a routine run; the heaviest re-pulls are sfp's
restamped day(s) (~1-3M rows) and sf3's two open quarters (~4.7M).

Derived objects (screener_snapshot, holder_timeseries, institutional_holdings_timeseries,
derived.insider[_company], sp500_concentration[+sector_weights], sp500_member_months) are
rebuilt **once at the end**, after every input is fresh —
so the per-load hooks in the loader are suppressed (`skip_derived=True`) to avoid
rebuilding the 33M-row holder/institutional time-series tables twice. insiders has no
loader hook, so this and `build_insiders` are the only paths that refresh it.

Each step is isolated: a failure is logged and the run continues; the process exits
non-zero if anything failed, so a cron/launchd wrapper can alert.
"""
import argparse
import contextlib
import time
from datetime import datetime

from core.backend import sources

# The load plan lives in the data-source registry (core.backend.sources), which is also
# what bootstrap builds from and what docs/setup/sources.md is generated from — so the
# routine refresh, the from-zero build and the published provenance are the same list by
# construction. TICKERS is first there: it rebuilds permaticker_lookup, which the other
# tables' permaticker stamping reads.
SHARADAR_PLAN: list[tuple[str, str, dict]] = sources.sharadar_plan()


def _stamp(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


@contextlib.contextmanager
def _suppress_app_rebuilds():
    """Hold every derived-rebuild advisory lock for the duration of the ingest, so the
    web app can't rebuild a derived table *while we mutate its source tables*.

    The convoy this prevents: a screener/holder page view sees the as-of date jump the
    instant we load DAILY, so it fires `refresh_snapshot`, whose multi-minute
    `build_snapshot` holds `AccessShareLock` on daily/sf1/sep/… for the whole build —
    right when our next Sharadar step wants `ALTER TABLE … ADD COLUMN permaticker`
    (`AccessExclusiveLock`). The ALTER queues behind the build and every later reader
    queues behind the ALTER → the whole DB stalls for minutes.

    Each app rebuild path is `with single_flight(LOCK): if not mine: return <live table>`,
    so once we hold the lock the app cheaply serves the existing table instead of
    building. Best-effort: a lock the app is *already* holding (mid-rebuild) we just skip
    — the common case is nothing rebuilding when the orchestrator starts. Released on
    exit, before our own derived phase rebuilds (which need these same locks)."""
    from sqlalchemy import text

    from core.backend.db.engine import engine
    from core.backend.queries import _rebuild

    keys = [v for k, v in vars(_rebuild).items() if k.startswith("LOCK_")]
    conn = engine.connect()
    got = []
    for k in keys:
        if conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": k}).scalar():
            got.append(k)
    if len(got) < len(keys):
        _stamp(f"  (rebuild guard: held {len(got)}/{len(keys)} locks; "
               f"app may be mid-rebuild on the rest)")
    try:
        yield
    finally:
        for k in got:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": k})
        conn.close()


def _run_sharadar(only: list[str] | None) -> list[tuple[str, str, float]]:
    """Run the Sharadar plan; return [(step, status, seconds)]. Derived hooks are
    suppressed — the orchestrator rebuilds derived itself, once, at the end."""
    from core.backend.ingest.sharadar.sharadar_generic import load_table, sync_coarse_table, sync_table

    results = []
    only_up = {t.upper() for t in only} if only else None
    for table, mode, kwargs in SHARADAR_PLAN:
        if only_up is not None and table not in only_up:
            continue
        t0 = time.time()
        try:
            if mode == "sync":
                sync_table(table, skip_derived=True, **kwargs)
            elif mode == "quarters":
                sync_coarse_table(table, skip_derived=True, **kwargs)
            elif mode == "full":
                load_table(table, skip_derived=True, **kwargs)
            else:
                raise ValueError(f"unknown mode {mode!r}")
            status = "ok"
        except Exception as exc:
            status = "FAIL"
            _stamp(f"  !! {table} ({mode}) failed: {type(exc).__name__}: {exc}")
        results.append((f"sharadar:{table}", status, time.time() - t0))
    return results


def _run_fred() -> list[tuple[str, str, float]]:
    results = []
    from core.backend.ingest.fred.fred_api import COMMODITY_SPOT_SERIES, ingest_fred_series
    from core.backend.ingest.fred.fred_md import FRED_MD_VINTAGES_URL, FRED_QD_VINTAGES_URL, ingest_fred_vintages

    for label, url, dataset in [
        ("FRED-MD vintages", FRED_MD_VINTAGES_URL, "FRED-MD"),
        ("FRED-QD vintages", FRED_QD_VINTAGES_URL, "FRED-QD"),
    ]:
        t0 = time.time()
        try:
            ingest_fred_vintages(url=url, dataset=dataset, full=False)  # incremental: skip loaded vintages
            status = "ok"
        except Exception as exc:
            status = "FAIL"
            _stamp(f"  !! {label} failed: {type(exc).__name__}: {exc}")
        results.append((f"fred:{dataset}", status, time.time() - t0))

    t0 = time.time()
    try:
        for sid in COMMODITY_SPOT_SERIES:
            ingest_fred_series(sid)
        status = "ok"
    except Exception as exc:
        status = "FAIL"
        _stamp(f"  !! FRED spot series failed: {type(exc).__name__}: {exc}")
    results.append(("fred:spot", status, time.time() - t0))
    return results


def _run_finra() -> list[tuple[str, str, float]]:
    """Incremental FINRA short-interest sync (new settlement dates since the watermark)."""
    from core.backend.ingest.finra import finra_short_interest as fsi

    t0 = time.time()
    try:
        fsi.sync_short_interest()
        status = "ok"
    except Exception as exc:
        status = "FAIL"
        _stamp(f"  !! FINRA short interest failed: {type(exc).__name__}: {exc}")
    return [("finra:short_interest", status, time.time() - t0)]


def _run_sec() -> list[tuple[str, str, float]]:
    """Refresh the SEC mutual-fund map (CIK → series → class → ticker) that powers the
    fund page's family navigation. Reference data; a full reload of one ~1 MB JSON."""
    from core.scripts.load.load_sec_fund_classes import load

    t0 = time.time()
    try:
        n = load()
        _stamp(f"  sec_fund_class: {n} rows")
        status = "ok"
    except Exception as exc:
        status = "FAIL"
        _stamp(f"  !! SEC fund classes failed: {type(exc).__name__}: {exc}")
    return [("sec:fund_classes", status, time.time() - t0)]


def _run_derived() -> list[tuple[str, str, float]]:
    """Rebuild the precomputed objects once, after inputs are fresh. Idempotent."""
    from core.backend.db.engine import session_scope
    from core.backend.queries.discovery import screener
    from core.backend.queries.market import index_lab, sp500
    from core.backend.queries.ownership import insiders, institutional

    steps = [
        ("screener_snapshot", lambda s: screener.refresh_snapshot(s)),
        ("holder_timeseries", lambda s: institutional.refresh_holder_timeseries(s)),
        ("institutional_holdings_timeseries",
         lambda s: institutional.refresh_investor_holdings_timeseries(s)),
        ("derived.insider", lambda s: insiders.refresh(s)),
        ("sp500_concentration", lambda s: sp500.refresh_concentration(s)),
        ("sp500_member_months", lambda s: index_lab.refresh_member_months(s)),
    ]
    results = []
    for name, fn in steps:
        t0 = time.time()
        try:
            with session_scope() as session:
                out = fn(session)
            _stamp(f"  {name}: {out}")
            status = "ok"
        except Exception as exc:
            status = "FAIL"
            _stamp(f"  !! {name} failed: {type(exc).__name__}: {exc}")
        results.append((f"derived:{name}", status, time.time() - t0))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh all data + derived objects.")
    parser.add_argument("--only", nargs="*", default=None,
                        help="Limit the Sharadar step to these table codes.")
    parser.add_argument("--no-sharadar", action="store_true", help="Skip Sharadar tables.")
    parser.add_argument("--no-fred", action="store_true", help="Skip FRED.")
    parser.add_argument("--no-finra", action="store_true", help="Skip FINRA short interest.")
    parser.add_argument("--no-sec", action="store_true", help="Skip the SEC fund-class map.")
    parser.add_argument("--no-derived", action="store_true", help="Skip derived rebuilds.")
    parser.add_argument("--derived-only", action="store_true",
                        help="Only rebuild derived (implies --no-sharadar --no-fred --no-finra --no-sec).")
    parser.add_argument("--dry-run", action="store_true", help="Print the plan and exit.")
    args = parser.parse_args()

    if args.derived_only:
        args.no_sharadar = args.no_fred = args.no_finra = args.no_sec = True

    if args.dry_run:
        print("Sharadar plan:" if not args.no_sharadar else "Sharadar: skipped")
        if not args.no_sharadar:
            for table, mode, kwargs in SHARADAR_PLAN:
                if args.only and table.upper() not in {t.upper() for t in args.only}:
                    continue
                print(f"  {table:8} {mode:9} {kwargs or ''}")
        print("FRED: " + ("skipped" if args.no_fred else "MD+QD vintages, commodity spot"))
        print("FINRA: " + ("skipped" if args.no_finra else "short interest (incremental)"))
        print("SEC: " + ("skipped" if args.no_sec else "fund-class map (company_tickers_mf.json)"))
        print("Derived: " + ("skipped" if args.no_derived else
                              "screener_snapshot, holder_timeseries, "
                              "institutional_holdings_timeseries, derived.insider, "
                              "sp500_concentration, sp500_member_months"))
        return 0

    started = time.time()
    _stamp("update_all: starting")
    results: list[tuple[str, str, float]] = []

    # Hold the derived-rebuild locks across every ingest phase so a concurrent app page
    # view can't kick off a source-table-locking rebuild that convoys our DDL. Released
    # before our own derived phase, which re-acquires them. No ingest → no guard needed
    # (and `--derived-only` must NOT hold them, or our rebuild would skip itself).
    runs_ingest = not (args.no_sharadar and args.no_fred and args.no_finra and args.no_sec)
    guard = _suppress_app_rebuilds() if runs_ingest else contextlib.nullcontext()
    with guard:
        if not args.no_sharadar:
            _stamp("== Sharadar tables ==")
            results += _run_sharadar(args.only)
        if not args.no_fred:
            _stamp("== FRED ==")
            results += _run_fred()
        if not args.no_finra:
            _stamp("== FINRA short interest ==")
            results += _run_finra()
        if not args.no_sec:
            _stamp("== SEC fund-class map ==")
            results += _run_sec()
    if not args.no_derived:
        _stamp("== derived ==")
        results += _run_derived()

    failed = [r for r in results if r[1] != "ok"]
    _stamp(f"update_all: done in {time.time() - started:.0f}s — "
           f"{len(results) - len(failed)}/{len(results)} ok")
    print(f"\n{'step':28} {'status':6} {'sec':>7}")
    print("-" * 44)
    for step, status, secs in results:
        print(f"{step:28} {status:6} {secs:>7.0f}")
    if failed:
        print(f"\n{len(failed)} step(s) FAILED: {', '.join(s for s, _, _ in failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
