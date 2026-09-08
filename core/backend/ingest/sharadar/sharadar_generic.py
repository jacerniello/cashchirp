"""Generic, schema-driven Sharadar table loader (full backfill + incremental sync).

For wide tables (SF1 has ~112 columns) hand-typing an ORM model is impractical.
This reads each table's column types and primary key from Sharadar's own
SHARADAR/INDICATORS metadata, creates a matching Postgres table, and upserts rows
through one COPY-into-staging path — with stage/byte progress so long loads are
observable. Two entry points:

- `load_table()` — full backfill from the bulk export (one zipped CSV).
- `sync_table()` — incremental: pull only rows with `<sync_col> >= watermark`
  via the query API and upsert. The watermark comes from `sync_state` (or, first
  time, from the max `<sync_col>` already in the table — so an existing backfill
  can sync without a full re-download). `sync_col` defaults to `lastupdated`, but
  any date column works (`--sync-col date|filingdate|calendardate`), so tables
  Sharadar ships without a `lastupdated` (ACTIONS, SP500, EVENTS, SF2, SF3A/B)
  can still sync on new rows. Caveat: keying on a plain date column catches only
  *new* rows, not retroactive edits to existing ones — fine for append-only
  event/filing tables, but use `lastupdated` when it exists to catch revisions.

  High-churn tables (SEP/SFP restamp `lastupdated` on price adjustments) can blow
  the query API's ~1M-row per-call cap for a multi-day window. The fetch adaptively
  splits `[since, today]` by date and halves on a cap error, so the sync just works.

Tables are created here (CREATE TABLE IF NOT EXISTS), not via the ORM models.
"""
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

import nasdaqdatalink as ndl
import pandas as pd
from nasdaqdatalink.errors.data_link_error import LimitExceededError
from sqlalchemy import text

from core.backend.db.engine import engine
from core.backend.ingest.sharadar.sharadar import DEFAULT_DEST, export_table
from core.backend.queries.meta.load_log import record_load
from core.config import settings

# unittype (from INDICATORS) -> Postgres type
_NUMERIC_UNITS = {
    "currency", "ratio", "USD millions", "USD/share", "numeric", "units",
    "USD", "currency/share", "percent", "%",
}
_DATE_RE = r"'^\d{4}-\d{2}-\d{2}$'"  # single backslash -> Postgres \d (digit)


# Columns Sharadar's metadata types as "date" but which actually hold non-date
# strings (e.g. SF1.fiscalperiod = "2009-Q4"). Force these to text so they're
# preserved verbatim instead of being nulled by the date-cast guard.
TEXT_OVERRIDE = {"fiscalperiod"}


def _pgtype(unittype: str | None) -> str:
    u = (unittype or "").strip()
    if u.startswith("date"):
        return "date"
    if u in _NUMERIC_UNITS:
        return "double precision"
    return "text"  # text, Y/N, N/A, unknown -> text (no truncation risk)


def _progress(fn, table_code, msg):
    if fn:
        fn(f"[{datetime.now():%H:%M:%S}] {table_code}: {msg}")


def fetch_schema(table_code: str) -> tuple[dict[str, str], list[str]]:
    """Return ({column: pgtype}, [primary_key_columns]) from INDICATORS."""
    ndl.ApiConfig.api_key = settings.nasdaq_data_link_api_key
    ind = ndl.get_table("SHARADAR/INDICATORS", paginate=True)
    sub = ind[ind["table"].astype(str).str.upper() == table_code.upper()]
    types = {r.indicator: _pgtype(r.unittype) for r in sub.itertuples()}
    for c in TEXT_OVERRIDE:
        if c in types:
            types[c] = "text"
    pk = sub[sub["isprimarykey"] == "Y"]["indicator"].tolist()
    return types, pk


