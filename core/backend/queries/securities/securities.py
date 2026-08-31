"""Security master (the `tickers` reference table) — search, filter, and per-security
profile lookups.

A security is identified by **`permaticker`** (stable issuer id), never by `ticker`
alone — symbols recycle and repeat across Sharadar product tables. The `tickers` table
keys on `(ticker, "table", permaticker)`, so one company can have several rows (one per
product it appears in, e.g. SEP + SF1). We collapse to one profile row per permaticker,
preferring the SEP (equity-price) row, then SF1, then anything.
"""
from __future__ import annotations

import re

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df, rows

# Preference order when a permaticker has rows from several product tables.
_TABLE_RANK = "CASE \"table\" WHEN 'SEP' THEN 0 WHEN 'SF1' THEN 1 " \
    "WHEN 'SFP' THEN 2 WHEN 'SF3B' THEN 3 ELSE 4 END"

# One canonical profile row per permaticker (best product row wins).
_CANON = f"""
    SELECT DISTINCT ON (permaticker)
        permaticker, ticker, "table", name, exchange, category, isdelisted,
        sector, industry, sicsector, sicindustry, famaindustry,
        scalemarketcap, scalerevenue, currency, location, siccode, cusips,
        relatedtickers, companysite, secfilings,
        firstpricedate, lastpricedate, firstquarter, lastquarter, firstadded
    FROM tickers
    WHERE permaticker IS NOT NULL
    ORDER BY permaticker, {_TABLE_RANK}
"""


def search(
    session: Session,
    *,
    q: str | None = None,
    sector: str | None = None,
    exchange: str | None = None,
    category: str | None = None,
    scalemarketcap: str | None = None,
    include_delisted: bool = True,
    limit: int = 500,
) -> pd.DataFrame:
    """Search the security master. `q` matches ticker or name, case-insensitive.
    Ticker is favoured: an exact ticker (`GME` → GameStop) ranks first, then ticker
    prefixes, then name matches — so symbol lookups win while free-text still works.
    Returns one row per permaticker."""
    # The security master also carries 13F filers (category 'Institutional Investor',
    # ticker 'N/A') — those belong to the Investors scope, not company search.
    where = ["c.category IS DISTINCT FROM 'Institutional Investor'"]
    params: dict = {"limit": limit}
    order = []
    if q:
        where.append("(upper(c.ticker) LIKE :qpre OR upper(c.name) LIKE :qsub)")
        params["qexact"] = q.upper()
        params["qpre"] = f"{q.upper()}%"
        params["qsub"] = f"%{q.upper()}%"
        # Relevance: exact ticker → ticker prefix → name prefix → name substring.
        order.append("""CASE
                    WHEN upper(c.ticker) = :qexact THEN 0
                    WHEN upper(c.ticker) LIKE :qpre THEN 1
                    WHEN upper(c.name) LIKE :qpre THEN 2
                    ELSE 3 END""")
    for col, val in (
        ("sector", sector), ("exchange", exchange),
        ("category", category), ("scalemarketcap", scalemarketcap),
    ):
        if val:
            where.append(f'c."{col}" = :{col}')
            params[col] = val
    if not include_delisted:
        where.append("c.isdelisted = 'N'")

    # Within a relevance tier, surface live names by real market cap (from the
    # precomputed screener_snapshot — one indexed row per security, so the join is
    # cheap), falling back to the coarse scale bucket when marketcap is unknown.
    order += [
        "(c.isdelisted = 'N') DESC NULLS LAST",
        "ss.marketcap DESC NULLS LAST",
        """CASE c.scalemarketcap
              WHEN '6 - Mega' THEN 0 WHEN '5 - Large' THEN 1
              WHEN '4 - Mid' THEN 2 WHEN '3 - Small' THEN 3
              WHEN '2 - Micro' THEN 4 WHEN '1 - Nano' THEN 5 ELSE 6 END""",
        "c.ticker",
    ]
    sql = f"""
        WITH canon AS ({_CANON})
        SELECT c.permaticker, c.ticker, c.name, c.exchange, c.sector, c.industry,
               c.category, c.scalemarketcap, c.isdelisted, c.currency, c.location,
               c.firstpricedate, c.lastpricedate
        FROM canon c
        LEFT JOIN screener_snapshot ss ON ss.permaticker = c.permaticker::bigint
        WHERE {' AND '.join(where)}
        ORDER BY {', '.join(order)}
        LIMIT :limit
    """
    return query_df(session, sql, params)


