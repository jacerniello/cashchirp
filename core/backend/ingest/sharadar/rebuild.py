"""Copy-and-swap rebuild of one Sharadar table from its full bulk export.

The incremental sync only sees rows whose sync column (usually `lastupdated`) is newer
than the watermark. It misses two kinds of upstream change:

- retroactive edits that did not move the sync column, and
- rows Sharadar DELETED, which an upsert can never remove.

A full re-download upserted onto the live table (`--full`) catches the first but not the
second, and rewrites tens of millions of live rows in place. This instead builds a fresh
copy next to the live table, checks it, measures what changed, and swaps it in:

1. download the bulk export;
2. load it into `<table>__rebuild` — same columns, permaticker stamped in the same pass
   (an UPDATE afterwards would rewrite every row a second time);
3. recreate the live table's indexes on the copy;
4. sanity-check: the copy must hold at least `min_ratio` of the live row count, and must
   not end earlier than the live table;
5. diff by key: rows added, removed, and changed (ignoring `lastupdated`);
6. swap in ONE short transaction — drop the live table, rename the copy into place,
   rename its sequence/constraints/indexes, recreate any views that depended on it, and
   set the watermark to what the copy actually holds.

Readers keep the live table for the whole build; only step 6 takes a lock, for seconds.
If anything fails before step 6 the live table is untouched, and the half-built copy is
dropped at the start of the next attempt.

Needs free disk of roughly the table's size again while both copies exist.
"""
from __future__ import annotations

import json
import re
import shutil
import time
import zipfile
from datetime import datetime
from typing import Any, Callable

from core.backend.db.engine import engine
from core.backend.ingest.sharadar.sharadar import DEFAULT_DEST, export_table
from core.backend.ingest.sharadar.sharadar_generic import (
    _SYNC_STATE_UPSERT,
    _build_sql,
    _stage_select,
    fetch_schema,
)
from core.backend.queries.meta.load_log import record_load
from core.config import PROJECT_ROOT

SUFFIX = "__rebuild"

# SF3 is not rebuildable here: its rows carry a denormalised investorname and a generated
# price column (see permaticker.denormalise_sf3), and its sync already replaces whole
# quarters. It needs its own path, not this generic one.
NOT_REBUILDABLE = {"SF3": "SF3 carries denormalised columns and is refreshed by whole "
                          "quarter already; it needs its own rebuild path."}

# Columns a rebuild never compares when diffing: `id` is a surrogate, permaticker is
# ours, and a bare lastupdated bump with identical values is not an edit worth counting.
_DIFF_IGNORE = {"id", "permaticker", "lastupdated"}

# Headroom on top of the live table's size before a rebuild may start.
_DISK_HEADROOM = 1.25


def _say(progress: Callable[[str], None] | None, code: str, msg: str) -> None:
    (progress or print)(f"[{code}] {msg}")


def _one(cur, sql: str, params: tuple = ()) -> Any:
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


def _free_bytes(cur) -> int | None:
    """Free space on the database's disk, if this process can see its data directory
    (true when Postgres is local, as on the HomeLab); else the project's disk."""
    for path in (_safe_data_dir(cur), str(PROJECT_ROOT)):
        if not path:
            continue
        try:
            return shutil.disk_usage(path).free
        except OSError:
            continue
    return None


def _safe_data_dir(cur) -> str | None:
    try:
        return _one(cur, "SHOW data_directory")
    except Exception:
        cur.connection.rollback()
        return None


def _live_columns(cur, table: str) -> dict[str, str]:
    cur.execute(
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod) FROM pg_attribute a "
        "WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped "
        "ORDER BY a.attnum", (table,))
    return dict(cur.fetchall())


def _extra_indexes(cur, table: str) -> list[tuple[str, str]]:
    """(name, definition) of every index on `table` except the ones its constraints own
    (the primary key and the unique key) — those come with the CREATE TABLE."""
    cur.execute(
        "SELECT i.relname, pg_get_indexdef(i.oid) FROM pg_index x "
        "JOIN pg_class i ON i.oid = x.indexrelid "
        "WHERE x.indrelid = %s::regclass "
        "AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid)",
        (table,))
    return cur.fetchall()


