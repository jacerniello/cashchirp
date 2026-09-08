"""Verify each loaded Postgres table against the file it was downloaded from.

The downloaded zip is the source of truth (it IS the remote snapshot we pulled).
Comparing the table to it validates the *load* — exactly where our bugs were:
- row count: zip CSV rows == table rows  (catches DISTINCT-ON dedup loss, e.g. SF3)
- per-column non-null: a column populated in the CSV but NULL in the table means a
  cast silently nulled it (catches the date-regex bug). The loader maps ''->NULL,
  so we compare against the CSV's non-empty counts and flag a material shortfall.

Columns we add (id, permaticker) are ignored — they aren't in the file.

Needs the downloaded zip, which `load_table` deletes on success (nothing else uses it:
the routine refresh syncs deltas over the query API and never opens one). To verify a
load, run it with `keep_download=True` and check before deleting. A table whose zip is
gone reports "no zip on disk" rather than failing — an unverifiable load is unknown, not
broken.
"""
import zipfile

import pandas as pd
from sqlalchemy import text

from core.backend.db.engine import engine
from core.backend.ingest.sharadar.sharadar import DEFAULT_DEST

# table code -> local table name
FILES = {
    "SEP": "sep", "SF1": "sf1", "SF2": "sf2", "SF3": "sf3", "SF3A": "sf3a",
    "SF3B": "sf3b", "SFP": "sfp", "DAILY": "daily", "METRICS": "metrics",
    "EVENTS": "events", "ACTIONS": "actions", "SP500": "sp500", "TICKERS": "tickers",
}


def _zip_for(code: str):
    return DEFAULT_DEST / f"{code}.zip"


def _table_cols(dest: str) -> list[str]:
    with engine.connect() as c:
        return [r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t "
            "AND column_name NOT IN ('id','permaticker') ORDER BY ordinal_position"
        ), {"t": dest})]


def _table_stats(dest: str, cols: list[str]):
    sel = ", ".join(f'count("{c}") AS "{c}"' for c in cols)
    with engine.connect() as c:
        row = c.execute(text(f"SELECT count(*) AS n, {sel} FROM {dest}")).mappings().one()
    return row["n"], {c: row[c] for c in cols}


def _csv_stats(zippath, cols: list[str]):
    """Stream the zip CSV once: total rows + non-empty count per column."""
    total = 0
    notna = {c: 0 for c in cols}
    reader = pd.read_csv(
        zippath, compression="zip", chunksize=1_000_000, dtype=str,
        na_values=[""], keep_default_na=False,  # treat only '' as missing (matches NULLIF)
    )
    for chunk in reader:
        total += len(chunk)
        for c in cols:
            if c in chunk.columns:
                notna[c] += int(chunk[c].notna().sum())
    return total, notna


def check_file(code: str, dest: str) -> dict:
    zp = _zip_for(code)
    if not zp.exists():
        return {"status": "no zip on disk"}
    with zipfile.ZipFile(zp) as z:
        name = z.namelist()[0]
        with z.open(name) as fh:
            header = [c.strip() for c in fh.readline().decode().strip().split(",")]
    tcols = set(_table_cols(dest))
    cols = [c for c in header if c in tcols]

    t_rows, t_na = _table_stats(dest, cols)
    c_rows, c_na = _csv_stats(zp, cols)

    issues = []
    if c_rows != t_rows:
        issues.append(f"ROW COUNT csv={c_rows:,} table={t_rows:,} ({t_rows - c_rows:+,})")
    for c in cols:
        # table maps ''->NULL, so table_nonnull should ~= csv_nonnull. A material
        # shortfall = a cast silently nulled values.
        if c_na[c] > 0 and t_na[c] < c_na[c] * 0.999:
            issues.append(f"col {c}: csv_nonnull={c_na[c]:,} table_nonnull={t_na[c]:,}")
    return {"csv_rows": c_rows, "table_rows": t_rows,
            "status": "OK" if not issues else "ISSUES", "issues": issues}


def verify_all(progress=print) -> dict:
    out = {}
    for code, dest in FILES.items():
        with engine.connect() as c:
            if c.execute(text("SELECT to_regclass(:t)"), {"t": f"public.{dest}"}).scalar() is None:
                progress(f"{code:8} SKIP (table missing)")
                continue
        try:
            r = check_file(code, dest)
        except Exception as exc:
            r = {"status": f"error: {exc}"}
        out[code] = r
        line = f"{code:8} {r['status']:6} csv={r.get('csv_rows', '?'):>12,} table={r.get('table_rows', '?'):>12,}" \
            if isinstance(r.get("csv_rows"), int) else f"{code:8} {r['status']}"
        progress(line)
        for iss in r.get("issues", []):
            progress(f"           !! {iss}")
    return out
