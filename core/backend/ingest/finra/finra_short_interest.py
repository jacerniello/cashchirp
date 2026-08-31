"""Ingest FINRA Consolidated Equity Short Interest into Postgres.

FINRA's `otcMarket/consolidatedShortInterest` Query API is **public** — no OAuth,
no API key (verified). It serves one consolidated view of short positions across
all U.S. markets (NYSE/Nasdaq/ARCA/AMEX/Cboe/OTC), bi-monthly (mid-month +
end-of-month settlement), **2017-12-29 → present** (~24 settlement dates/yr,
~19k symbols/date, ~3.8M rows total). This is the squeeze signal the Sharadar
bundle lacks and DFV weighted heavily — including GME's full Jan-2021 squeeze.

API mechanics (the non-obvious bits):
- `POST /data/group/otcMarket/name/consolidatedShortInterest` with
  `Accept: application/json` (it defaults to CSV otherwise).
- Pagination via `limit` (max 5000/sync page), `offset`, and the `Record-Total`
  response header. ~4 pages per settlement date.
- **`settlementDate` is the partition key**: you may only sort/page *within* a
  single date pinned by an EQUAL `compareFilter`, and the global `offset` caps at
  500k (< the 3.8M total). So we load **date-by-date**, which also makes
  incremental sync trivial — enumerate settlement dates, skip ≤ watermark.

Fidelity (CLAUDE.md): values stored verbatim. The feed has no CUSIP/permaticker/
float/shares, so we mirror *only* FINRA's fields and resolve `permaticker` at
read time via the `finra_short_interest_resolved` view (a point-in-time symbol→
issuer join) — nothing derived is materialized here. Short-%-of-float is likewise
computed at read time against `sf1`/`daily`.

    backfill_short_interest()   # full 2017-12-29 → present
    sync_short_interest()       # only settlement dates past the watermark
"""
from __future__ import annotations

from datetime import date, datetime

import requests
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from core.backend.db.engine import session_scope
from core.backend.db.models import FinraShortInterest, SyncState
from core.backend.queries.meta.load_log import record_load

_URL = (
    "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
)
_HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}
_PAGE = 5000                 # API sync-page cap
_DB_CHUNK = 2000             # upsert batch (14 cols × 2000 < Postgres' 65535 param cap)
_TABLE = "finra_short_interest"
_HISTORY_START = date(2017, 12, 29)  # earliest settlement date in the feed (verified)

# Always-present mega-caps used only to *discover* the settlement-date calendar
# cheaply (one small query per symbol). Union guards against a name missing a
# single period. They are not otherwise special.
_CALENDAR_SYMBOLS = ("AAPL", "MSFT", "IBM")

# FINRA field -> our column. Mirror verbatim; derive nothing.
_FIELD_MAP = {
    "symbolCode": "symbol",
    "issueName": "issue_name",
    "settlementDate": "settlementdate",
    "marketClassCode": "market",
    "currentShortPositionQuantity": "current_short",
    "previousShortPositionQuantity": "previous_short",
    "changePreviousNumber": "change_short",
    "changePercent": "change_pct",
    "averageDailyVolumeQuantity": "avg_daily_vol",
    "daysToCoverQuantity": "days_to_cover",
    "accountingYearMonthNumber": "accounting_ym",
    "stockSplitFlag": "stock_split_flag",
    "revisionFlag": "revision_flag",
    "issuerServicesGroupExchangeCode": "issuer_exchange",
}


# --- fetch -----------------------------------------------------------------
def _post(body: dict) -> requests.Response:
    r = requests.post(_URL, json=body, headers=_HEADERS, timeout=120)
    r.raise_for_status()
    return r


def discover_settlement_dates(start: str, end: str) -> list[str]:
    """Return sorted unique settlement dates in [start, end] (YYYY-MM-DD).

    Discovered from the data (union of a few always-present symbols) rather than
    guessed from a calendar, so it tracks FINRA's actual publication schedule.
    """
    dates: set[str] = set()
    for sym in _CALENDAR_SYMBOLS:
        body = {
            "limit": _PAGE,
            "compareFilters": [
                {"fieldName": "symbolCode", "fieldValue": sym, "compareType": "EQUAL"}
            ],
            "dateRangeFilters": [
                {"fieldName": "settlementDate", "startDate": start, "endDate": end}
            ],
        }
        for row in _post(body).json():
            dates.add(row["settlementDate"])
    return sorted(dates)


def fetch_settlement_date(settlement_date: str) -> list[dict]:
    """Page through every short-interest row for one settlement date."""
    rows: list[dict] = []
    offset = 0
    while True:
        body = {
            "limit": _PAGE,
            "offset": offset,
            "compareFilters": [
                {
                    "fieldName": "settlementDate",
                    "fieldValue": settlement_date,
                    "compareType": "EQUAL",
                }
            ],
        }
        resp = _post(body)
        page = resp.json()
        rows.extend(page)
        total = int(resp.headers.get("Record-Total", len(rows)))
        offset += _PAGE
        if offset >= total or not page:
            break
    return rows