def _dependent_views(cur, table: str) -> list[tuple[str, str]]:
    """(qualified name, definition) of views reading `table`, so the swap can drop and
    recreate them — a view follows the table's OID, not its name."""
    cur.execute(
        "SELECT DISTINCT v.oid::regclass::text, pg_get_viewdef(v.oid) "
        "FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid "
        "JOIN pg_class v ON v.oid = r.ev_class "
        "WHERE d.refobjid = %s::regclass AND v.oid <> d.refobjid AND v.relkind = 'v'",
        (table,))
    return cur.fetchall()


def _permaticker_join(dest: str, header: list[str], live_cols: dict[str, str]):
    """(select expression, join SQL) that stamp permaticker during the insert, mirroring
    permaticker.enrich_table: products in order, the first match wins. None when the
    table is not stamped."""
    from core.backend.ingest.permaticker import LOOKUP, PRODUCT, ensure_lookup
    if "permaticker" not in live_cols or dest not in PRODUCT or "ticker" not in header:
        return None
    ensure_lookup()
    joins, picks = [], []
    for i, product in enumerate(PRODUCT[dest]):
        joins.append(f"LEFT JOIN {LOOKUP} l{i} ON l{i}.product = '{product}' "
                     f"AND l{i}.ticker = x.ticker")
        picks.append(f"l{i}.permaticker")
    expr = picks[0] if len(picks) == 1 else f"COALESCE({', '.join(picks)})"
    return expr, "\n".join(joins)