def _build_sql(header, types, pk, dest):
    """Build (ddl, dml, stage_defs, stage_cols, has_lastupdated) for a table."""
    col_defs = ",\n  ".join(f'"{c}" {types.get(c, "text")}' for c in header)
    ddl = f'CREATE TABLE IF NOT EXISTS {dest} (\n  id bigserial PRIMARY KEY,\n  {col_defs}'
    pk = [c for c in pk if c in header]
    if pk:
        pk_cols = ", ".join(f'"{c}"' for c in pk)
        ddl += f",\n  CONSTRAINT uq_{dest} UNIQUE ({pk_cols})"
    ddl += "\n);"

    # value-guarded casts: a value that doesn't match its type -> NULL, never a failed load
    def cast(c: str) -> str:
        base = f"NULLIF(st.\"{c}\", '')"
        t = types.get(c, "text")
        if t == "date":
            return f"(CASE WHEN {base} ~ {_DATE_RE} THEN {base}::date END)"
        if t == "double precision":
            return (
                f"(CASE WHEN {base} ~ '^-?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' "
                f"THEN {base}::double precision END)"
            )
        return base

    insert_cols = ", ".join(f'"{c}"' for c in header)
    selects = ", ".join(cast(c) for c in header)
    if pk:
        key_exprs = ", ".join(cast(c) for c in pk)
        updates = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in header if c not in pk)
        dml = (
            f"INSERT INTO {dest} ({insert_cols})\n"
            f"SELECT DISTINCT ON ({key_exprs}) {selects}\n"
            f"FROM _stage st\nORDER BY {key_exprs}\n"
            f"ON CONFLICT ON CONSTRAINT uq_{dest} DO UPDATE SET {updates};"
        )
    else:
        dml = f"INSERT INTO {dest} ({insert_cols}) SELECT {selects} FROM _stage st;"

    stage_defs = ", ".join(f'"{c}" text' for c in header)
    stage_cols = ", ".join(f'"{c}"' for c in header)
    return ddl, dml, stage_defs, stage_cols, ("lastupdated" in header)


# Below this, a buffered COPY is written in one call: it finishes faster than a
# progress line would be read, and chunking it would only add noise.
_BUFFER_PROGRESS_MIN = 64 * 1024 * 1024


def _run(cur, table_code, dest, header, types, pk, copy_writer, progress):
    """Create table + staging, COPY via copy_writer, upsert. Returns
    (staged_rows, dest_total, watermark|None)."""
    # Big loads do a DISTINCT ON sort + unique-index build over tens of millions of
    # rows; the default 4MB work_mem spills to disk and crawls. Bump for this session.
    cur.execute("SET work_mem = '1GB';")
    cur.execute("SET maintenance_work_mem = '1GB';")
    ddl, dml, stage_defs, stage_cols, has_lu = _build_sql(header, types, pk, dest)
    cur.execute(ddl)
    cur.execute(f"CREATE TEMP TABLE _stage ({stage_defs}) ON COMMIT DROP;")
    _progress(progress, table_code, "COPY -> staging ...")
    copy_sql = f"COPY _stage ({stage_cols}) FROM STDIN WITH (FORMAT csv, HEADER true)"
    with cur.copy(copy_sql) as copy:
        copy_writer(copy)
    cur.execute("SELECT count(*) FROM _stage;")
    staged = cur.fetchone()[0]
    _progress(progress, table_code, f"staged {staged:,} rows; upserting into {dest} ...")
    cur.execute(dml)
    cur.execute(f"SELECT count(*) FROM {dest};")
    total = cur.fetchone()[0]
    watermark = None
    if has_lu:
        cur.execute(
            f"SELECT max(CASE WHEN lastupdated ~ {_DATE_RE} THEN lastupdated::date END) "
            f"FROM _stage;"
        )
        watermark = cur.fetchone()[0]
    return staged, total, watermark


_SYNC_STATE_UPSERT = """
INSERT INTO sync_state (table_name, last_updated_date, last_run, rows_loaded)
VALUES (%s, %s, now(), %s)
ON CONFLICT (table_name) DO UPDATE SET
    last_updated_date = EXCLUDED.last_updated_date,
    last_run = EXCLUDED.last_run,
    rows_loaded = EXCLUDED.rows_loaded;
"""