# --- transform -------------------------------------------------------------
def _to_row(raw: dict) -> dict:
    """Map one FINRA record to a DB row dict (verbatim, no derivation)."""
    return {col: raw.get(src) for src, col in _FIELD_MAP.items()}


# --- load ------------------------------------------------------------------
def _upsert(session: Session, rows: list[dict]) -> int:
    """Upsert on (symbol, settlementdate, market). Idempotent."""
    if not rows:
        return 0
    update_cols = [c for c in _FIELD_MAP.values()
                   if c not in ("symbol", "settlementdate", "market")]
    for i in range(0, len(rows), _DB_CHUNK):
        batch = rows[i : i + _DB_CHUNK]
        stmt = pg_insert(FinraShortInterest).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_finra_si_symbol_date_market",
            set_={c: stmt.excluded[c] for c in update_cols},
        )
        session.execute(stmt)
    return len(rows)


# Read-time permaticker resolution lives in a view, not a stored column, so the
# mirror stays byte-faithful to FINRA and the join logic can improve without a
# reload. Point-in-time: match the issuer that held the symbol on the settlement
# date; expose permaticker only when *unambiguous* (recycled-ticker collisions on
# the same date resolve to NULL — honest gap, zero false positives; CLAUDE.md).
_RESOLVED_VIEW = text(f"""
    CREATE OR REPLACE VIEW finra_short_interest_resolved AS
    SELECT si.*, r.permaticker
      FROM {_TABLE} si
      LEFT JOIN LATERAL (
          -- the issuer that held `symbol` on the settlement date; NULL unless the
          -- match is unambiguous (0 or >1 distinct permatickers -> NULL).
          SELECT CASE WHEN count(DISTINCT t.permaticker) = 1
                      THEN min(t.permaticker::bigint) END AS permaticker
            FROM tickers t
           WHERE t.ticker = si.symbol
             AND si.settlementdate >= t.firstpricedate
             AND si.settlementdate <= COALESCE(t.lastpricedate, CURRENT_DATE)
      ) r ON true
""")


def ensure_resolved_view(session: Session) -> None:
    """(Re)create the read-time permaticker-resolving view. Idempotent."""
    session.execute(_RESOLVED_VIEW)


def _watermark(session: Session) -> date | None:
    row = session.get(SyncState, _TABLE)
    return row.last_updated_date if row else None


def _advance_watermark(session: Session, latest: date, rows: int) -> None:
    state = session.get(SyncState, _TABLE) or SyncState(table_name=_TABLE)
    state.last_updated_date = latest
    state.last_run = datetime.now()
    state.rows_loaded = rows
    session.merge(state)


def _run(start: str, end: str, operation: str,
         on_date=None) -> dict:
    """Load every settlement date in [start, end]; stamp permaticker; log."""
    requested_at = datetime.now()
    settlement_dates = discover_settlement_dates(start, end)

    total = 0
    loaded: list[str] = []
    for sd in settlement_dates:
        raw = fetch_settlement_date(sd)
        rows = [_to_row(r) for r in raw]
        with session_scope() as session:
            n = _upsert(session, rows)
        total += n
        loaded.append(sd)
        if on_date is not None:
            on_date(sd, n)

    with session_scope() as session:
        ensure_resolved_view(session)
        if loaded:
            _advance_watermark(session, date.fromisoformat(loaded[-1]), total)

    span = (loaded[0], loaded[-1]) if loaded else (None, None)
    record_load(
        source="FINRA",
        dataset="FINRA/consolidatedShortInterest",
        operation=operation,
        rows=total,
        requested_at=requested_at,
        detail=f"{len(loaded)} settlement dates {span[0]}..{span[1]}",
    )
    return {"rows": total, "dates": len(loaded), "range": span}


def backfill_short_interest(start: date = _HISTORY_START, on_date=None) -> dict:
    """Full history load: every settlement date from `start` to today."""
    return _run(start.isoformat(), date.today().isoformat(), "backfill", on_date)


def sync_short_interest(on_date=None) -> dict:
    """Incremental: only settlement dates strictly after the stored watermark."""
    with session_scope() as session:
        wm = _watermark(session)
    start = (wm.isoformat() if wm else _HISTORY_START.isoformat())
    dates = discover_settlement_dates(start, date.today().isoformat())
    # Drop the watermark date itself (already loaded); keep strictly-newer ones.
    newer = [d for d in dates if not wm or date.fromisoformat(d) > wm]
    if not newer:
        return {"rows": 0, "dates": 0, "range": (None, None)}
    return _run(newer[0], newer[-1], "sync", on_date)
