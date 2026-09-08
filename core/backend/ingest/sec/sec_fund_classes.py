"""SEC mutual-fund ticker map -> `sec_fund_class`.

Source: https://www.sec.gov/files/company_tickers_mf.json — one row per registered fund
share class: `(cik, seriesId, classId, symbol)`. This is the structure behind EDGAR's
"Series for CIK = …" page: a filer CIK owns many Series (funds), each with several
Class/Contract share classes, some of which carry a ticker symbol. It lets the fund page
show a fund's parent CIK and its full family of sibling series/classes (incl. mutual-fund
classes we don't carry as ETFs).

Reference data, changes slowly, and small enough to reload whole — so this drops and
recreates the table rather than diffing it.

Driven by the `SEC fund-class map`
step in `update_all` / `bootstrap`.
"""
from __future__ import annotations

import json
import urllib.request

from sqlalchemy import text

from core.backend.db.engine import engine
from core.config import settings

URL = "https://www.sec.gov/files/company_tickers_mf.json"

# SEC blocks requests without a descriptive User-Agent carrying a real contact (403).
# Set SEC_USER_AGENT in core/.env — see docs/CONFIGURATION.md.
USER_AGENT = settings.sec_user_agent


def fetch() -> list[dict]:
    """Download and flatten the fund-class map."""
    # Fail with the real cause. An unset UA gets an opaque 403 from SEC that reads like a
    # network or outage problem, and you would debug the wrong thing.
    if not USER_AGENT.strip():
        raise SystemExit(
            "SEC_USER_AGENT is not set. SEC EDGAR rejects requests without a descriptive\n"
            "User-Agent containing a real contact. Set it in core/.env, e.g.\n"
            '  SEC_USER_AGENT="Jane Doe jane@example.com"'
        )
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        doc = json.load(resp)
    out = []
    for cik, series_id, class_id, symbol in doc["data"]:
        out.append({
            "cik": int(cik),
            "series_id": (series_id or None),
            "class_id": (class_id or None),
            "symbol": (symbol or None),
        })
    return out


def load() -> int:
    """Full reload of `sec_fund_class`. Returns the row count."""
    rows = fetch()
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS sec_fund_class"))
        conn.execute(text(
            "CREATE TABLE sec_fund_class ("
            " cik bigint, series_id text, class_id text, symbol text)"
        ))
        conn.execute(
            text("INSERT INTO sec_fund_class (cik, series_id, class_id, symbol) "
                 "VALUES (:cik, :series_id, :class_id, :symbol)"),
            rows,
        )
        conn.execute(text("CREATE INDEX ix_sec_fund_class_cik ON sec_fund_class (cik)"))
        conn.execute(text(
            "CREATE INDEX ix_sec_fund_class_symbol ON sec_fund_class (upper(symbol))"))
    return len(rows)
