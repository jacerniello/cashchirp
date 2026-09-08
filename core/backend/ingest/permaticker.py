"""permaticker enrichment — attach Sharadar's stable security id to each table.

permaticker is "unique and unchanging" and is the intended cross-table join key.
It is NOT in the data tables (SEP/SF1/SF2/...) — only in TICKERS, keyed by
(table, ticker). So we take it *straight from TICKERS per product* (no derivation,
no tiebreaker) and stamp it on. Where TICKERS is itself ambiguous for a
(product, ticker) — a single recycled case — we leave permaticker NULL rather
than guess.

Wired into the generic loader: after `tickers` loads we rebuild the lookup; after
any ticker-bearing table loads we stamp it.
"""
from core.backend.db.engine import engine

LOOKUP = "permaticker_lookup"

# table -> the TICKERS `table` (product) whose (ticker -> permaticker) applies.
# TICKERS in this bundle only carries SEP/SF1/SF3B/SFP; the other equity tables
# resolve through the SEP equity master (same security, same permaticker).
# table -> ordered list of TICKERS products to resolve through. The equity master
# (SEP) is tried first; mixed equity/fund tables fall back to the fund master (SFP)
# for the leftovers. Each pass is the same deterministic TICKERS join.
PRODUCT = {
    "sep": ["SEP"], "sf1": ["SF1"], "sfp": ["SFP"],
    "sf2": ["SEP", "SFP"], "sf3": ["SEP", "SFP"], "sf3a": ["SEP", "SFP"],
    "daily": ["SEP", "SFP"], "metrics": ["SEP", "SFP"], "events": ["SEP", "SFP"],
    "actions": ["SEP", "SFP"], "sp500": ["SEP", "SFP"],
}
KEY_COL: dict[str, str] = {}  # join column is "ticker" for every table


def _exists(name: str) -> bool:
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SELECT to_regclass(%s);", (f"public.{name}",))
        return cur.fetchone()[0] is not None
    finally:
        raw.close()


def rebuild_lookup() -> tuple[int, int]:
    """(Re)build the (product, ticker) -> permaticker lookup straight from TICKERS.
    Ambiguous (product, ticker) pairs are excluded (not guessed). Returns
    (lookup_rows, excluded_ambiguous_pairs)."""
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(f"DROP TABLE IF EXISTS {LOOKUP};")
        # Hardened: keep only tickers that map to exactly ONE permaticker *globally*
        # (across all products). A globally-ambiguous ticker is excluded entirely, so
        # any stamp is provably unique to its ticker — zero false positives by
        # construction. (Global uniqueness also implies per-(product,ticker) uniqueness.)
        cur.execute(
            f"""
            CREATE TABLE {LOOKUP} AS
            WITH src AS (
                SELECT "table" AS product, ticker,
                       NULLIF(permaticker, '')::bigint AS permaticker
                FROM tickers
                WHERE ticker IS NOT NULL AND NULLIF(permaticker, '') IS NOT NULL
            ),
            unique_tickers AS (
                SELECT ticker FROM src GROUP BY ticker HAVING count(DISTINCT permaticker) = 1
            )
            SELECT DISTINCT product, ticker, permaticker
            FROM src WHERE ticker IN (SELECT ticker FROM unique_tickers);
            """
        )
        cur.execute(f"CREATE UNIQUE INDEX ON {LOOKUP} (product, ticker);")
        cur.execute(f"SELECT count(*) FROM {LOOKUP};")
        n = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM (SELECT ticker FROM tickers "
            "WHERE ticker IS NOT NULL AND NULLIF(permaticker,'') IS NOT NULL "
            "GROUP BY ticker HAVING count(DISTINCT permaticker) > 1) x;"
        )
        excluded = cur.fetchone()[0]
        raw.commit()
        return n, excluded
    finally:
        raw.close()


def ensure_lookup() -> None:
    if not _exists(LOOKUP):
        rebuild_lookup()


def enrich_table(
    table: str,
    key_col: str | None = None,
    products: list[str] | str | None = None,
    only_null: bool = False,
) -> tuple[int, int]:
    """Stamp permaticker on `table` from TICKERS, trying `products` in order.

    Pass 1 stamps via the first product; later passes fill only still-NULL rows
    (so the first product keeps precedence). `only_null=True` makes even pass 1
    fill only NULLs — for incremental syncs (fast). The default re-stamps from
    pass 1 (use after the mapping changes). Returns (total_rows, rows_with_perma)."""
    ensure_lookup()
    key_col = key_col or KEY_COL.get(table, "ticker")
    products = products or PRODUCT.get(table, ["SEP"])
    if isinstance(products, str):
        products = [products]
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SET maintenance_work_mem = '1GB';")
        if not only_null:
            # full re-stamp: drop+re-add (cheap catalog op) so a changed lookup fully
            # applies — rows it no longer matches become NULL, not stale values.
            cur.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS permaticker;")
        cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS permaticker bigint;")
        for i, product in enumerate(products):
            where_null = " AND t.permaticker IS NULL" if (only_null or i > 0) else ""
            cur.execute(
                f'UPDATE {table} t SET permaticker = l.permaticker '
                f'FROM {LOOKUP} l WHERE l.product = %s AND t."{key_col}" = l.ticker{where_null};',
                (product,),
            )
        cur.execute(
            f"CREATE INDEX IF NOT EXISTS ix_{table}_permaticker ON {table} (permaticker);"
        )
        # Surface-specific helper indexes (idempotent), so a fresh DB build keeps the
        # insider pages fast (see core/api/routers/insiders.py):
        #   sf2(ownername) — the single-insider page filters SF2 by owner *name* (owner_id
        #     resolves to a name); without this every load seq-scans ~11M rows (~13s).
        #   sep(permaticker, date) — the per-row market-close LEFT JOIN that values
        #     grants/exercises does one lookup per transaction; the composite turns each
        #     into a direct probe instead of a BitmapAnd of two single-column indexes.
        if table == "sf2":
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_sf2_ownername ON sf2 (ownername);"
            )
        if table == "sep":
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_sep_permaticker_date "
                "ON sep (permaticker, date);"
            )
        #   sf3(investorname, date) — the investor (13F filer) page filters SF3 by
        #     investorname alone; without this a large filer (BlackRock) seq-scans
        #     ~46M rows (~21–60s). See core/api/routers/institutional.py. `investorname`
        #     is not Sharadar's any more — see denormalise_sf3() — so the index is built
        #     there, once the column exists, rather than here where it would not yet.
        cur.execute(f"SELECT count(*), count(permaticker) FROM {table};")
        total, has = cur.fetchone()
        raw.commit()
        return total, has
    finally:
        raw.close()


