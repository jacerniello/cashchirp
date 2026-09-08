"""13F institutional holdings — Sharadar SF3 / SF3A / SF3B.

`sf3`  — holdings by investor × security × quarter (value, units).
`sf3a` — aggregated by ticker (holder counts, units, value, by security type).
`sf3b` — aggregated by investor (the investor's whole book per quarter).

A security is keyed by permaticker on `sf3`/`sf3a`; investor views key on `investorname`.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.backend.db.engine import engine
from core.backend.queries._common import query_df, scalar
from core.backend.queries._rebuild import (
    LOCK_HOLDERS,
    LOCK_INVESTOR_HOLDINGS,
    NEW,
    live_count,
    single_flight,
    swap_in,
)

# --- precomputed per-holder time series (powers the holdings bubble chart) -----
# Paginating *all* of a security's 13F holders off the 46M-row `sf3` (rank each
# holder, page through them) is far too slow live, so we materialise every SHR
# holder's quarterly positions for every security into one table, stamping each
# holder with a per-security `rank` (1 = largest by max position value over time).
# A page is then a pure indexed range scan on `(permaticker, rank)` — no join.
# Rebuilt by `core/scripts/build/build_holder_timeseries.py` and after every SF3 load;
# rebuilt by the builder / after an SF3 load. ~33M rows.
_HOLDER_TABLE = "holder_timeseries"
# Mirror of `_HOLDER_TABLE` transposed onto the institutional filer: every 13F
# filer's full quarterly position in every SHR security it has held, each security
# stamped with a per-filer `rank` (1 = the filer's largest-ever position). Powers the
# institution page's holdings-over-time bubble chart as an `(investorname, rank)`
# range scan.
_INST_HOLDINGS_TABLE = "institutional_holdings_timeseries"
_PAGE_SIZE = 10


def ownership_timeseries(session: Session, permaticker: int | str) -> pd.DataFrame:
    """Institutional ownership % over time: 13F shares held (`sf3a.shrunits`) ÷
    shares outstanding (`sf1.sharesbas`) per quarter.

    The denominator is the most recent *as-reported* (ARQ) `sharesbas` with a
    `datekey` on or before each 13F `calendardate` — point-in-time, so the ratio
    isn't contaminated by later restatements.

    Critical adjustment: 13F `shrunits` are reported **as-filed (split-unadjusted)**,
    but `sharesbas` is **retroactively split-adjusted**. Comparing them directly
    understates ownership before any split (e.g. AMZN reads ~3% pre-2022 20:1 split
    vs the real ~60%). So we restate `shrunits` onto the same split-adjusted basis
    by multiplying by the cumulative factor of all splits *after* each quarter (from
    the `actions` table). This is the most defensible "float-adjacent" figure the
    Sharadar bundle supports — true free float (which needs reliable insider-held
    shares) is not derivable here. Returns: calendardate, shrholders, shrunits,
    split_factor, adj_shrunits, sharesbas, ownership_pct.
    """
    pt = int(permaticker)
    df = query_df(
        session,
        """
        SELECT a.date AS calendardate, a.shrholders, a.shrunits,
               (SELECT f.sharesbas FROM sf1 f
                WHERE f.permaticker = a.permaticker AND f.dimension = 'ARQ'
                  AND f.sharesbas IS NOT NULL AND f.datekey <= a.date
                ORDER BY f.datekey DESC LIMIT 1) AS sharesbas
        FROM sf3a a
        WHERE a.permaticker = :pt
        ORDER BY a.date
        """,
        {"pt": pt},
    )
    if df.empty:
        return df
    splits = query_df(
        session,
        "SELECT date, value FROM actions "
        "WHERE permaticker = :pt AND action ILIKE '%split%' AND value > 0",
        {"pt": pt},
    )
    cd = pd.to_datetime(df["calendardate"])
    if splits.empty:
        df["split_factor"] = 1.0
    else:
        sdate = pd.to_datetime(splits["date"])
        sval = splits["value"].astype(float)
        # factor(q) = product of split ratios whose split date is after quarter q
        df["split_factor"] = [
            float(sval[sdate > q].prod()) if (sdate > q).any() else 1.0 for q in cd
        ]
    df["adj_shrunits"] = df["shrunits"] * df["split_factor"]
    df["ownership_pct"] = (df["adj_shrunits"] / df["sharesbas"] * 100).where(
        df["sharesbas"] > 0)
    return df


def aggregate_for_security(session: Session, permaticker: int | str) -> pd.DataFrame:
    """SF3A time series: total 13F holders / units / value held in a security."""
    return query_df(
        session,
        "SELECT date AS calendardate, shrholders, totalvalue, shrunits, shrvalue, "
        "putholders, cllholders, putvalue, cllvalue, percentoftotal "
        "FROM sf3a WHERE permaticker = :pt ORDER BY date",
        {"pt": int(permaticker)},
    )


def top_holders(
    session: Session, permaticker: int | str, calendardate=None, limit: int = 50
) -> pd.DataFrame:
    """Largest 13F holders of a security in its latest (or given) quarter."""
    params: dict = {"pt": int(permaticker), "limit": limit}
    date_clause = "date = (SELECT max(date) FROM sf3 WHERE permaticker = :pt)"
    if calendardate is not None:
        date_clause = "date = :cd"; params["cd"] = calendardate
    return query_df(
        session,
        f"""
        SELECT investorname, securitytype, value, units, price
        FROM sf3
        WHERE permaticker = :pt AND {date_clause}
        ORDER BY value DESC NULLS LAST
        LIMIT :limit
        """,
        params,
    )


_HOLDER_PAGE_LIVE_SQL = """
    WITH ranked AS (
        SELECT investorname,
               row_number() OVER (ORDER BY max(value) DESC NULLS LAST, investorname) AS rank
        FROM sf3
        WHERE permaticker = :pt AND securitytype = 'SHR'
        GROUP BY investorname
    ),
    page AS (
        SELECT investorname, rank FROM ranked WHERE rank > :lo AND rank <= :hi
    ),
    splitfac AS (
        SELECT s.calendardate, COALESCE(exp(sum(ln(a.value))), 1.0) AS factor
        FROM (SELECT DISTINCT date AS calendardate FROM sf3
              WHERE permaticker = :pt AND securitytype = 'SHR') s
        LEFT JOIN actions a
          ON a.permaticker = :pt AND a.action ILIKE '%split%'
             AND a.value > 0 AND a.date > s.calendardate
        GROUP BY s.calendardate
    )
    SELECT s.date AS calendardate, s.investorname, p.rank, s.value, s.units,
           s.units * f.factor AS adj_units, s.price
    FROM sf3 s JOIN page p USING (investorname)
    JOIN splitfac f ON f.calendardate = s.date
    WHERE s.permaticker = :pt AND s.securitytype = 'SHR'
    ORDER BY p.rank, s.date
