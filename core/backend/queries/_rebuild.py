"""Single-flight, atomic rebuilds for the precomputed/derived tables.

A rebuild can be triggered from more than one process at once — the orchestrator, a
build script, several web workers — and each would `DROP`+rebuild the same table
simultaneously, deadlocking (one holds a read lock,
another's `DROP TABLE` waits behind it, every reader piles up behind the `DROP`).
Two primitives remove that:

- `single_flight(lock_key)` — a cross-process Postgres advisory lock so only ONE
  caller rebuilds; the rest skip and keep serving the existing table.
- build into `<name>__new` (with its indexes named `*__new`), then `swap_in()` to
  replace `<name>` atomically — `DROP` old, `RENAME` new + its indexes. The slow
  build runs off the live table so readers never block on it; only the final
  metadata swap takes a brief exclusive lock.

Use them together: `with single_flight(KEY) as mine: if not mine: return <current>`,
build `<name>__new`, then `swap_in(conn, name, [...])` inside one transaction.
"""
import contextlib

from sqlalchemy import text

from core.backend.db.engine import engine

# Stable, arbitrary advisory-lock keys — one per derived object. Distinct so the
# three rebuilds never block each other, only their own concurrent duplicates.
LOCK_SCREENER = 911_001
LOCK_HOLDERS = 911_002
LOCK_INSIDERS = 911_003
LOCK_INVESTOR_HOLDINGS = 911_004
LOCK_SP500_CONCENTRATION = 911_005
LOCK_SP500_MEMBER_MONTHS = 911_006

NEW = "__new"  # suffix for the off-table staging copy (table and its indexes)


@contextlib.contextmanager
def single_flight(lock_key: int):
    """Yield True iff we acquired the cross-process lock (caller should build); yield
    False if another process is already rebuilding (caller should skip). The lock is
    held on a dedicated connection for the whole `with` block and released on exit."""
    conn = engine.connect()
    got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": lock_key}).scalar())
    try:
        yield got
    finally:
        try:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": lock_key})
        finally:
            conn.close()


def live_count(table: str) -> int:
    """Row count of `table`, or 0 if it doesn't exist yet — for the 'another worker is
    already building' skip path. Reads the live table (the build runs off it in
    `…__new`), so it never blocks behind a rebuild."""
    with engine.connect() as c:
        if c.execute(text("SELECT to_regclass(:t)"), {"t": table}).scalar() is None:
            return 0
        return int(c.execute(text(f"SELECT count(*) FROM {table}")).scalar() or 0)


def _bare(name: str) -> tuple[str, str]:
    """('schema.', 'table') or ('', 'table') for a possibly schema-qualified name."""
    if "." in name:
        sch, tbl = name.split(".", 1)
        return sch + ".", tbl
    return "", name


def swap_in(conn, name: str, index_renames: tuple[tuple[str, str], ...] = ()) -> None:
    """Replace live `name` with the already-built `name + '__new'`, in `conn`'s
    transaction: drop the old table (and its indexes), rename the new table into
    place, then rename each staged index to its final name. Metadata-only → fast.
    `index_renames` = ((built_name, final_name), ...) with **bare** index names."""
    sch, tbl = _bare(name)
    conn.execute(text(f"DROP TABLE IF EXISTS {name}"))
    conn.execute(text(f"ALTER TABLE {name}{NEW} RENAME TO {tbl}"))
    for built, final in index_renames:
        conn.execute(text(f"ALTER INDEX {sch}{built} RENAME TO {final}"))
