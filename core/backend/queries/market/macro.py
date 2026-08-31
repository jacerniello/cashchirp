"""FRED macro panels — `fred_series` (catalogue) and `fred_observations` (values).

Observations are **point-in-time**: each value carries a `vintage` (the release in which
it appeared). The UI defaults to the latest vintage per date but can pin a vintage so
series stay backtest-safe (see CLAUDE.md / the FRED point-in-time memory).
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df


def catalogue(session: Session, dataset: str | None = None) -> pd.DataFrame:
    where = ""
    params: dict = {}
    if dataset:
        where = "WHERE dataset = :ds"; params["ds"] = dataset
    return query_df(
        session,
        f"SELECT series_id, dataset, tcode, title, fred_code FROM fred_series {where} "
        "ORDER BY dataset, series_id",
        params,
    )


def series_title(session: Session, series_id: str) -> str | None:
    """The human-readable FRED title for one series (None if not yet backfilled)."""
    df = query_df(
        session,
        "SELECT title FROM fred_series WHERE series_id = :s",
        {"s": series_id},
    )
    return df["title"].iloc[0] if not df.empty else None


def fred_url(series_id: str, fred_code: str | None = None) -> str:
    """Where to read a series' official description on FRED.

    With a confirmed `fred_code`, link straight to that series page; otherwise fall
    back to a FRED search for the mnemonic, so every series still resolves to a
    description (e.g. the McCracken-adjusted or `S&P …` series we couldn't map)."""
    if fred_code:
        return f"https://fred.stlouisfed.org/series/{fred_code}"
    from urllib.parse import quote_plus

    return f"https://fred.stlouisfed.org/searchresults/?st={quote_plus(series_id)}"


def datasets(session: Session) -> list[str]:
    df = query_df(session, "SELECT DISTINCT dataset FROM fred_series ORDER BY dataset")
    return df["dataset"].tolist()


def vintages(session: Session, series_id: str) -> list[str]:
    df = query_df(
        session,
        "SELECT DISTINCT vintage FROM fred_observations WHERE series_id = :s "
        "ORDER BY vintage DESC",
        {"s": series_id},
    )
    return df["vintage"].tolist()


def observations(
    session: Session, series_id: str, vintage: str | None = None
) -> pd.DataFrame:
    """Time series for one FRED series. With `vintage`, returns that release exactly
    (point-in-time); without, the latest value per date (most-revised snapshot)."""
    if vintage:
        return query_df(
            session,
            "SELECT date, value FROM fred_observations "
            "WHERE series_id = :s AND vintage = :v ORDER BY date",
            {"s": series_id, "v": vintage},
        )
    return query_df(
        session,
        """
        SELECT DISTINCT ON (date) date, value
        FROM fred_observations
        WHERE series_id = :s
        ORDER BY date, vintage DESC
        """,
        {"s": series_id},
    )