def _get_watermark(dataset: str, dest: str, sync_col: str = "lastupdated") -> date | None:
    """Watermark from sync_state, falling back to max(`sync_col`) in the table
    (so an already-backfilled table can sync without a full re-download)."""
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(
            "SELECT last_updated_date FROM sync_state WHERE table_name = %s;", (dataset,)
        )
        row = cur.fetchone()
        if row and row[0]:
            return row[0]
        cur.execute("SELECT to_regclass(%s);", (dest,))
        if cur.fetchone()[0] is None:
            return None
        try:
            cur.execute(f'SELECT max("{sync_col}") FROM {dest};')
            return cur.fetchone()[0]
        except Exception:
            raw.rollback()
            return None
    finally:
        raw.close()


def _fetch_window(table_code: str, sync_col: str, lo: date, hi: date, progress,
                  chunk_key: str | None = None) -> pd.DataFrame | None:
    """Pull rows with lo <= `sync_col` <= hi via the query API, adaptively
    splitting the date range when a single call trips the API's volume cap.

    A single date value that alone exceeds the cap can't be date-windowed. If
    `chunk_key` is given, that day is instead pulled in recursive key-chunks
    (e.g. SFP restamps >1M rows on one `lastupdated` day → chunk it by ticker);
    otherwise it's surfaced as a clear error rather than looping forever."""
    flt = {sync_col: {"gte": lo.isoformat(), "lte": hi.isoformat()}}
    try:
        return ndl.get_table(f"SHARADAR/{table_code.upper()}", paginate=True, **flt)
    except LimitExceededError:
        if lo >= hi:
            if chunk_key:
                _progress(progress, table_code,
                          f"single {sync_col}={lo} over cap — chunking by {chunk_key}")
                return _fetch_keyed(table_code, flt, chunk_key, None, None, progress)
            raise RuntimeError(
                f"{table_code}: a single {sync_col}={lo} exceeds the query-API cap and "
                f"can't be date-windowed — pass chunk_key=<col> to sub-chunk it, or use a "
                f"full backfill (sharadar_load_generic {table_code})."
            )
        mid = lo + (hi - lo) // 2
        _progress(progress, table_code, f"cap hit on {sync_col} [{lo}..{hi}] — splitting at {mid}")
        a = _fetch_window(table_code, sync_col, lo, mid, progress, chunk_key)
        b = _fetch_window(table_code, sync_col, mid + timedelta(days=1), hi, progress, chunk_key)
        frames = [f for f in (a, b) if f is not None and not f.empty]
        if not frames:
            return a if a is not None else b
        return pd.concat(frames, ignore_index=True)


