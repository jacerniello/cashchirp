"""Ingest individual FRED series via the FRED API (one series at a time).

The bulk path (`fred_md.py`) loads the curated FRED-MD/QD *panels*. This complements it
for series that aren't in those panels — e.g. daily commodity **spot prices** (WTI,
Brent, Henry Hub gas) that back the Commodities page. One series_id -> the FRED
`series/observations` endpoint -> `fred_observations`, with the official title stamped on
`fred_series`.

**Backtest safety.** The FRED-MD/QD `current.csv` is dangerous because its macro
*statistics* (GDP, payrolls) are revised — loading the latest values leaks look-ahead, so
that path is exploratory-only and the vintage history is the backtest-grade source (see
`fred_md.py` / the FRED point-in-time memory). The series this module is meant for are
**market price quotes** (spot oil/gas, exchange rates): a price printed for a given day is
final and never revised, so the currently-published series *is* the point-in-time series.
We therefore tag them `vintage="current"` and they are safe to backtest — but only because
they're revision-free. Do **not** route revised macro statistics through here; use the
vintage panels for those.

Raw JSON is persisted under `core/data/fred/<dataset>/api/` and tracked in `fred_files`,
same as the panel downloads, so provenance stays auditable. Needs `FRED_API_KEY`.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.backend.db.engine import session_scope
from core.backend.db.models import FredObservation, FredSeries
from core.backend.ingest.fred.fred_titles import fetch_title
from core.backend.queries.market.fred_files import save_file
from core.backend.queries.meta.load_log import record_load
from core.config import settings

FRED_OBS_API = "https://api.stlouisfed.org/fred/series/observations"
_CHUNK = 5_000

# Curated commodity spot/reference series available on FRED, charted on the Commodities
# page alongside the tradable ETFs. Daily where FRED has it; copper is the IMF monthly
# global price (no free daily series). Gold & silver are intentionally absent — FRED no
# longer carries a free daily/spot gold or silver price (the LBMA London fixing series
# were withdrawn over ICE licensing), so GLD/SLV remain their only reference here.
COMMODITY_SPOT_SERIES = [
    "DCOILWTICO",    # Crude Oil Prices: West Texas Intermediate (WTI) — daily
    "DCOILBRENTEU",  # Crude Oil Prices: Brent — Europe — daily
    "DHHNGSP",       # Henry Hub Natural Gas Spot Price — daily
    "PCOPPUSDM",     # Global price of Copper (IMF) — monthly
]
COMMODITY_DATASET = "FRED-Spot"


def fetch_observations(series_id: str, api_key: str, *, timeout: int = 60) -> bytes:
    """Download the full observation history for one series as raw JSON bytes."""
    q = urllib.parse.urlencode(
        {
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "sort_order": "asc",
            "limit": 100000,  # FRED's max page; our series are well under it
        }
    )
    with urllib.request.urlopen(f"{FRED_OBS_API}?{q}", timeout=timeout) as r:  # noqa: S310
        return r.read()


def _parse_observations(blob: bytes) -> list[tuple[date, float]]:
    """Pull (date, value) pairs from the API JSON, dropping FRED's '.' missing marker."""
    payload = json.loads(blob)
    out: list[tuple[date, float]] = []
    for o in payload.get("observations", []):
        v = o.get("value")
        if v in (None, "", "."):
            continue
        try:
            out.append((date.fromisoformat(o["date"]), float(v)))
        except (ValueError, KeyError):
            continue
    return out


def ingest_fred_series(
    series_id: str,
    dataset: str = COMMODITY_DATASET,
    vintage: str = "current",
) -> dict:
    """Fetch one FRED series and upsert it into `fred_series` + `fred_observations`.

    Idempotent (upserts on series_id and on series+date+vintage). Returns
    {"series_id", "title", "rows", "date_range", "changed"}.
    """
    api_key = settings.fred_api_key
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set in core/.env")

    requested_at = datetime.now()
    blob = fetch_observations(series_id, api_key)
    saved = save_file(
        rel_path=f"{dataset.lower()}/api/{series_id}.json",
        data=blob,
        dataset=dataset,
        kind="api",
        vintage=vintage,
        source_url=f"{FRED_OBS_API}?series_id={series_id}",
    )
    obs = _parse_observations(blob)
    title = fetch_title(series_id, api_key)

    with session_scope() as session:
        # Catalogue row — title + fred_code stamped so the UI can name and deep-link it.
        # tcode is panel-only (McCracken transform), so it stays null here.
        session.execute(
            pg_insert(FredSeries)
            .values(
                series_id=series_id, dataset=dataset, tcode=None,
                title=title, fred_code=series_id,
            )
            .on_conflict_do_update(
                index_elements=["series_id"],
                set_={"dataset": dataset, "title": title, "fred_code": series_id},
            )
        )
        rows = [
            {"series_id": series_id, "date": d, "value": v, "vintage": vintage}
            for d, v in obs
        ]
        for i in range(0, len(rows), _CHUNK):
            stmt = pg_insert(FredObservation).values(rows[i : i + _CHUNK])
            session.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_fred_obs_series_date_vintage",
                    set_={"value": stmt.excluded.value},
                )
            )

    span = (obs[0][0], obs[-1][0]) if obs else (None, None)
    record_load(
        source="FRED",
        dataset=dataset,
        operation="backfill",
        rows=len(obs),
        requested_at=requested_at,
        detail=f"{series_id} ({title}); vintage={vintage}; {span[0]}..{span[1]}",
    )
    return {
        "series_id": series_id,
        "title": title,
        "rows": len(obs),
        "date_range": span,
        "changed": saved["changed"],
    }