"""


def holder_count(session: Session, permaticker: int | str) -> int:
    """How many distinct SHR 13F holders a security has had (all time) — the basis
    for pagination. Served from the precomputed table (instant via the
    `(permaticker, rank)` index), falling back to a live `sf3` count."""
    pt = int(permaticker)
    try:
        n = scalar(session, f"SELECT max(rank) FROM {_HOLDER_TABLE} WHERE permaticker = :pt",
                   {"pt": pt})
        if n is not None:
            return int(n)
    except Exception:
        pass  # table absent → live count
    n = scalar(
        session,
        "SELECT count(DISTINCT investorname) FROM sf3 "
        "WHERE permaticker = :pt AND securitytype = 'SHR'",
        {"pt": pt},
    )
    return int(n or 0)


def holder_timeseries_page(
    session: Session,
    permaticker: int | str,
    page: int = 0,
    page_size: int = _PAGE_SIZE,
) -> pd.DataFrame:
    """One page of a security's 13F holders and their full quarterly positions.

    Holders are ranked across *all* quarters by their largest-ever position value
    (rank 1 = biggest holder); `page` (0-based) selects a window of `page_size` of
    them. Returns long-format rows (calendardate, investorname, rank, value, units,
    adj_units, price) — the input for the holdings-over-time bubble chart. `units`
    is as-filed; `adj_units` is split-adjusted (use it for a continuous shares view).

    Served from the precomputed `holder_timeseries` table (a `(permaticker, rank)`
    range scan); a missing table falls back to a live build off `sf3`.
    """
    pt = int(permaticker)
    lo = max(page, 0) * page_size
    hi = lo + page_size
    try:
        df = query_df(
            session,
            f"SELECT calendardate, investorname, rank, value, units, adj_units, price "
            f"FROM {_HOLDER_TABLE} "
            f"WHERE permaticker = :pt AND rank > :lo AND rank <= :hi "
            f"ORDER BY rank, calendardate",
            {"pt": pt, "lo": lo, "hi": hi},
        )
        if not df.empty:
            return df
    except Exception:
        pass  # table absent → live build below
    return query_df(session, _HOLDER_PAGE_LIVE_SQL, {"pt": pt, "lo": lo, "hi": hi})


def refresh_holder_timeseries(session: Session) -> int:
    """Rebuild the `holder_timeseries` table from `sf3` and return its row count.

    For every security, ranks each SHR holder by its largest-ever position value
    and materialises every holder's full quarterly series with that `rank`. Stamped
    with `asof` = the max 13F `calendardate` at build time. Idempotent — safe to
    call after every SF3 load (~33M rows; takes a few minutes).

    Single-flight + atomic swap: only one process builds at a time (others skip); the
    ~33M-row CTAS goes into `…__new` off the live table and is swapped in with a brief
    metadata lock, so the app's holdings queries never block for minutes on a rebuild."""
    asof = scalar(session, "SELECT max(date) FROM sf3a")
    # `adj_units` restates as-filed 13F share counts onto the current split-adjusted
    # basis (× the product of splits *after* each quarter) so the holdings-over-time
    # "shares" view is continuous across splits instead of jumping 7×/4× (e.g. AAPL).
    # `splitfac` precomputes one factor per (permaticker, quarter) from the small
    # `actions` table, then hash-joins onto the 33M-row body. `units` stays as-filed.
    ctas = text(
        f"""
        CREATE TABLE {_HOLDER_TABLE}{NEW} AS
        WITH ranked AS (
            SELECT permaticker, investorname,
                   row_number() OVER (PARTITION BY permaticker
                                      ORDER BY max(value) DESC NULLS LAST, investorname) AS rank
            FROM sf3
            WHERE permaticker IS NOT NULL AND securitytype = 'SHR'
            GROUP BY permaticker, investorname
        ),
        qdates AS (
            SELECT DISTINCT permaticker, date AS calendardate
            FROM sf3 WHERE permaticker IS NOT NULL AND securitytype = 'SHR'
        ),
        splitfac AS (
            SELECT q.permaticker, q.calendardate,
                   COALESCE(exp(sum(ln(a.value))), 1.0) AS factor
            FROM qdates q
            LEFT JOIN actions a
              ON a.permaticker = q.permaticker AND a.action ILIKE '%split%'
                 AND a.value > 0 AND a.date > q.calendardate
            GROUP BY q.permaticker, q.calendardate
        )
        SELECT s.permaticker, s.investorname, r.rank, s.date AS calendardate,
               s.value, s.units, s.units * f.factor AS adj_units, s.price,
               CAST(:asof AS date) AS asof
        FROM sf3 s
        JOIN ranked r
          ON s.permaticker = r.permaticker AND s.investorname = r.investorname
        JOIN splitfac f
          ON f.permaticker = s.permaticker AND f.calendardate = s.date
        WHERE s.securitytype = 'SHR'
        """
    )
    idx_new = f"ix_{_HOLDER_TABLE}_permaticker_rank{NEW}"
    with single_flight(LOCK_HOLDERS) as mine:
        if not mine:  # another worker is rebuilding — don't stampede
            return live_count(_HOLDER_TABLE)
        # Build off the live table (no lock on holder_timeseries), then swap atomically.
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_HOLDER_TABLE}{NEW}"))
            conn.execute(ctas, {"asof": asof})
            conn.execute(text(f"CREATE INDEX {idx_new} ON {_HOLDER_TABLE}{NEW} (permaticker, rank)"))
        with engine.begin() as conn:
            swap_in(conn, _HOLDER_TABLE,
                    ((idx_new, f"ix_{_HOLDER_TABLE}_permaticker_rank"),))
    return live_count(_HOLDER_TABLE)


