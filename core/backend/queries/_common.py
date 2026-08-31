"""Shared read helpers for the repository layer.

One place to run a parameterised SELECT and get a tidy DataFrame back. Pages and
repositories call these instead of hand-wiring connections, so behaviour (empty
frames, param binding) is consistent everywhere.

Reminder (see CLAUDE.md "Running tips"): identify a security by `permaticker`, never
by `ticker` alone — tickers recycle and repeat across product tables. `"table"` is a
reserved word and must stay quoted in raw SQL.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session


def query_df(session: Session, sql: str, params: dict | None = None) -> pd.DataFrame:
    """Run a read-only SELECT and return the result as a DataFrame."""
    return pd.read_sql_query(text(sql), session.connection(), params=params or {})


def scalar(session: Session, sql: str, params: dict | None = None):
    """Run a query and return the first column of the first row (or None)."""
    return session.execute(text(sql), params or {}).scalar()


def rows(session: Session, sql: str, params: dict | None = None) -> list[dict]:
    """Run a query and return a list of dict rows."""
    return [dict(r) for r in session.execute(text(sql), params or {}).mappings()]