def rebuild_table(
    table_code: str,
    *,
    sync_col: str = "lastupdated",
    min_ratio: float = 0.95,
    diff: bool = True,
    keep_download: bool = False,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Rebuild `table_code` from its bulk export into a copy, check it, and swap it in.

    Returns {"rows", "total", "old_total", "added", "removed", "changed", "watermark"}.
    Raises before the swap — leaving the live table untouched — if the copy looks wrong.
    """
    code = table_code.upper()
    if code in NOT_REBUILDABLE:
        raise RuntimeError(NOT_REBUILDABLE[code])
    dest = code.lower()
    new = dest + SUFFIX
    dataset = f"SHARADAR/{code}"
    requested_at = datetime.now()
    say = lambda m: _say(progress, code, m)  # noqa: E731

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        if _one(cur, "SELECT to_regclass(%s)", (dest,)) is None:
            raise RuntimeError(f"{dest} does not exist — load it first; a rebuild "
                               "replaces a table, it does not create one.")

        # A copy left by an interrupted attempt is never resumed: it may be half-filled.
        cur.execute(f"DROP TABLE IF EXISTS {new}")
        raw.commit()

        size = _one(cur, "SELECT pg_total_relation_size(%s::regclass)", (dest,))
        free = _free_bytes(cur)
        say(f"live {dest}: {size / 1e9:.1f} GB; free disk: "
            f"{'unknown' if free is None else f'{free / 1e9:.0f} GB'}")
        if free is not None and free < size * _DISK_HEADROOM:
            raise RuntimeError(
                f"Not enough disk for a second copy of {dest}: need about "
                f"{size * _DISK_HEADROOM / 1e9:.0f} GB free, have {free / 1e9:.0f} GB.")

        live_cols = _live_columns(cur, dest)
        indexes = _extra_indexes(cur, dest)
        raw.commit()
    finally:
        raw.close()

    # ---- download --------------------------------------------------------------------
    types, pk = fetch_schema(code)
    say("downloading the full bulk export…")
    path = export_table(code, DEFAULT_DEST)
    zf = zipfile.ZipFile(path)
    csv_name = zf.namelist()[0]
    total_bytes = zf.getinfo(csv_name).file_size
    with zf.open(csv_name) as fh:
        header = [c.strip() for c in fh.readline().decode().strip().split(",")]

    missing = [c for c in live_cols if c not in header and c not in ("id", "permaticker")]
    if missing:
        raise RuntimeError(
            f"The export has no {missing} — columns the live {dest} holds. Swapping would "
            f"drop them, so stopping. (Has Sharadar renamed or removed a column?)")

    # ---- build the copy --------------------------------------------------------------
    ddl, _dml, stage_defs, stage_cols, _ = _build_sql(header, types, pk, new)
    stamp = _permaticker_join(dest, header, live_cols)
    insert_cols = ", ".join(f'"{c}"' for c in header)
    x_cols = ", ".join(f'x."{c}"' for c in header)
    if stamp:
        expr, joins = stamp
        fill = (f"INSERT INTO {new} ({insert_cols}, permaticker)\n"
                f"SELECT {x_cols}, {expr} FROM ({_stage_select(header, types, pk)}) x\n"
                f"{joins}")
    else:
        fill = f"INSERT INTO {new} ({insert_cols}) {_stage_select(header, types, pk)}"

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SET work_mem = '1GB'")
        cur.execute("SET maintenance_work_mem = '1GB'")
        cur.execute(ddl)
        if "permaticker" in live_cols and "permaticker" not in header:
            cur.execute(f"ALTER TABLE {new} ADD COLUMN permaticker {live_cols['permaticker']}")
        cur.execute(f"CREATE TEMP TABLE _stage ({stage_defs}) ON COMMIT DROP")
        say(f"COPY {total_bytes / 1e6:.0f} MB -> staging…")
        with cur.copy(f"COPY _stage ({stage_cols}) FROM STDIN WITH (FORMAT csv, HEADER true)") as cp:
            with zf.open(csv_name) as fh:
                copied, mark = 0, 500 * 1024 * 1024
                while chunk := fh.read(1 << 20):
                    cp.write(chunk)
                    copied += len(chunk)
                    if copied >= mark:
                        say(f"COPY {copied / 1e6:.0f}/{total_bytes / 1e6:.0f} MB …")
                        mark += 500 * 1024 * 1024
        say("filling the copy" + (" (permaticker stamped in the same pass)…" if stamp else "…"))
        cur.execute(fill)
        raw.commit()   # the expensive part is kept even if a later step fails

        say(f"indexing ({len(indexes)} index(es))…")
        for name, definition in indexes:
            # pg_get_indexdef writes "INDEX <name> ON [ONLY] <schema>.<table> USING ...".
            definition, n = re.subn(
                rf"INDEX {re.escape(name)} ON (ONLY )?((?:\S+\.)?){re.escape(dest)} ",
                rf"INDEX {name}{SUFFIX} ON \g<1>\g<2>{new} ", definition, count=1)
            if n != 1:
                raise RuntimeError(f"Could not retarget index {name}: {definition}")
            cur.execute(definition)
        cur.execute(f"ANALYZE {new}")
        raw.commit()

        # ---- check -------------------------------------------------------------------
        new_n = _one(cur, f"SELECT count(*) FROM {new}")
        old_n = _one(cur, f"SELECT count(*) FROM {dest}")
        say(f"copy holds {new_n:,} rows; live holds {old_n:,}")
        if old_n and new_n < old_n * min_ratio:
            raise RuntimeError(
                f"The copy has {new_n:,} rows against {old_n:,} live "
                f"({new_n / old_n:.1%}, below the {min_ratio:.0%} floor). Not swapping — "
                f"the export looks incomplete. Live table untouched.")
        if "date" in header:
            new_max = _one(cur, f"SELECT max(date) FROM {new}")
            old_max = _one(cur, f"SELECT max(date) FROM {dest}")
            if old_max and (new_max is None or new_max < old_max):
                raise RuntimeError(
                    f"The copy ends {new_max}, earlier than the live table ({old_max}). "
                    f"Not swapping. Live table untouched.")

        # ---- diff --------------------------------------------------------------------
        added = removed = changed = None
        keys = [c for c in pk if c in header]
        if diff and keys:
            say("comparing against the live table…")
            on = " AND ".join(f'o."{k}" = n."{k}"' for k in keys)
            cmp_cols = [c for c in header if c not in _DIFF_IGNORE and c not in keys]
            o_row = ", ".join(f'o."{c}"' for c in cmp_cols) or "NULL"
            n_row = ", ".join(f'n."{c}"' for c in cmp_cols) or "NULL"
            cur.execute(
                f"SELECT count(*) FILTER (WHERE o.id IS NULL), "
                f"count(*) FILTER (WHERE n.id IS NULL), "
                f"count(*) FILTER (WHERE o.id IS NOT NULL AND n.id IS NOT NULL "
                f"AND ROW({o_row}) IS DISTINCT FROM ROW({n_row})) "
                f"FROM {dest} o FULL JOIN {new} n ON {on}")
            added, removed, changed = cur.fetchone()
            say(f"diff: +{added:,} added, -{removed:,} removed, ~{changed:,} changed")
        raw.commit()

        # ---- swap --------------------------------------------------------------------
        watermark = None
        if sync_col in header:
            watermark = _one(cur, f'SELECT max("{sync_col}") FROM {new}')
        views = _dependent_views(cur, dest)
        say("swapping in" + (f" (recreating {len(views)} view(s))" if views else "") + "…")
        for attempt in range(1, 6):
            try:
                cur.execute("SET LOCAL lock_timeout = '15s'")
                for vname, _ in views:
                    cur.execute(f"DROP VIEW {vname}")
                cur.execute(f"DROP TABLE {dest}")
                cur.execute(f"ALTER TABLE {new} RENAME TO {dest}")
                cur.execute(f"ALTER SEQUENCE {new}_id_seq RENAME TO {dest}_id_seq")
                cur.execute(f"ALTER TABLE {dest} RENAME CONSTRAINT {new}_pkey TO {dest}_pkey")
                if keys:
                    cur.execute(f"ALTER TABLE {dest} RENAME CONSTRAINT uq_{new} TO uq_{dest}")
                for name, _ in indexes:
                    cur.execute(f"ALTER INDEX {name}{SUFFIX} RENAME TO {name}")
                for vname, vdef in views:
                    cur.execute(f"CREATE VIEW {vname} AS {vdef}")
                if watermark is not None:
                    cur.execute(_SYNC_STATE_UPSERT, (dataset, watermark, new_n))
                raw.commit()
                break
            except Exception as exc:
                raw.rollback()
                if "lock timeout" not in str(exc).lower() or attempt == 5:
                    raise
                say(f"swap waited too long for readers to let go (attempt {attempt}/5); retrying")
                time.sleep(5)
    finally:
        raw.close()
        zf.close()

    if code == "TICKERS":
        from core.backend.ingest.permaticker import rebuild_lookup
        say("tickers changed — rebuilding the permaticker lookup…")
        rebuild_lookup()

    if not keep_download:
        try:
            path.unlink()
        except OSError:
            pass

    result = {"rows": new_n, "total": new_n, "old_total": old_n, "added": added,
              "removed": removed, "changed": changed,
              "watermark": watermark.isoformat() if watermark else None}
    record_load(source="SHARADAR", dataset=dataset, operation="rebuild", rows=new_n,
                requested_at=requested_at, detail=json.dumps(result))
    say(f"DONE — {dest} replaced: {old_n:,} -> {new_n:,} rows")
    return result


def rebuildable_keys() -> list[str]:
    """Registry keys of the Sharadar datasets a rebuild can replace."""
    from core.backend import sources
    return [d.key for d in sources.DATASETS
            if d.phase == "sharadar" and d.key.split(":", 1)[1] not in NOT_REBUILDABLE]


def rebuild_overview() -> dict[str, Any]:
    """Per rebuildable table: its size, the last rebuild and what it changed. For the
    Setup page; reads catalog sizes and the load ledger only, so it is cheap."""
    from sqlalchemy import text

    from core.backend import sources
    by_key = {d.key: d for d in sources.DATASETS}
    with engine.connect() as conn:
        last = {
            r.dataset: r for r in conn.execute(text(
                "SELECT DISTINCT ON (dataset) dataset, completed_at, detail FROM load_log "
                "WHERE operation = 'rebuild' ORDER BY dataset, completed_at DESC"))
        }
        tables = []
        for key in rebuildable_keys():
            d = by_key[key]
            dest = d.tables[0]
            size = conn.execute(
                text("SELECT CASE WHEN to_regclass(:t) IS NULL THEN NULL "
                     "ELSE pg_total_relation_size(to_regclass(:t)) END"), {"t": dest}).scalar()
            row = last.get(f"SHARADAR/{key.split(':', 1)[1]}")
            result = None
            if row and row.detail:
                try:
                    result = json.loads(row.detail)
                except ValueError:
                    result = None
            tables.append({
                "key": key, "label": d.label, "table": dest, "size_bytes": size,
                "last_rebuild_at": row.completed_at.isoformat() if row else None,
                "last_result": result,
            })
        raw = conn.connection
        free = _free_bytes(raw.cursor())
    return {"tables": tables, "free_bytes": free, "headroom": _DISK_HEADROOM,
            "not_rebuildable": NOT_REBUILDABLE}
