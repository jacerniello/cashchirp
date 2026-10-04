"""Sync watermarks: read them, and rewind them so the next sync re-pulls from a date.

An incremental Sharadar sync starts from `sync_state.last_updated_date` (minus a day of
lookback) and trusts it completely. A watermark that is AHEAD of the data — written by a
run that advanced it without loading the rows, or by another program sharing the
database — makes every later sync silently skip the gap. Rewinding is the repair: the
sync upserts, so re-pulling rows already held is harmless, while starting too late
loses data for good.

Hence the one rule here: a watermark can only move BACK. Moving one forward is exactly
the failure this exists to undo.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text

from core.backend.db.engine import engine


def list_watermarks() -> list[dict[str, Any]]:
    """Every row of sync_state, oldest watermark first."""
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT table_name, last_updated_date, last_run, rows_loaded "
            "FROM sync_state ORDER BY last_updated_date NULLS FIRST, table_name"
        )).mappings().all()
    return [
        {
            "table": r["table_name"],
            "watermark": r["last_updated_date"].isoformat() if r["last_updated_date"] else None,
            "last_run": r["last_run"].isoformat(timespec="seconds") if r["last_run"] else None,
            "rows_loaded": r["rows_loaded"],
        }
        for r in rows
    ]


def rewind(tables: list[str], to: date) -> dict[str, Any]:
    """Set each named table's watermark back to `to`.

    Tables already at or before `to` are left alone and reported as skipped; unknown
    names raise. Raises ValueError for a date in the future or an empty selection.
    """
    if not tables:
        raise ValueError("Pick at least one table.")
    if to > date.today():
        raise ValueError(f"{to} is in the future — a watermark can only move back.")

    with engine.begin() as conn:
        current = dict(conn.execute(
            text("SELECT table_name, last_updated_date FROM sync_state "
                 "WHERE table_name = ANY(:t) FOR UPDATE"),
            {"t": tables},
        ).all())
        unknown = sorted(set(tables) - set(current))
        if unknown:
            raise ValueError(f"No watermark for: {', '.join(unknown)}")

        changed = [t for t in tables if current[t] is None or current[t] > to]
        if changed:
            conn.execute(
                text("UPDATE sync_state SET last_updated_date = :d "
                     "WHERE table_name = ANY(:t)"),
                {"d": to, "t": changed},
            )

    return {
        "to": to.isoformat(),
        "changed": [{"table": t, "was": current[t].isoformat() if current[t] else None}
                    for t in changed],
        "skipped": sorted(set(tables) - set(changed)),
    }