# Cut points for the key-range chunker. Tickers/investor names are upper-case
# alphanumerics; this is only a set of *split boundaries*, not a value whitelist —
# intervals compare by string order, so values containing other characters
# (".", "-") still land in whichever range bounds them. No vendor mapping here.
_KEY_CHUNK_ALPHABET = tuple("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def _split_points(lo: str | None, hi: str | None) -> list[str]:
    """Gap-free interval cut points strictly inside (lo, hi): deepen by appending
    one alphabet char to `lo`. With bounds [lo]+cuts+[hi] the sub-intervals tile
    the whole [lo, hi) range with no gaps."""
    base = lo or ""
    return [base + ch for ch in _KEY_CHUNK_ALPHABET
            if (lo is None or base + ch > lo) and (hi is None or base + ch < hi)]


def _fetch_keyed(table_code: str, fixed: dict, key_col: str,
                 lo: str | None, hi: str | None, progress) -> pd.DataFrame | None:
    """Pull rows matching `fixed` with lo <= `key_col` < hi, recursively splitting
    the key range when a call trips the API's volume cap. For tables with no
    row-level change column (no lastupdated/filingdate), this is how a whole
    quarter is pulled under the cap. A single key value that alone exceeds the cap
    can't be split — surface that clearly rather than looping forever."""
    bound: dict[str, str] = {}
    if lo is not None:
        bound["gte"] = lo
    if hi is not None:
        bound["lt"] = hi
    flt = dict(fixed)
    if bound:
        flt[key_col] = bound
    try:
        return ndl.get_table(f"SHARADAR/{table_code.upper()}", paginate=True, **flt)
    except LimitExceededError:
        cuts = _split_points(lo, hi)
        if not cuts:
            raise RuntimeError(
                f"{table_code}: a single {key_col} value in [{lo}..{hi}] exceeds the "
                f"query-API cap and can't be split further — use a full backfill."
            )
        rng = f"[{lo or '-'}..{hi or '-'}]"
        _progress(progress, table_code, f"cap on {key_col} {rng} — splitting into {len(cuts) + 1}")
        bounds = [lo, *cuts, hi]
        frames = []
        for a, b in zip(bounds[:-1], bounds[1:]):
            f = _fetch_keyed(table_code, fixed, key_col, a, b, progress)
            if f is not None and not f.empty:
                frames.append(f)
        return pd.concat(frames, ignore_index=True) if frames else None


_QUARTER_ENDS = ((3, 31), (6, 30), (9, 30), (12, 31))


def _recent_quarter_ends(n: int, today: date | None = None,
                         since: date | None = None) -> list[date]:
    """Most recent `n` quarter-end dates <= today (calendar-derived, so a brand-new
    quarter is picked up before any row for it exists locally). With `since`, return
    every quarter-end in [since, today] instead."""
    today = today or date.today()
    cands = [date(y, m, d)
             for y in range(today.year - 1, today.year + 2)
             for m, d in _QUARTER_ENDS]
    past = sorted(d for d in cands if d <= today and (since is None or d >= since))
    return past if since is not None else past[-n:]


def _enrich_after_load(table_code, dest, header, progress, skip_derived=False):
    """Stamp permaticker on the loaded table so analysis never keys on ticker.
    Best-effort: never fails the load. `skip_derived` suppresses the
    screener/holder rebuild hooks — set by an orchestrator that rebuilds all
    derived objects itself once, after every input table is fresh."""
    try:
        from core.backend.ingest.permaticker import PRODUCT, enrich_table, rebuild_lookup
        if table_code.upper() == "TICKERS":
            rebuild_lookup()  # tickers IS the source of permaticker — refresh lookup, don't self-enrich
        elif dest in PRODUCT and any(c.lower() == "ticker" for c in header):
            # only stamp new/unstamped rows so an incremental --sync stays fast
            total, has = enrich_table(dest, only_null=True)
            _progress(progress, table_code, f"permaticker: {has:,}/{total:,} rows")
    except Exception as exc:
        _progress(progress, table_code, f"permaticker enrich skipped: {exc}")
    # Standalone `date` index — the per-table uniques lead with `ticker`, so
    # cross-sectional "latest row across all securities" scans (the screener) have no
    # usable index on date without this. Cheap to keep; powers fast as-of queries.
    try:
        if any(c.lower() == "date" for c in header):
            with engine.connect() as conn:
                conn.execution_options(isolation_level="AUTOCOMMIT").execute(
                    text(f"CREATE INDEX IF NOT EXISTS ix_{dest}_date ON {dest} (date)")
                )
    except Exception as exc:
        _progress(progress, table_code, f"date index skipped: {exc}")
    # Keep the precomputed Screener snapshot current. Its freshness keys on max(daily.date),
    # so rebuild it whenever DAILY advances (best-effort; never fails the load).
    if dest == "daily" and not skip_derived:
        try:
            from core.backend.db.engine import session_scope
            from core.backend.queries.discovery.screener import refresh_snapshot
            with session_scope() as s:
                n = refresh_snapshot(s)
            _progress(progress, table_code, f"screener_snapshot refreshed: {n:,} rows")
        except Exception as exc:
            _progress(progress, table_code, f"screener snapshot skipped: {exc}")
    # S&P 500 concentration/sector-weight series keys on the membership log, so
    # rebuild it whenever SP500 advances (best-effort; it also reads daily caps,
    # which the DAILY load above refreshes earlier in the same run).
    if dest == "sp500" and not skip_derived:
        try:
            from core.backend.db.engine import session_scope
            from core.backend.queries.market.sp500 import refresh_concentration
            with session_scope() as s:
                n = refresh_concentration(s)
            _progress(progress, table_code, f"sp500_concentration refreshed: {n:,} dates")
        except Exception as exc:
            _progress(progress, table_code, f"sp500_concentration refresh skipped: {exc}")
        # The counterfactual index-lab panel also keys on the membership log (and the
        # SEP/DAILY caps refreshed earlier in the run); rebuild it when SP500 advances.
    # Same idea for the holdings bubble chart: the per-holder time series keys on
    # 13F quarters, so rebuild it whenever SF3 advances (best-effort).
    if dest == "sf3" and not skip_derived:
        try:
            from core.backend.db.engine import session_scope
            from core.backend.queries.ownership.institutional import refresh_holder_timeseries
            with session_scope() as s:
                n = refresh_holder_timeseries(s)
            _progress(progress, table_code, f"holder_timeseries refreshed: {n:,} rows")
        except Exception as exc:
            _progress(progress, table_code, f"holder_timeseries refresh skipped: {exc}")
        # The per-investor transpose (Institution page's holdings bubble chart) keys on
        # the same 13F quarters, so rebuild it whenever SF3 advances too (best-effort).
        try:
            from core.backend.db.engine import session_scope
            from core.backend.queries.ownership.institutional import refresh_investor_holdings_timeseries
            with session_scope() as s:
                n = refresh_investor_holdings_timeseries(s)
            _progress(progress, table_code,
                      f"institutional_holdings_timeseries refreshed: {n:,} rows")
        except Exception as exc:
            _progress(progress, table_code,
                      f"institutional_holdings_timeseries refresh skipped: {exc}")


def load_table(
    table_code: str,
    dest_table: str | None = None,
    zip_path: Path | None = None,
    download: bool = True,
    skip_derived: bool = False,
    keep_download: bool = False,
    progress=print,
) -> dict:
    """Full backfill from the bulk export. Returns {"rows", "total", "watermark"}.

    The downloaded zip is deleted once the rows are in (`keep_download=True` retains it).
    Nothing needs it afterwards: the routine refresh is `sync_table`, which pulls deltas
    over the query API and never opens a zip, and a full reload re-downloads anyway
    (`download` defaults to True). Keeping them meant ~25 GB of files beside a 47 GB
    database earning nothing.

    It is deliberately kept when the load RAISES, so a failed multi-GB backfill can be
    retried with `download=False` instead of pulling SEP's 941 MB again. A zip passed in
    as `zip_path` is never deleted — it belongs to the caller, not to us."""
    dest = dest_table or table_code.lower()
    dataset = f"SHARADAR/{table_code.upper()}"
    requested_at = datetime.now()

    types, pk = fetch_schema(table_code)
    _progress(progress, table_code, f"schema: {len(types)} cols, pk={pk}")

    path = zip_path or (DEFAULT_DEST / f"{table_code.upper()}.zip")
    if download or not path.exists():
        _progress(progress, table_code, "downloading bulk export...")
        path = export_table(table_code.upper(), DEFAULT_DEST)
    zf = zipfile.ZipFile(path)
    csv_name = zf.namelist()[0]
    # A zip's central directory records each entry's UNCOMPRESSED size, so the size of
    # the COPY is known exactly before a byte of it is written. Report it: the compressed
    # size is not a usable stand-in — SF1 is 661 MB zipped and 2,415 MB on the wire, a
    # 3.7x difference — and progress measured against the wrong one runs off the end.
    total_bytes = zf.getinfo(csv_name).file_size
    _progress(progress, table_code,
              f"zip ready ({path.stat().st_size / 1e6:.0f} MB compressed, "
              f"{total_bytes / 1e6:.0f} MB to copy)")

    with zf.open(csv_name) as fh:
        header = [c.strip() for c in fh.readline().decode().strip().split(",")]

    def writer(copy):
        copied, mark = 0, 200 * 1024 * 1024
        with zf.open(csv_name) as fh:
            while chunk := fh.read(1 << 20):
                copy.write(chunk)
                copied += len(chunk)
                if copied >= mark:
                    # "done/total" is the form the progress reader understands as a real
                    # ratio, so this drives the percentage without it having to guess.
                    _progress(progress, table_code,
                              f"COPY {copied / 1e6:.0f}/{total_bytes / 1e6:.0f} MB ...")
                    mark += 200 * 1024 * 1024

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        staged, total, watermark = _run(cur, table_code, dest, header, types, pk, writer, progress)
        if watermark is not None:
            cur.execute(_SYNC_STATE_UPSERT, (dataset, watermark, staged))
        raw.commit()
    finally:
        raw.close()

    # Only after the rows are committed, and only if we downloaded it ourselves.
    zf.close()
    if not keep_download and zip_path is None:
        try:
            size = path.stat().st_size
            path.unlink()
            _progress(progress, table_code, f"removed {path.name} ({size / 1e6:.0f} MB)")
        except OSError as exc:
            _progress(progress, table_code, f"could not remove {path.name}: {exc}")

    _progress(progress, table_code, f"DONE — staged {staged:,}; {dest} now {total:,}")
    _enrich_after_load(table_code, dest, header, progress, skip_derived=skip_derived)
    record_load(
        source="SHARADAR", dataset=dataset, operation="backfill", rows=staged,
        requested_at=requested_at, detail=f"{dest} now {total}",
    )
    return {"rows": staged, "total": total, "watermark": watermark}


def _buffer_writer(csv_bytes: bytes, table_code: str, progress):
    """COPY an in-memory buffer, reporting progress against its known length.

    The incremental paths build the whole payload in memory before writing it, so unlike
    the API fetch that produced it this phase has an exact denominator — `len(csv_bytes)`.
    The write is chunked purely so there is something to report between "not started" and
    "done": a single `write()` is atomic from the caller's point of view, so a large
    payload would sit silent and look stalled.

    Small payloads are written in one go. A routine sync is a few MB and finishes before
    a progress line would be read, so chunking it only adds noise.
    """
    total = len(csv_bytes)
    step = 1 << 20

    def writer(copy):
        if total <= _BUFFER_PROGRESS_MIN:
            copy.write(csv_bytes)
            return
        # memoryview so slicing does not copy the payload a second time.
        mv = memoryview(csv_bytes)
        every = max(total // 10, step)   # ~10 updates, whatever the size
        sent, mark = 0, every
        while sent < total:
            copy.write(mv[sent:sent + step])
            sent += step
            if sent >= mark:
                _progress(progress, table_code,
                          f"COPY {min(sent, total) / 1e6:.0f}/{total / 1e6:.0f} MB ...")
                mark += every

    return writer


def sync_table(
    table_code: str,
    dest_table: str | None = None,
    since: date | None = None,
    lookback_days: int = 1,
    sync_col: str = "lastupdated",
    chunk_key: str | None = None,
    skip_derived: bool = False,
    progress=print,
) -> dict:
    """Incremental update: upsert rows with `sync_col >= watermark`.

    `sync_col` defaults to `lastupdated`; pass a date column (date/filingdate/
    calendardate) for tables Sharadar ships without one. `chunk_key` sub-chunks any
    single `sync_col` day that alone exceeds the API cap (SFP restamps >1M rows per
    `lastupdated` day → `chunk_key="ticker"` makes it incremental instead of a full
    reload). Falls back to a full backfill if the table has never been loaded.
    Returns {"rows", "total", "watermark", "since"}.
    """
    dest = dest_table or table_code.lower()
    dataset = f"SHARADAR/{table_code.upper()}"
    requested_at = datetime.now()

    types, pk = fetch_schema(table_code)

    # Decide WHETHER to sync before validating what we would sync ON. An empty table has
    # no watermark and takes the full-backfill path, which reads the bulk export and never
    # looks at `sync_col` — so a table whose sync column is wrong or renamed can still be
    # loaded from zero. Validating first turned that recoverable case into a hard failure:
    # SF3A/SF3B refused to load at all on a fresh database because Sharadar renamed their
    # `calendardate` to `date`, when a full backfill would have worked and was what an
    # empty table needed anyway. `_get_watermark` already tolerates a missing table and an
    # unknown column, returning None for both, so it is safe to ask first.
    watermark = since or _get_watermark(dataset, dest, sync_col)
    if watermark is None:
        _progress(progress, table_code, "no watermark / table empty — full backfill")
        return load_table(table_code, dest_table=dest, progress=progress)

    # Past here an incremental sync really is what is happening, so the column has to work.
    if sync_col not in types:
        date_cols = sorted(c for c, t in types.items() if t == "date")
        raise RuntimeError(
            f"{table_code} has no `{sync_col}` column — incremental sync not "
            f"supported on it. Available date columns: {date_cols or 'none'}. "
            f"Pass one via --sync-col, or use a full load (sharadar_load_generic {table_code})."
        )
    if types[sync_col] != "date":
        raise RuntimeError(f"{table_code}.{sync_col} is not a date column — can't be a watermark.")

    start = watermark - timedelta(days=lookback_days)
    _progress(progress, table_code, f"querying {sync_col} >= {start} ...")
    ndl.ApiConfig.api_key = settings.nasdaq_data_link_api_key
    df = _fetch_window(table_code, sync_col, start, date.today(), progress, chunk_key)

    if df is None or df.empty:
        raw = engine.raw_connection()
        try:
            cur = raw.cursor()
            cur.execute(_SYNC_STATE_UPSERT, (dataset, watermark, 0))
            raw.commit()
        finally:
            raw.close()
        _progress(progress, table_code, f"no changes since {start}")
        record_load(
            source="SHARADAR", dataset=dataset, operation="sync", rows=0,
            requested_at=requested_at, detail=f"no changes since {start}",
        )
        return {"rows": 0, "total": None, "watermark": watermark, "since": start}

    # Normalize date columns so they cast cleanly from CSV text.
    df = df.copy()
    for c in df.columns:
        if types.get(c) == "date":
            df[c] = pd.to_datetime(df[c], errors="coerce").dt.date
    header = list(df.columns)
    csv_bytes = df.to_csv(index=False).encode()

    # New watermark = max sync_col value actually pulled (works for any sync_col,
    # not just lastupdated which is all _run knows how to derive).
    col_max = pd.to_datetime(df[sync_col], errors="coerce").max()
    new_wm = col_max.date() if pd.notna(col_max) else watermark

    writer = _buffer_writer(csv_bytes, table_code, progress)

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        staged, total, _ = _run(cur, table_code, dest, header, types, pk, writer, progress)
        cur.execute(_SYNC_STATE_UPSERT, (dataset, new_wm, staged))
        raw.commit()
    finally:
        raw.close()

    _progress(progress, table_code, f"DONE — upserted {staged:,}; {dest} now {total:,}")
    _enrich_after_load(table_code, dest, header, progress, skip_derived=skip_derived)
    record_load(
        source="SHARADAR", dataset=dataset, operation="sync", rows=staged,
        requested_at=requested_at, detail=f"since {start}; watermark={new_wm}",
    )
    return {"rows": staged, "total": total, "watermark": new_wm, "since": start}


def sync_coarse_table(
    table_code: str,
    dest_table: str | None = None,
    quarter_col: str = "calendardate",
    chunk_key: str = "ticker",
    quarters: int = 2,
    since: date | None = None,
    skip_derived: bool = False,
    progress=print,
) -> dict:
    """Refresh a table that has no row-level change column (no `lastupdated`/
    `filingdate`) by re-pulling its most recent `quarters` `quarter_col` values,
    each fetched in cap-sized chunks split recursively on `chunk_key`.

    Because the whole quarter is pulled, each refreshed quarter is **replaced
    wholesale** (delete-then-insert, atomic per quarter): the mirror ends an exact
    1:1 of the source for that quarter, capturing additions, amendments AND
    deletions (positions dropped by a later 13F amendment). A plain upsert would
    leave those deleted rows behind as a stale tail — the delete avoids that. The
    delete only runs if the chunked fetch returned a complete quarter (a partial
    fetch raises before any DB write), so it can't truncate on a half-pull.

    SF3 (13F holdings) is the motivating case: its only date is `calendardate`,
    one value per quarter (~2.4M rows), past the query cap and impossible to
    date-window. NOTE only the refreshed quarters are made exact — amendments to
    *older* quarters are missed (no `lastupdated` to detect them); for those, a
    full backfill (into a fresh table) is the only complete option.
    """
    dest = dest_table or table_code.lower()
    dataset = f"SHARADAR/{table_code.upper()}"
    requested_at = datetime.now()

    types, pk = fetch_schema(table_code)

    # Same ordering point as sync_table, and the same reason — but this path had no
    # empty-table branch at all. On a fresh database it went straight to re-pulling the
    # last couple of quarters, which is not a backfill: it would leave the table holding
    # two quarters and call that done. The docstring above already says a full backfill is
    # the only complete option for a fresh table; this is that sentence in code.
    if _get_watermark(dataset, dest, quarter_col) is None:
        _progress(progress, table_code, "table empty — full backfill")
        return load_table(table_code, dest_table=dest, skip_derived=skip_derived,
                          progress=progress)

    for col in (quarter_col, chunk_key):
        if col not in types:
            raise RuntimeError(f"{table_code} has no `{col}` column — can't coarse-sync on it.")

    ndl.ApiConfig.api_key = settings.nasdaq_data_link_api_key
    qs = _recent_quarter_ends(quarters, since=since)
    if not qs:
        _progress(progress, table_code, "no quarter-ends in range — nothing to refresh")
        return {"rows": 0, "total": None, "watermark": None, "quarters": []}
    _progress(progress, table_code,
              f"refreshing {quarter_col} {[q.isoformat() for q in qs]} via {chunk_key}-chunks")

    total_staged, dest_total, header = 0, None, None
    for q in qs:
        _progress(progress, table_code, f"== quarter {q} ==")
        df = _fetch_keyed(table_code, {quarter_col: q.isoformat()}, chunk_key, None, None, progress)
        if df is None or df.empty:
            _progress(progress, table_code, f"{q}: no rows (quarter not filed yet?)")
            continue
        df = df.copy()
        for c in df.columns:
            if types.get(c) == "date":
                df[c] = pd.to_datetime(df[c], errors="coerce").dt.date
        header = list(df.columns)
        csv_bytes = df.to_csv(index=False).encode()

        writer = _buffer_writer(csv_bytes, table_code, progress)

        raw = engine.raw_connection()
        try:
            cur = raw.cursor()
            # Replace the quarter atomically: clear it, then insert the complete
            # re-pull. Same transaction as _run's COPY+insert, so a failure rolls
            # back the delete too — the quarter is never left truncated.
            cur.execute(f'DELETE FROM {dest} WHERE "{quarter_col}" = %s', (q.isoformat(),))
            deleted = cur.rowcount
            staged, dest_total, _ = _run(cur, table_code, dest, header, types, pk, writer, progress)
            raw.commit()
        finally:
            raw.close()
        total_staged += staged
        _progress(progress, table_code,
                  f"{q}: replaced {deleted:,} -> {staged:,}; {dest} now {dest_total:,}")

    new_wm = max(qs)
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(_SYNC_STATE_UPSERT, (dataset, new_wm, total_staged))
        raw.commit()
    finally:
        raw.close()

    if header is not None:
        _enrich_after_load(table_code, dest, header, progress, skip_derived=skip_derived)
    _progress(progress, table_code, f"DONE — upserted {total_staged:,} across {len(qs)} quarter(s)")
    record_load(
        source="SHARADAR", dataset=dataset, operation="sync", rows=total_staged,
        requested_at=requested_at,
        detail=f"coarse {quarter_col} {[q.isoformat() for q in qs]} via {chunk_key}",
    )
    return {"rows": total_staged, "total": dest_total, "watermark": new_wm, "quarters": qs}
