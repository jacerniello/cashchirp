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


class RebuildSkipped(RuntimeError):
    """Raised when an explicitly-requested rebuild could not run because another process
    held the single-flight lock.

    The app's automatic post-load hooks pass `require_build=False` and treat a skip as
    fine — something else is already building the same thing, and the live table keeps
    serving. But when someone asks for a rebuild by name, a skip is not success: the
    builders return a live row count, which is a plausible number from a table nobody
    rebuilt, and it reads as a completed build. This makes that case say so."""


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


@contextlib.contextmanager
def suppress_app_rebuilds(log=lambda _msg: None):
    """Hold every derived-rebuild lock for the duration of an ingest, so the web app
    cannot rebuild a derived table *while its source tables are being mutated*.

    The convoy this prevents: a screener/holder page view sees the as-of date jump the
    instant DAILY loads, so it fires `refresh_snapshot`, whose multi-minute build holds
    `AccessShareLock` on daily/sf1/sep for the whole time — right when the next Sharadar
    step wants `ALTER TABLE … ADD COLUMN permaticker` (`AccessExclusiveLock`). The ALTER
    queues behind the build, every later reader queues behind the ALTER, and the whole
    database stalls for minutes.

    Every app rebuild path is `with single_flight(LOCK): if not mine: return <live>`, so
    once these locks are held the app cheaply serves the existing table instead of
    building. Best-effort: a lock the app already holds (mid-rebuild) is skipped rather
    than waited on. Released on exit — before the orchestrator's own derived phase, which
    needs these same locks.

    `log` takes a message; callers with a progress display pass theirs.
    """
    keys = [v for k, v in globals().items() if k.startswith("LOCK_")]
    conn = engine.connect()
    got = []
    for k in keys:
        if conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": k}).scalar():
            got.append(k)
    if len(got) < len(keys):
        log(f"  (rebuild guard: held {len(got)}/{len(keys)} locks; "
            f"app may be mid-rebuild on the rest)")
    try:
        yield
    finally:
        for k in got:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": k})
        conn.close()
