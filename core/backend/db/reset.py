"""Return the database to bare: no data, no tables, just the schema the models own.

`Base.metadata.drop_all()` is NOT a reset. It drops only the tables SQLAlchemy declares —
7 of them — while the Sharadar mirror, the derived tables and the `derived` schema are all
created by raw `CREATE TABLE` in the loader and survive untouched. On a built database that
leaves ~25 objects and tens of gigabytes behind while reporting success.

So this drops the *schemas* and rebuilds them. That also takes the things a table-by-table
drop forgets: views, materialised views, sequences, indexes and any table added since.

Destructive and not undoable. The caller is responsible for confirming intent; see the
`/setup/reset` endpoint, which requires the database name to be typed back and refuses
while a build is running.
"""
from __future__ import annotations

from sqlalchemy import text

from core.backend.db import models  # noqa: F401  (registers tables on Base)
from core.backend.db.base import Base
from core.backend.db.engine import engine

# `public` is recreated because Postgres expects it to exist; `derived` is recreated
# because the insider builders assume it and would otherwise fail on first run.
SCHEMAS = ("public", "derived")


def inventory() -> dict[str, int]:
    """What is here now — used to report what a reset would remove, and to prove
    afterwards that it did."""
    with engine.connect() as conn:
        n_obj = conn.execute(text("""
            SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','m','p','v')
              AND n.nspname NOT IN ('pg_catalog','information_schema')
        """)).scalar_one()
        size = conn.execute(
            text("SELECT pg_size_pretty(pg_database_size(current_database()))")
        ).scalar_one()
        db = conn.execute(text("SELECT current_database()")).scalar_one()
    return {"objects": int(n_obj), "size": size, "database": db}


def reset_database() -> dict[str, object]:
    """Drop every schema this app owns, recreate them, and rebuild the model tables.

    Returns before/after inventories so a caller can show what actually happened rather
    than asserting success.
    """
    before = inventory()

    with engine.begin() as conn:
        # CASCADE because the derived tables carry indexes and foreign objects; dropping
        # the schema takes the lot in one statement rather than ordering drops by hand.
        for schema in SCHEMAS:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        # Recreating `public` drops the default grants with it; without this a non-owner
        # role (the API's, if it differs from the migration role) can no longer read.
        conn.execute(text('GRANT ALL ON SCHEMA "public" TO CURRENT_USER'))
        conn.execute(text('GRANT ALL ON SCHEMA "public" TO PUBLIC'))

    # Back to the bare configuration: the tables the models declare, and nothing else.
    Base.metadata.create_all(engine)

    after = inventory()
    return {
        "before": before,
        "after": after,
        "recreated_tables": sorted(Base.metadata.tables),
    }