def investor_book(session: Session, investorname: str) -> pd.DataFrame:
    """SF3B time series for one investor: total book value and composition by quarter."""
    return query_df(
        session,
        "SELECT date AS calendardate, totalvalue, shrvalue, cllvalue, putvalue, "
        "shrholdings, cllholdings, putholdings, shrunits "
        "FROM sf3b WHERE investorname = :inv ORDER BY date",
        {"inv": investorname},
    )


def investor_sector_history(
    session: Session, investorname: str, securitytype: str = "SHR"
) -> pd.DataFrame:
    """Value held by sector, per quarter, for one 13F filer (long format:
    calendardate, sector, value in $). Sector comes from the security master
    (`tickers`), deduped to one sector per permaticker. Powers the holdings-by-sector
    stacked bar; positions whose issuer has no sector fall into 'Unknown'."""
    return query_df(
        session,
        """
        SELECT s.date AS calendardate,
               COALESCE(t.sector, 'Unknown') AS sector,
               sum(s.value) AS value
        FROM sf3 s
        LEFT JOIN (
            SELECT DISTINCT ON (permaticker) permaticker, sector
            FROM tickers WHERE permaticker IS NOT NULL
            ORDER BY permaticker, sector NULLS LAST
        ) t ON t.permaticker::bigint = s.permaticker
        WHERE s.investorname = :inv AND s.securitytype = :st
        GROUP BY s.date, COALESCE(t.sector, 'Unknown')
        ORDER BY s.date
        """,
        {"inv": investorname, "st": securitytype},
    )


