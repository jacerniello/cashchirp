"""Record Nasdaq Data Link's rate-limit headers, so Setup can chart API usage over time.

Every API response carries `x-ratelimit-limit` and `x-ratelimit-remaining`. The client
library throws them away, so `install()` wraps its one HTTP entry point and keeps the
latest pair. A reading is written to `api_rate_samples` at most once a minute per
process — an ingest makes hundreds of calls, and a row per call would be noise — and
`probe()` makes one cheap call on demand so the chart has points while nothing runs.

The headers do not say how long the window is. A drop in `used` between two readings
is a reset, and the spacing of resets is how the window shows itself.

Best-effort throughout: recording must never fail or slow an ingest.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from core.backend.db.engine import engine

_MIN_GAP_SECONDS = 60
_lock = threading.Lock()
_last_write = 0.0
_installed = False
_table_ready = False

_DDL = """
CREATE TABLE IF NOT EXISTS api_rate_samples (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    sampled_at timestamptz NOT NULL DEFAULT now(),
    rate_limit bigint NOT NULL,
    remaining bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_api_rate_samples_at ON api_rate_samples (provider, sampled_at);
"""

PROVIDER = "nasdaq"


def _ensure_table(conn) -> None:
    global _table_ready
    if not _table_ready:
        conn.execute(text(_DDL))
        _table_ready = True


def record(limit: int, remaining: int, force: bool = False) -> None:
    """Store one reading, throttled to one a minute unless `force`."""
    global _last_write
    now = time.monotonic()
    with _lock:
        if not force and now - _last_write < _MIN_GAP_SECONDS:
            return
        _last_write = now
    try:
        with engine.begin() as conn:
            _ensure_table(conn)
            conn.execute(
                text("INSERT INTO api_rate_samples (provider, rate_limit, remaining) "
                     "VALUES (:p, :l, :r)"),
                {"p": PROVIDER, "l": limit, "r": remaining})
    except Exception:
        pass


def _from_headers(headers) -> tuple[int, int] | None:
    try:
        return int(headers["x-ratelimit-limit"]), int(headers["x-ratelimit-remaining"])
    except (KeyError, TypeError, ValueError):
        return None


def install() -> None:
    """Wrap the client's HTTP call so every response's rate-limit headers are seen."""
    global _installed
    if _installed:
        return
    from nasdaqdatalink.connection import Connection
    original = Connection.execute_request.__func__

    def execute_request(cls, http_verb, url, **options):
        response = original(cls, http_verb, url, **options)
        pair = _from_headers(getattr(response, "headers", None))
        if pair:
            record(*pair)
        return response

    Connection.execute_request = classmethod(execute_request)
    _installed = True


def probe() -> tuple[int, int] | None:
    """One minimal API call (a single TICKERS row) to read the headers now."""
    import requests

    from core.config import settings
    if not settings.nasdaq_data_link_api_key:
        return None
    try:
        r = requests.get(
            "https://data.nasdaq.com/api/v3/datatables/SHARADAR/TICKERS.json",
            params={"ticker": "MSFT", "qopts.per_page": 1,
                    "api_key": settings.nasdaq_data_link_api_key},
            timeout=20)
    except requests.RequestException:
        return None
    pair = _from_headers(r.headers)
    if pair:
        record(*pair, force=True)
    return pair


_PERIODS = {"24h": ("24 hours", "5 minutes"), "7d": ("7 days", "1 hour"),
            "30d": ("30 days", "4 hours")}


def history(period: str = "24h") -> dict[str, Any]:
    """Readings over `period`, bucketed (highest `used` per bucket), plus the latest one
    and the resets seen — a reset is a reading whose `used` fell below the previous one."""
    if period not in _PERIODS:
        raise ValueError(f"period must be one of {list(_PERIODS)}")
    span, bucket = _PERIODS[period]
    with engine.begin() as conn:
        _ensure_table(conn)
        latest = conn.execute(text(
            "SELECT sampled_at, rate_limit, remaining FROM api_rate_samples "
            "WHERE provider = :p ORDER BY sampled_at DESC LIMIT 1"), {"p": PROVIDER}).first()
        points = conn.execute(text(
            f"SELECT date_bin(interval '{bucket}', sampled_at, timestamptz '2000-01-01') AS bucket_at, "
            "max(rate_limit - remaining) AS used, max(rate_limit) AS lim "
            "FROM api_rate_samples WHERE provider = :p "
            f"AND sampled_at >= now() - interval '{span}' GROUP BY 1 ORDER BY 1"),
            {"p": PROVIDER}).all()
        resets = conn.execute(text(
            "SELECT sampled_at FROM (SELECT sampled_at, rate_limit - remaining AS used, "
            "lag(rate_limit - remaining) OVER (ORDER BY sampled_at) AS prev "
            "FROM api_rate_samples WHERE provider = :p "
            f"AND sampled_at >= now() - interval '{span}') x "
            "WHERE prev IS NOT NULL AND used < prev ORDER BY sampled_at"),
            {"p": PROVIDER}).scalars().all()
    return {
        "provider": PROVIDER,
        "period": period,
        "bucket": bucket,
        "latest": None if latest is None else {
            "sampled_at": latest.sampled_at.isoformat(),
            "limit": latest.rate_limit,
            "remaining": latest.remaining,
            "used": latest.rate_limit - latest.remaining,
        },
        "points": [{"t": p.bucket_at.isoformat(), "used": p.used, "limit": p.lim} for p in points],
        "resets": [r.isoformat() for r in resets],
        "now": datetime.now(timezone.utc).isoformat(),
    }
