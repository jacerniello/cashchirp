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


def denormalise_sf3(only_null: bool = True, progress=None) -> tuple[int, int]:
    """Put `investorname` and `price` back on sf3. Returns (total_rows, rows_named).

    Two paths, because the two cases are not the same size of problem.

    **First build** (no `investorname` column yet): every one of ~81M rows needs the value,
    and `UPDATE` is the wrong tool for that. Postgres rewrites each row it touches, so the
    UPDATE writes 81M new versions and leaves 81M dead ones, and the `ALTER ADD price …
    STORED` that follows then rewrites the whole table a second time. Measured: 75 minutes
    and still going, bottlenecked on WAL fsync, with the second rewrite not yet started.

    So the first build writes ONE new table instead: create it empty with both columns
    already declared (instant — a generated column on an empty table costs nothing), fill
    it in a single INSERT…SELECT, then swap. One pass instead of two, and because the new
    table is written fresh it also drops whatever bloat the old one carried.

    **Incremental** (column exists): only the newly-inserted rows are NULL, so the UPDATE
    is small and is exactly right.

    Raises if sf3b — the investorid -> investorname map — is missing or empty. Stamping
    81M NULLs and reporting success would leave every institution page blank.
    """
    say = progress or (lambda _m: None)
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
        if not cur.fetchone()[0]:
            raise RuntimeError("sf3b holds no investors — cannot name sf3 rows.")

        cur.execute("SET maintenance_work_mem = '1GB';")
        cur.execute(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_name = 'sf3' AND column_name = 'investorname';")
        has_col = bool(cur.fetchone()[0])

        if has_col:
            say("stamping newly-loaded rows…")
            where_null = " AND s.investorname IS NULL" if only_null else ""
            cur.execute(
                f"UPDATE sf3 s SET investorname = b.investorname "
                f"FROM (SELECT DISTINCT investorid, investorname FROM sf3b) b "
                f"WHERE s.investorid = b.investorid{where_null};")
        else:
            # Columns Sharadar ships, in order — copied explicitly so the INSERT column
            # list never includes the generated one (Postgres rejects that).
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'sf3' ORDER BY ordinal_position;")
            cols = [r[0] for r in cur.fetchall()]
            collist = ", ".join(f'"{c}"' for c in cols)

            # A previous run may have committed the filled table and failed at the swap.
            # Refilling 81M rows to redo a five-second rename would be wasteful, so if a
            # complete one is already there, go straight to the swap.
            cur.execute("SELECT to_regclass('sf3__denorm');")
            resume = False
            if cur.fetchone()[0] is not None:
                cur.execute("SELECT count(*) FROM sf3__denorm;")
                have = cur.fetchone()[0]
                cur.execute("SELECT count(*) FROM sf3;")
                want = cur.fetchone()[0]
                if have == want:
                    say(f"found a complete sf3__denorm ({have:,} rows) — skipping the fill")
                    resume = True
                else:
                    say(f"discarding a partial sf3__denorm ({have:,} of {want:,})")
                    cur.execute("DROP TABLE sf3__denorm;")

            if not resume:
                say("creating the new table (empty, both columns declared)…")
                cur.execute("DROP TABLE IF EXISTS sf3__denorm;")
                # NOT `INCLUDING DEFAULTS`: that copies id's nextval('sf3_id_seq')
                # default, so the new table would depend on a sequence OWNED BY the table
                # we are about to drop, and the drop fails. Reattached after the swap.
                cur.execute("CREATE TABLE sf3__denorm (LIKE sf3 INCLUDING STORAGE);")
                cur.execute("ALTER TABLE sf3__denorm ADD COLUMN investorname text;")
                cur.execute(
                    "ALTER TABLE sf3__denorm ADD COLUMN price double precision "
                    "GENERATED ALWAYS AS (value / NULLIF(units, 0) * 1000) STORED;")

                say("filling it in one pass (81M rows; this is the long step)…")
                cur.execute(
                    f"INSERT INTO sf3__denorm ({collist}, investorname) "
                    f"SELECT {', '.join('s.\"' + c + '\"' for c in cols)}, b.investorname "
                    f"FROM sf3 s "
                    f"LEFT JOIN (SELECT DISTINCT investorid, investorname FROM sf3b) b "
                    f"  ON b.investorid = s.investorid;")

                say("indexing…")
                cur.execute("CREATE INDEX ix_sf3__denorm_investorname_date "
                            "ON sf3__denorm (investorname, date);")
                cur.execute("CREATE INDEX ix_sf3__denorm_permaticker ON sf3__denorm (permaticker);")
                cur.execute("CREATE INDEX ix_sf3__denorm_date ON sf3__denorm (date);")

                # COMMIT THE EXPENSIVE PART FIRST. The fill and the indexes above are ~26
                # minutes of work; the swap below is seconds. Holding both in one transaction
                # means any error in the cheap half discards the expensive half — which is
                # exactly what happened when the DROP hit the sequence dependency.
                raw.commit()
            say("filled table committed; swapping in…")

            # The sequence is owned by sf3, so DROP TABLE would take it with them and
            # leave the new table's id default dangling. Detach, drop, reattach.
            cur.execute("ALTER SEQUENCE sf3_id_seq OWNED BY NONE;")
            cur.execute("DROP TABLE sf3;")
            cur.execute("ALTER TABLE sf3__denorm RENAME TO sf3;")
            cur.execute("ALTER TABLE sf3 ALTER COLUMN id SET DEFAULT nextval('sf3_id_seq');")
            cur.execute("ALTER SEQUENCE sf3_id_seq OWNED BY sf3.id;")
            for oldix, newname in (
                ("ix_sf3__denorm_investorname_date", "ix_sf3_investorname_date"),
                ("ix_sf3__denorm_permaticker", "ix_sf3_permaticker"),
                ("ix_sf3__denorm_date", "ix_sf3_date"),
            ):
                cur.execute(f"ALTER INDEX {oldix} RENAME TO {newname};")

        cur.execute("SELECT count(*), count(investorname) FROM sf3;")
        total, named = cur.fetchone()
        raw.commit()
        say(f"done — {named:,}/{total:,} rows named")
        return total, named
    finally:
        raw.close()


