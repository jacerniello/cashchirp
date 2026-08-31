"""Price queries for the UI — read from the flat `sep` (equities) and `sfp` (funds)
mirrors.

These are faithful Sharadar price tables (loaded by the generic loader). `closeadj` is
exposed as `adj_close` for charting. Lookups are by **permaticker** (stable, indexed) for
a specific company, or by `ticker` for the simple symbol picker. See CLAUDE.md: never use
`ticker` as a unique id.
"""
from datetime import date

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df, rows

_COLS = "date, open, high, low, close, closeadj AS adj_close, closeunadj, volume"


def _prices(
    session: Session, table: str, where: str, params: dict,
    start: date | None, end: date | None,
) -> pd.DataFrame:
    sql = f"SELECT {_COLS} FROM {table} WHERE {where}"
    if start is not None:
        sql += " AND date >= :start"
        params["start"] = start
    if end is not None:
        sql += " AND date <= :end"
        params["end"] = end
    sql += " ORDER BY date"
    df = query_df(session, sql, params)
    if df.empty:
        df = pd.DataFrame(
            columns=["date", "open", "high", "low", "close", "adj_close",
                     "closeunadj", "volume"]
        )
    return df


def get_prices_by_permaticker(
    session: Session, permaticker: int | str,
    start: date | None = None, end: date | None = None, table: str = "sep",
) -> pd.DataFrame:
    """OHLCV for one security by its stable permaticker (preferred)."""
    t = "sfp" if table == "sfp" else "sep"
    return _prices(session, t, "permaticker = :pt", {"pt": int(permaticker)}, start, end)


def price_summary(session: Session, permaticker: int | str) -> dict | None:
    """Headline price stats for a security: last close, 1d/ytd/52w context."""
    res = rows(
        session,
        """
        WITH p AS (
            SELECT date, closeadj AS c, volume FROM sep WHERE permaticker = :pt
            UNION ALL
            SELECT date, closeadj AS c, volume FROM sfp WHERE permaticker = :pt
        ),
        last2 AS (SELECT c, date FROM p ORDER BY date DESC LIMIT 2),
        w52 AS (
            SELECT max(c) AS hi, min(c) AS lo
            FROM p WHERE date >= (SELECT max(date) FROM p) - INTERVAL '52 weeks'
        ),
        yr AS (
            SELECT c FROM p
            WHERE date <= date_trunc('year', (SELECT max(date) FROM p))
            ORDER BY date DESC LIMIT 1
        )
        SELECT
            (SELECT c FROM last2 ORDER BY date DESC LIMIT 1) AS last_close,
            (SELECT date FROM last2 ORDER BY date DESC LIMIT 1) AS last_date,
            (SELECT c FROM last2 ORDER BY date ASC LIMIT 1)  AS prev_close,
            (SELECT hi FROM w52) AS high_52w,
            (SELECT lo FROM w52) AS low_52w,
            (SELECT c FROM yr) AS year_open
        """,
        {"pt": int(permaticker)},
    )
    return res[0] if res else None


def etf_metrics(session: Session, permaticker: int | str) -> dict | None:
    """Price-derived headline stats for a fund/ETF (reads `sfp`). Returns last close +
    date, nominal 52-week range (raw `close`), 90-day avg volume, total-return windows
    (1m/3m/6m/1y/5y, via `closeadj`), and inception (first price) date + return-since.
    Computed on the fly — `sfp` is permaticker-indexed so a single fund is a few ms; no
    derived table needed. Returns are decimals (0.12 = +12%)."""
    res = rows(
        session,
        """
        WITH p AS (
            SELECT date, close AS px, closeadj AS c, volume AS v
            FROM sfp WHERE permaticker = :pt
        ),
        mx AS (SELECT max(date) AS d FROM p)
        SELECT
            (SELECT px   FROM p ORDER BY date DESC LIMIT 1)                       AS last_close,
            (SELECT date FROM p ORDER BY date DESC LIMIT 1)                       AS last_date,
            (SELECT date FROM p ORDER BY date ASC  LIMIT 1)                       AS inception_date,
            (SELECT max(px) FROM p WHERE date >= (SELECT d FROM mx) - INTERVAL '52 weeks') AS high_52w,
            (SELECT min(px) FROM p WHERE date >= (SELECT d FROM mx) - INTERVAL '52 weeks') AS low_52w,
            (SELECT avg(v) FROM (SELECT v FROM p ORDER BY date DESC LIMIT 90) z)  AS avg_volume_90d,
            (SELECT c FROM p ORDER BY date DESC LIMIT 1)                          AS c_last,
            (SELECT c FROM p ORDER BY date ASC  LIMIT 1)                          AS c_first,
            (SELECT c FROM p WHERE date <= (SELECT d FROM mx) - INTERVAL '1 month'  ORDER BY date DESC LIMIT 1) AS c_1m,
            (SELECT c FROM p WHERE date <= (SELECT d FROM mx) - INTERVAL '3 months' ORDER BY date DESC LIMIT 1) AS c_3m,
            (SELECT c FROM p WHERE date <= (SELECT d FROM mx) - INTERVAL '6 months' ORDER BY date DESC LIMIT 1) AS c_6m,
            (SELECT c FROM p WHERE date <= (SELECT d FROM mx) - INTERVAL '1 year'   ORDER BY date DESC LIMIT 1) AS c_1y,
            (SELECT c FROM p WHERE date <= (SELECT d FROM mx) - INTERVAL '5 years'  ORDER BY date DESC LIMIT 1) AS c_5y
        """,
        {"pt": int(permaticker)},
    )
    if not res or res[0].get("last_close") is None:
        return None
    r = res[0]

    def _ret(base):
        c_last = r.get("c_last")
        if base in (None, 0) or c_last is None:
            return None
        return c_last / base - 1.0

    return {
        "last_close": r["last_close"],
        "last_date": r["last_date"],
        "inception_date": r["inception_date"],
        "high_52w": r["high_52w"],
        "low_52w": r["low_52w"],
        "avg_volume_90d": r["avg_volume_90d"],
        "return_1m": _ret(r.get("c_1m")),
        "return_3m": _ret(r.get("c_3m")),
        "return_6m": _ret(r.get("c_6m")),
        "return_1y": _ret(r.get("c_1y")),
        "return_5y": _ret(r.get("c_5y")),
        "return_inception": _ret(r.get("c_first")),
    }