def enrich_all(progress=print) -> dict:
    n, excluded = rebuild_lookup()
    if progress:
        progress(f"  lookup: {n:,} (product,ticker) keys; {excluded} ambiguous excluded (NULL, not guessed)")
    results: dict[str, tuple] = {}
    plan = ["sep", "sf1", "sf2", "sf3", "sf3a", "daily",
            "metrics", "events", "actions", "sp500", "sfp"]
    for table in plan:
        if not _exists(table):
            continue
        try:
            total, has = enrich_table(table)
            results[table] = (total, has)
            pct = 100 * has / total if total else 0
            via = "+".join(PRODUCT.get(table, ["SEP"]))
            if progress:
                progress(f"  {table:14} {has:>12,}/{total:<12,} ({pct:5.1f}%) via TICKERS[{via}]")
        except Exception as exc:
            results[table] = ("error", str(exc))
            if progress:
                progress(f"  {table:14} FAILED: {exc}")
    return results


# --------------------------------------------------------------- sf3 denormalisation

# Sharadar reshaped the 13F detail table: `calendardate` became `date`, `investorname`
# became `investorid`, and `price` was dropped. Everything the app reads from sf3 —
# 59 investorname references, 11 price references, both derived holdings tables — was
# written against the old shape.
#
# Rather than thread investorid through all of it and join sf3b on every read, the two
# missing fields are put back on sf3 at load time. sf3 is the ~46M-row table and the
# institution page is the one that already needed an index to stay usable, so a join per
# read is the wrong side to pay on. This is the same trade permaticker already makes.
#
# `price` is not stored twice over: it is GENERATED, computed once at write time from the
# columns Sharadar does ship. value is in millions and units in thousands, so the ×1000
# reconciles them — checked against SEP, where AAPL's 2026-06-30 close of 289.36 comes
# back to the cent from seven of its eight largest holders (the eighth is a filer marking
# its own price, which is ordinary 13F variance, not arithmetic).
_PRICE_EXPR = "value / NULLIF(units, 0) * 1000"


def denormalise_sf3(only_null: bool = True) -> tuple[int, int]:
    """Put `investorname` and `price` back on sf3. Returns (total_rows, rows_named).

    Reads the investorid -> investorname map from sf3b, which the registry loads first.
    Raises if that map is missing or empty: stamping 46M NULLs and reporting success
    would leave every institution page silently blank, which is far worse than a load
    that stops and says why.
    """
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SELECT to_regclass('sf3b');")
        if cur.fetchone()[0] is None:
            raise RuntimeError(
                "sf3b is missing — it is the investorid -> investorname map sf3 needs. "
                "Load it first: --dataset sharadar:SF3B"
            )
        cur.execute("SELECT count(DISTINCT investorid) FROM sf3b;")
        n_map = cur.fetchone()[0]
        if not n_map:
            raise RuntimeError("sf3b holds no investors — cannot name sf3 rows.")

        cur.execute("SET maintenance_work_mem = '1GB';")
        cur.execute("ALTER TABLE sf3 ADD COLUMN IF NOT EXISTS investorname text;")
        where_null = " AND s.investorname IS NULL" if only_null else ""
        cur.execute(
            f"UPDATE sf3 s SET investorname = b.investorname "
            f"FROM (SELECT DISTINCT investorid, investorname FROM sf3b) b "
            f"WHERE s.investorid = b.investorid{where_null};"
        )
        # Generated, so it cannot drift from value/units and needs no backfill pass.
        cur.execute(
            f"ALTER TABLE sf3 ADD COLUMN IF NOT EXISTS price double precision "
            f"GENERATED ALWAYS AS ({_PRICE_EXPR}) STORED;"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS ix_sf3_investorname_date "
            "ON sf3 (investorname, date);"
        )
        cur.execute("SELECT count(*), count(investorname) FROM sf3;")
        total, named = cur.fetchone()
        raw.commit()
        return total, named
    finally:
        raw.close()