_INVESTOR_HOLDINGS_PAGE_SQL = """
    WITH ranked AS (
        SELECT permaticker,
               row_number() OVER (ORDER BY max(value) DESC NULLS LAST, permaticker) AS rank
        FROM sf3
        WHERE investorname = :inv AND securitytype = 'SHR' AND permaticker IS NOT NULL
        GROUP BY permaticker
    ),
    page AS (
        SELECT permaticker, rank FROM ranked WHERE rank > :lo AND rank <= :hi
    ),
    splitfac AS (
        SELECT s.permaticker, s.calendardate,
               COALESCE(exp(sum(ln(a.value))), 1.0) AS factor
        FROM (SELECT DISTINCT permaticker, date AS calendardate FROM sf3
              WHERE investorname = :inv AND securitytype = 'SHR'
                AND permaticker IS NOT NULL) s
        LEFT JOIN actions a
          ON a.permaticker = s.permaticker AND a.action ILIKE '%split%'
             AND a.value > 0 AND a.date > s.calendardate
        GROUP BY s.permaticker, s.calendardate
    )
    SELECT s.date AS calendardate, s.ticker, s.permaticker, p.rank, s.value, s.units,
           s.units * f.factor AS adj_units, s.price
    FROM sf3 s JOIN page p USING (permaticker)
    JOIN splitfac f ON f.permaticker = s.permaticker AND f.calendardate = s.date
    WHERE s.investorname = :inv AND s.securitytype = 'SHR'
    ORDER BY p.rank, s.date
"""


