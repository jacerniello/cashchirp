"""Ingest FRED-MD / FRED-QD — St. Louis Fed curated macro panels — into Postgres.

FRED-MD is a single wide CSV: ~127 monthly U.S. macro series back to 1959, with a
leading "Transform:" row giving McCracken's recommended stationarity transform per
series. FRED-QD is its quarterly sibling. This is the project's macro-regime layer
(step 1 of the arc) in one download — no per-series API loop, no key required.

Design choices, following the house rules:
- **Store raw.** Values land untransformed; the transform code is metadata
  (`fred_series.tcode`) applied at analysis time. (CLAUDE.md: "store raw,
  transform locally".)
- **Long format.** One row per (series, date, vintage), mirroring `daily_prices`.
- **Files persisted + tracked.** Every download is saved under `core/data/fred/` and
  registered in the `fred_files` table (url, sha256, `requested_at` vs.
  `content_updated_at`), so local files stay fresh and each file's provenance is
  auditable (see `core/backend/queries/fred_files.py`).
- **Backtest-safe by default.** `ingest_fred_vintages()` (the default path) loads the
  **point-in-time vintage history** — a zip of monthly snapshots, each tagged
  `vintage="YYYY-MM"`, that only contain data known as of that month. The revised
  `current.csv` (`ingest_fred()`, vintage "current") has latest-revision look-ahead and
  is exploratory-only — **never backtest on it.** See `research/sources/sources.md`
  ("Backtesting with FRED"). Real-time vintages start 2015-01 (MD) / 2018-05 (QD).

Implements the `BaseIngestor` fetch/transform/load contract:
    fetch()      -> raw CSV text (one HTTP GET, no key)
    transform()  -> FredPanel: per-series tcodes + long-format observations
    load()       -> upsert fred_series + fred_observations; returns rows written

Docs: https://www.stlouisfed.org/research/economists/mccracken/fred-databases
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Callable
from urllib.request import urlopen

import pandas as pd
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from core.backend.db.engine import session_scope
from core.backend.db.models import FredObservation, FredSeries
from core.backend.ingest.base import BaseIngestor
from core.backend.queries.market.fred_files import save_file
from core.backend.queries.meta.load_log import record_load

_BASE = "https://www.stlouisfed.org/-/media/project/frbstl/stlouisfed/research/fred-md"

# REVISED, latest-values panels (full history to 1959). Convenient, but NOT
# point-in-time: every value reflects all later revisions, so backtesting on these
# leaks look-ahead. Use only for exploratory/descriptive work.
FRED_MD_URL = f"{_BASE}/monthly/current.csv"
FRED_QD_URL = f"{_BASE}/quarterly/current.csv"

# POINT-IN-TIME vintage history (one bundled zip of monthly snapshots, each tagged
# with the month it was published). This is the backtest-grade source — a given
# vintage only contains data that was actually known then (e.g. the 2015-01 snapshot
# stops at the Dec-2014 observation). FRED-MD real-time vintages begin 2015-01;
# FRED-QD begin 2018-05. There is no point-in-time FRED-MD before 2015.
# (Recent months past the zip's end are individual hashed files on the FRED-MD page.)
FRED_MD_VINTAGES_URL = (
    f"{_BASE}/historical-vintages-of-fred-md-2015-01-to-2024-12.zip"
    "?sc_lang=en&hash=831F98A7EC8D3809881DF067965B50FF"
)
FRED_QD_VINTAGES_URL = (
    f"{_BASE}/historical-vintages-of-fred-qd-2018-05-to-2024-12.zip"
    "?sc_lang=en&hash=4088DF99A1CCB4F6ED49F5B88A7C636D"
)

# Recent monthly/quarterly vintages past the bundled zip's end (2024-12) live as
# individual files on the FRED-MD page — each behind a per-file `?hash=` that drifts,
# so we scrape the page to discover their current URLs and keep the local set fresh.
FRED_DB_PAGE = "https://www.stlouisfed.org/research/economists/mccracken/fred-databases"
# Year/month separator varies across the archive: `2015-01.csv` (hyphen) and
# `FRED-MD_2024m03.csv` (the `…YYYYmMM` form used from 2024-03 on, and by QD files).
_VINTAGE_RE = re.compile(r"(\d{4})[-m](\d{1,2})")  # month may be 1 digit (…2019m3)
_HREF_RE = re.compile(
    r'href="(/-/media/[^"]*?/(monthly|quarterly)/[^"]*?\.csv[^"]*?)"'
)


def _vintage_from_name(name: str) -> str:
    """Pull a zero-padded YYYY-MM tag from a filename (handles `2015-01.csv`,
    `2025-04-md.csv`, and single-digit months like `FRED-QD_2019m3.csv` → `2019-03`)."""
    m = _VINTAGE_RE.search(Path(name).name)
    return f"{m.group(1)}-{int(m.group(2)):02d}" if m else Path(name).stem


def discover_recent_vintage_urls(dataset: str, after: str) -> dict[str, str]:
    """Scrape the FRED-MD page for vintage CSVs newer than `after` (a YYYY-MM tag).

    Returns {vintage: absolute_url}, sorted. Best-effort: the caller wraps this so a
    page-layout change can't break the core load.
    """
    want_folder = "monthly" if dataset == "FRED-MD" else "quarterly"
    html = urlopen(FRED_DB_PAGE, timeout=60).read().decode("utf-8", "ignore")  # noqa: S310
    out: dict[str, str] = {}
    for href, folder in _HREF_RE.findall(html):
        if folder != want_folder:
            continue
        vintage = _vintage_from_name(href.split("/")[-1])
        if not _VINTAGE_RE.fullmatch(vintage) or vintage <= after:
            continue
        out[vintage] = "https://www.stlouisfed.org" + href.replace("&amp;", "&")
    return dict(sorted(out.items()))

# McCracken transform codes -> human label. Applied at analysis time, not on load.
TCODE_LABELS = {
    1: "level (no transform)",
    2: "first difference  Δx",
    3: "second difference  Δ²x",
    4: "log  log(x)",
    5: "log first difference  Δlog(x)",
    6: "log second difference  Δ²log(x)",
    7: "pct-change difference  Δ(x_t/x_{t-1} − 1)",
}

# ORM upsert payload chunk size (keeps bound-parameter counts well under limits).
_CHUNK = 5_000


@dataclass
class FredPanel:
    """Parsed panel: per-series transform codes + raw long-format observations."""

    dataset: str
    vintage: str
    transforms: dict[str, int]                    # series_id -> tcode
    observations: list[tuple[str, date, float]]   # (series_id, date, value)


class FredMdIngestor(BaseIngestor):
    """FRED-MD / FRED-QD -> Postgres via the fetch/transform/load contract."""

    name = "fred-md"

    def __init__(
        self,
        url: str = FRED_MD_URL,
        dataset: str = "FRED-MD",
        vintage: str = "current",
    ) -> None:
        self.url = url
        self.dataset = dataset
        self.vintage = vintage

    # --- fetch -------------------------------------------------------------
    def fetch(self) -> str:
        """Download the raw CSV text (public, no API key)."""
        with urlopen(self.url, timeout=60) as resp:  # noqa: S310 (trusted host)
            return resp.read().decode("utf-8")

    # --- transform ---------------------------------------------------------
    def transform(self, raw: str) -> FredPanel:
        """Peel off the Transform: row, then melt wide -> long, dropping blanks.

        Series start at different dates, so the wide grid is sparse; we keep only
        non-null cells. Values stay raw.
        """
        df = pd.read_csv(io.StringIO(raw))
        df = df.dropna(axis=1, how="all")     # drop the trailing empty column, if any
        date_col = df.columns[0]               # "sasdate"

        # Row 0 carries the per-series transform codes.
        tcode_row = df.iloc[0]
        transforms = {
            col: int(tcode_row[col])
            for col in df.columns[1:]
            if pd.notna(tcode_row[col])
        }

        data = df.iloc[1:].copy()
        data[date_col] = pd.to_datetime(data[date_col], errors="coerce")
        data = data.dropna(subset=[date_col])  # drop any stray footer/notes rows

        long = data.melt(
            id_vars=[date_col], var_name="series_id", value_name="value"
        ).dropna(subset=["value"])

        observations = [
            (sid, d.date(), float(v))
            for sid, d, v in zip(long["series_id"], long[date_col], long["value"])
        ]
        return FredPanel(self.dataset, self.vintage, transforms, observations)

    # --- load --------------------------------------------------------------
    def load(self, session: Session, panel: FredPanel) -> int:
        """Upsert the series catalogue, then the observations. Idempotent."""
        # 1) series catalogue — id + dataset + transform code.
        for series_id, tcode in panel.transforms.items():
            stmt = (
                pg_insert(FredSeries)
                .values(series_id=series_id, dataset=panel.dataset, tcode=tcode)
                .on_conflict_do_update(
                    index_elements=["series_id"],
                    set_={"dataset": panel.dataset, "tcode": tcode},
                )
            )
            session.execute(stmt)

        # 2) observations — keyed (series_id, date, vintage), upsert the value.
        rows = [
            {"series_id": s, "date": d, "value": v, "vintage": panel.vintage}
            for (s, d, v) in panel.observations
        ]
        for i in range(0, len(rows), _CHUNK):
            batch = rows[i : i + _CHUNK]
            stmt = pg_insert(FredObservation).values(batch)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_fred_obs_series_date_vintage",
                set_={"value": stmt.excluded.value},
            )
            session.execute(stmt)
        return len(rows)


def ingest_fred(
    url: str = FRED_MD_URL, dataset: str = "FRED-MD", vintage: str = "current"
) -> dict:
    """Run one fetch -> transform -> load and record it in the load ledger.

    Returns {"rows", "series", "dataset", "vintage", "date_range"}.
    """
    requested_at = datetime.now()
    with urlopen(url, timeout=60) as resp:  # noqa: S310 (trusted host)
        blob = resp.read()

    folder = dataset.lower()  # fred-md / fred-qd
    save_file(
        rel_path=f"{folder}/current.csv",
        data=blob,
        dataset=dataset,
        kind="revised",
        vintage=vintage,
        source_url=url,
    )

    ing = FredMdIngestor(url=url, dataset=dataset, vintage=vintage)
    panel = ing.transform(blob.decode("utf-8"))

    with session_scope() as session:
        rows = ing.load(session, panel)

    dates = [d for _, d, _ in panel.observations]
    span = (min(dates), max(dates)) if dates else (None, None)
    record_load(
        source="FRED",
        dataset=dataset,
        operation="backfill",
        rows=rows,
        requested_at=requested_at,
        detail=f"vintage={vintage}; {len(panel.transforms)} series; "
        f"{span[0]}..{span[1]}",
    )
    return {
        "rows": rows,
        "series": len(panel.transforms),
        "dataset": dataset,
        "vintage": vintage,
        "date_range": span,
    }


def _load_vintage(
    dataset: str, vintage: str, csv_bytes: bytes, source_url: str
) -> tuple[int, bool]:
    """Save one vintage CSV to disk (tracked) and upsert its observations.

    Returns (rows_written, content_changed).
    """
    folder = dataset.lower()  # fred-md / fred-qd
    saved = save_file(
        rel_path=f"{folder}/vintages/{vintage}.csv",
        data=csv_bytes,
        dataset=dataset,
        kind="vintage",
        vintage=vintage,
        source_url=source_url,
    )
    ing = FredMdIngestor(dataset=dataset, vintage=vintage)
    panel = ing.transform(csv_bytes.decode("utf-8"))
    with session_scope() as session:
        rows = ing.load(session, panel)
    return rows, saved["changed"]


def _loaded_vintages(dataset: str) -> set[str]:
    """Vintage tags already ingested for `dataset`, from the `fred_files` registry.
    Point-in-time snapshots are immutable, so once loaded they never need re-ingesting
    — this is the watermark that makes a refresh incremental."""
    from sqlalchemy import text

    with session_scope() as session:
        res = session.execute(
            text("SELECT vintage FROM fred_files WHERE dataset = :ds "
                 "AND kind = 'vintage' AND vintage IS NOT NULL"),
            {"ds": dataset},
        )
        return {row[0] for row in res}


def ingest_fred_vintages(
    url: str = FRED_MD_VINTAGES_URL,
    dataset: str = "FRED-MD",
    limit: int | None = None,
    include_recent: bool = True,
    full: bool = False,
    on_vintage: Callable[[str, int], None] | None = None,
) -> dict:
    """Load the **point-in-time vintage history** (backtest-grade), incrementally.

    Two sources, combined: (1) the bundled zip of monthly snapshots
    (2015-01..2024-12), and (2) any newer vintages still published as individual
    files on the FRED-MD page (`include_recent`, best-effort) — so the local set
    stays current. Each member is saved under `core/data/fred/<ds>/vintages/` and
    tracked in `fred_files`, then loaded tagged `vintage="YYYY-MM"`, so the DB can
    answer "what was known as of date X". The revised `current.csv` (see
    `ingest_fred`) must never feed a backtest.

    **Incremental by default.** Historical vintages are immutable, so a refresh only
    ingests vintages it doesn't already have (per `fred_files`): if the watermark
    already covers the bundled zip's end, the zip isn't even downloaded — we go
    straight to discovering vintages newer than the watermark. `full=True` forces a
    re-ingest of every vintage (e.g. to repair the table).

    `limit` loads only the first N zip vintages (quick test; skips recent discovery).
    `on_vintage(vintage, rows)` is called after each one for progress reporting.

    Returns {"rows", "vintages", "range", "dataset", "changed"}.
    """
    requested_at = datetime.now()
    have = set() if full else _loaded_vintages(dataset)
    total_rows = 0
    changed = 0
    loaded: list[str] = []

    # The bundled zip's coverage end is in its filename (…to-2024-12.zip). If we
    # already have everything through it, skip the multi-MB download + ~120 upserts
    # entirely and jump to the recent-vintage discovery below.
    zip_end_m = re.search(r"to-(\d{4}-\d{2})", url)
    zip_end = zip_end_m.group(1) if zip_end_m else None
    skip_zip = (not full and limit is None and bool(have)
                and zip_end is not None and max(have) >= zip_end)

    if skip_zip:
        loaded = sorted(have)  # already ingested — nothing to do from the zip
    else:
        with urlopen(url, timeout=180) as resp:  # noqa: S310 (trusted host)
            blob = resp.read()
        zf = zipfile.ZipFile(io.BytesIO(blob))
        names = sorted(n for n in zf.namelist() if n.lower().endswith(".csv"))
        if limit is not None:
            names = names[:limit]
        for name in names:
            vintage = _vintage_from_name(name)
            if vintage in have:  # immutable snapshot already ingested — skip
                loaded.append(vintage)
                continue
            rows, was_changed = _load_vintage(dataset, vintage, zf.read(name), url)
            total_rows += rows
            changed += int(was_changed)
            loaded.append(vintage)
            if on_vintage is not None:
                on_vintage(vintage, rows)

    # Recent vintages newer than what we have — individual hashed files on the page.
    if include_recent and limit is None and loaded:
        try:
            recent = discover_recent_vintage_urls(dataset, after=max(loaded))
        except Exception:  # noqa: BLE001 — best-effort; never break the core load
            recent = {}
        for vintage, vurl in recent.items():
            if vintage in have:  # already ingested
                continue
            try:
                with urlopen(vurl, timeout=60) as resp:  # noqa: S310
                    member = resp.read()
            except Exception:  # noqa: BLE001
                continue
            if not member.lstrip()[:7].lower().startswith(b"sasdate"):
                continue  # soft-404 HTML, not a real CSV — skip
            rows, was_changed = _load_vintage(dataset, vintage, member, vurl)
            total_rows += rows
            changed += int(was_changed)
            loaded.append(vintage)
            if on_vintage is not None:
                on_vintage(vintage, rows)

    span = (loaded[0], loaded[-1]) if loaded else (None, None)
    record_load(
        source="FRED",
        dataset=f"{dataset} (vintages)",
        operation="backfill",
        rows=total_rows,
        requested_at=requested_at,
        detail=f"{len(loaded)} point-in-time vintages {span[0]}..{span[1]}; "
        f"{changed} new/changed files",
    )
    return {
        "rows": total_rows,
        "vintages": len(loaded),
        "range": span,
        "dataset": dataset,
        "changed": changed,
    }