def get_profile(session: Session, permaticker: int | str) -> dict | None:
    """Full reference profile for one security (by permaticker)."""
    sql = f"WITH canon AS ({_CANON}) SELECT * FROM canon WHERE permaticker = :pt"
    res = rows(session, sql, {"pt": str(permaticker)})
    return res[0] if res else None


def fund_family(session: Session, permaticker: int | str) -> dict | None:
    """A fund's parent SEC filer (CIK) and its family of series + share classes, for the
    fund page's family navigation. The CIK is parsed from the fund's `secfilings` EDGAR
    link; the series/class structure comes from `sec_fund_class` (the SEC
    `company_tickers_mf.json` map). Share classes we carry are linked by `permaticker`;
    series names are taken from our fund name on any carried class. Returns None if the
    fund has no CIK or `sec_fund_class` isn't loaded."""
    prof = get_profile(session, permaticker)
    if not prof:
        return None
    m = re.search(r"CIK=0*(\d+)", prof.get("secfilings") or "")
    if not m:
        return None
    cik = int(m.group(1))
    df = query_df(
        session,
        """
        WITH ours AS (
            SELECT DISTINCT ON (upper(ticker)) upper(ticker) AS sym,
                   permaticker, name AS our_name, category
            FROM tickers WHERE ticker IS NOT NULL
            ORDER BY upper(ticker),
                     CASE WHEN category = 'ETF' THEN 0 ELSE 1 END,
                     lastpricedate DESC NULLS LAST
        )
        SELECT f.series_id, f.class_id, f.symbol,
               o.permaticker, o.our_name, o.category
        FROM sec_fund_class f
        LEFT JOIN ours o ON o.sym = upper(f.symbol)
        WHERE f.cik = :cik
        ORDER BY f.series_id, f.class_id
        """,
        {"cik": cik},
    )
    if df.empty:
        return {"cik": cik, "cik_padded": f"{cik:010d}", "series": [],
                "edgar_url": _edgar_cik_url(cik)}
    target = str(permaticker)
    series = []
    for sid, g in df.groupby("series_id", sort=True):
        name = None
        classes = []
        for r in g.to_dict("records"):
            perma = r["permaticker"]
            perma_str = str(int(perma)) if pd.notna(perma) else None
            our_name = r["our_name"] if pd.notna(r["our_name"]) else None
            if our_name and not name:
                name = our_name
            classes.append({
                "class_id": r["class_id"],
                "symbol": r["symbol"],
                "permaticker": perma_str,
                "name": our_name,
                "is_etf": (r["category"] == "ETF"),
                "in_universe": perma_str is not None,
                "is_current": perma_str == target,
            })
        series.append({"series_id": sid, "name": name, "classes": classes})
    # The fund's own series first, then the rest.
    series.sort(key=lambda s: (not any(c["is_current"] for c in s["classes"]), s["series_id"]))
    return {"cik": cik, "cik_padded": f"{cik:010d}", "edgar_url": _edgar_cik_url(cik),
            "series": series}


def _edgar_cik_url(cik: int) -> str:
    return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik:010d}"


def resolve_ticker(session: Session, ticker: str) -> dict | None:
    """Best-guess permaticker for a bare ticker (newest equity row). Convenience for
    deep-linking from a symbol; the canonical handle is still permaticker."""
    res = rows(
        session,
        f"""WITH canon AS ({_CANON})
            SELECT permaticker, ticker, name FROM canon
            WHERE upper(ticker) = :t LIMIT 1""",
        {"t": ticker.upper()},
    )
    return res[0] if res else None