def investor_holding_count(session: Session, investorname: str) -> int:
    """How many distinct SHR securities a 13F filer has ever held — the basis for
    paginating the investor's holdings-over-time bubble chart. Served from the
    precomputed `investor_holdings_timeseries` table (instant via the
    `(investorname, rank)` index), falling back to a live `sf3` count."""
    try:
        n = scalar(
            session,
            f"SELECT max(rank) FROM {_INST_HOLDINGS_TABLE} WHERE investorname = :inv",
            {"inv": investorname},
        )
        if n is not None:
            return int(n)
    except Exception:
        pass  # table absent → live count
    n = scalar(
        session,
        "SELECT count(DISTINCT permaticker) FROM sf3 "
        "WHERE investorname = :inv AND securitytype = 'SHR' AND permaticker IS NOT NULL",
        {"inv": investorname},
    )
    return int(n or 0)


def investor_holdings_timeseries_page(
    session: Session,
    investorname: str,
    page: int = 0,
    page_size: int = _PAGE_SIZE,
) -> pd.DataFrame:
    """One page of a 13F filer's held securities and their full quarterly positions —
    the inverse of `holder_timeseries_page` (securities held by an investor, not
    holders of a security). Securities are ranked across all quarters by the filer's
    largest-ever position value (rank 1 = biggest); `page` (0-based) selects a window
    of `page_size`. Returns long-format rows (calendardate, ticker, permaticker, rank,
    value, units, adj_units, price) — the input for the investor page's holdings-over-
    time bubble chart. `units` is as-filed; `adj_units` is split-adjusted (× the
    product of each security's splits *after* each quarter) for a continuous shares
    view.

    Served from the precomputed `investor_holdings_timeseries` table (an
    `(investorname, rank)` range scan); a missing table falls back to a live build
    off `sf3`."""
    lo = max(page, 0) * page_size
    hi = lo + page_size
    try:
        df = query_df(
            session,
            f"SELECT calendardate, ticker, permaticker, rank, value, units, adj_units, price "
            f"FROM {_INST_HOLDINGS_TABLE} "
            f"WHERE investorname = :inv AND rank > :lo AND rank <= :hi "
            f"ORDER BY rank, calendardate",
            {"inv": investorname, "lo": lo, "hi": hi},
        )
        if not df.empty:
            return df
    except Exception:
        pass  # table absent → live build below
    return query_df(
        session, _INVESTOR_HOLDINGS_PAGE_SQL, {"inv": investorname, "lo": lo, "hi": hi}
    )


def refresh_investor_holdings_timeseries(session: Session) -> int:
    """Rebuild the `investor_holdings_timeseries` table from `sf3` and return its row
    count — the per-investor transpose of `refresh_holder_timeseries`.

    For every 13F filer, ranks each SHR security it has held by the filer's largest-
    ever position value and materialises that security's full quarterly series with
    the `rank`. Stamped with `asof` = the max 13F `calendardate` at build time.
    Idempotent — safe to call after every SF3 load (~33M rows; takes a few minutes).

    Single-flight + atomic swap (see `refresh_holder_timeseries`): only one process
    builds at a time, the CTAS goes into `…__new` off the live table, and the swap-in
    takes only a brief metadata lock so readers never block on the rebuild."""
    asof = scalar(session, "SELECT max(date) FROM sf3a")
    # `splitfac` precomputes one split factor per (permaticker, quarter) from the small
    # `actions` table (× the product of splits *after* each quarter), then hash-joins
    # onto the 33M-row body to produce a continuous split-adjusted `adj_units`. `units`
    # stays as-filed. Same logic as the holder table — only the ranking partition differs.
    ctas = text(
        f"""
        CREATE TABLE {_INST_HOLDINGS_TABLE}{NEW} AS
        WITH ranked AS (
            SELECT investorname, permaticker,
                   row_number() OVER (PARTITION BY investorname
                                      ORDER BY max(value) DESC NULLS LAST, permaticker) AS rank
            FROM sf3
            WHERE permaticker IS NOT NULL AND securitytype = 'SHR'
            GROUP BY investorname, permaticker
        ),
        qdates AS (
            SELECT DISTINCT permaticker, date AS calendardate
            FROM sf3 WHERE permaticker IS NOT NULL AND securitytype = 'SHR'
        ),
        splitfac AS (
            SELECT q.permaticker, q.calendardate,
                   COALESCE(exp(sum(ln(a.value))), 1.0) AS factor
            FROM qdates q
            LEFT JOIN actions a
              ON a.permaticker = q.permaticker AND a.action ILIKE '%split%'
                 AND a.value > 0 AND a.date > q.calendardate
            GROUP BY q.permaticker, q.calendardate
        )
        SELECT s.investorname, s.permaticker, s.ticker, r.rank, s.date AS calendardate,
               s.value, s.units, s.units * f.factor AS adj_units, s.price,
               CAST(:asof AS date) AS asof
        FROM sf3 s
        JOIN ranked r
          ON s.investorname = r.investorname AND s.permaticker = r.permaticker
        JOIN splitfac f
          ON f.permaticker = s.permaticker AND f.calendardate = s.date
        WHERE s.securitytype = 'SHR'
        """
    )
    idx_new = f"ix_{_INST_HOLDINGS_TABLE}_investorname_rank{NEW}"
    with single_flight(LOCK_INVESTOR_HOLDINGS) as mine:
        if not mine:  # another worker is rebuilding — don't stampede
            return live_count(_INST_HOLDINGS_TABLE)
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_INST_HOLDINGS_TABLE}{NEW}"))
            conn.execute(ctas, {"asof": asof})
            conn.execute(
                text(f"CREATE INDEX {idx_new} ON {_INST_HOLDINGS_TABLE}{NEW} (investorname, rank)")
            )
        with engine.begin() as conn:
            swap_in(conn, _INST_HOLDINGS_TABLE,
                    ((idx_new, f"ix_{_INST_HOLDINGS_TABLE}_investorname_rank"),))
    return live_count(_INST_HOLDINGS_TABLE)


