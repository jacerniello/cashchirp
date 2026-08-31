"""Corporate events (`events` / `events_decoded`) and corporate actions (`actions`,
`sp500`).

`events`        — 8-K event codes per (ticker, date); `eventcodes` is a pipe list.
`events_decoded`— view expanding those codes into labels.
`event_codes`   — the code → label legend.
`actions`       — splits / dividends / etc. per security.
`sp500`         — S&P 500 membership add/remove log.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df


def for_security(session: Session, permaticker: int | str, limit: int = 500) -> pd.DataFrame:
    """Decoded 8-K events for one security, most recent first.

    Decoding happens *after* the permaticker filter + LIMIT, not via the
    `events_decoded` view: that view aggregates `GROUP BY ticker, date` over the
    whole table, so joining it makes Postgres decode the security's entire event
    history (and on the recycle-prone `ticker`) just to label the page we return.
    Here the inner query picks the ≤`limit` rows for this permaticker, then a
    correlated unnest expands each row's pipe-codes against the tiny `event_codes`
    legend — so the decode runs ~`limit` times on 2–3 codes, not over all history.
    """
    return query_df(
        session,
        """
        SELECT e.date, e.eventcodes,
               COALESCE((
                   SELECT string_agg(ec.title, ' · ' ORDER BY c.ord)
                   FROM unnest(string_to_array(e.eventcodes, '|'))
                        WITH ORDINALITY c(code, ord)
                   LEFT JOIN event_codes ec ON ec.code = c.code
               ), e.eventcodes) AS labels
        FROM (
            SELECT date, eventcodes FROM events
            WHERE permaticker = :pt
            ORDER BY date DESC
            LIMIT :limit
        ) e
        ORDER BY e.date DESC
        """,
        {"pt": int(permaticker), "limit": limit},
    )


def actions_for_security(
    session: Session, permaticker: int | str, limit: int = 300
) -> pd.DataFrame:
    return query_df(
        session,
        "SELECT date, action, value, contraticker, contraname, name "
        "FROM actions WHERE permaticker = :pt ORDER BY date DESC LIMIT :limit",
        {"pt": int(permaticker), "limit": limit},
    )


def sp500_membership(session: Session, permaticker: int | str) -> pd.DataFrame:
    return query_df(
        session,
        "SELECT date, action, name FROM sp500 WHERE permaticker = :pt ORDER BY date",
        {"pt": int(permaticker)},
    )