def investor_holdings(
    session: Session, investorname: str, calendardate=None, limit: int = 100
) -> pd.DataFrame:
    """An investor's positions (by security) in its latest (or given) quarter."""
    params: dict = {"inv": investorname, "limit": limit}
    date_clause = (
        "date = (SELECT max(date) FROM sf3 WHERE investorname = :inv)"
    )
    if calendardate is not None:
        date_clause = "date = :cd"; params["cd"] = calendardate
    return query_df(
        session,
        f"""
        SELECT ticker, permaticker, securitytype, value, units, price
        FROM sf3
        WHERE investorname = :inv AND {date_clause}
        ORDER BY value DESC NULLS LAST
        LIMIT :limit
        """,
        params,
    )


def investor_holding_quarters(session: Session, investorname: str) -> list[str]:
    """Every 13F quarter a filer has reported, newest first — populates the reported-
    holdings quarter selector. Indexed range over `(investorname, date)`."""
    df = query_df(
        session,
        "SELECT DISTINCT date AS calendardate FROM sf3 WHERE investorname = :inv "
        "ORDER BY date DESC",
        {"inv": investorname},
    )
    if df.empty:
        return []
    return df["calendardate"].astype(str).tolist()


def investor_holdings_count(session: Session, investorname: str, calendardate) -> int:
    """How many positions a filer reported in one quarter — the basis for paginating
    the reported-holdings table."""
    n = scalar(
        session,
        "SELECT count(*) FROM sf3 WHERE investorname = :inv AND date = :cd",
        {"inv": investorname, "cd": calendardate},
    )
    return int(n or 0)


def investor_holdings_page(
    session: Session,
    investorname: str,
    calendardate,
    page: int = 0,
    page_size: int = 25,
) -> pd.DataFrame:
    """One page of a filer's reported positions for a given quarter (all security
    types), largest value first — the paginated reported-holdings table. Each row
    carries permaticker for company links."""
    offset = max(page, 0) * page_size
    return query_df(
        session,
        """
        SELECT ticker, permaticker, securitytype, value, units, price
        FROM sf3
        WHERE investorname = :inv AND date = :cd
        ORDER BY value DESC NULLS LAST
        LIMIT :limit OFFSET :offset
        """,
        {"inv": investorname, "cd": calendardate, "limit": page_size, "offset": offset},
    )
