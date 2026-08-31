"""Backfill `fred_series.title` with the official FRED series description.

The FRED-MD/QD panels ship only a mnemonic per series (the CSV column header) and a
McCracken transform code — no human-readable name. This fills that gap by asking the
**FRED API** (the authoritative source) for each series' official title, so the UI can
show "RPI — Real Personal Income" instead of a bare code.

Fidelity rules (CLAUDE.md / the data-fidelity memory) drive the design:
- **No guessed mappings.** A panel mnemonic is usually a real FRED code (`CPIAUCSL`).
  Some carry McCracken's trailing `x` to flag a spliced/adjusted series (`RETAILx`,
  `VIXCLSx`); the documented convention is that the underlying FRED code is the name
  without the `x`. We try the mnemonic verbatim, then (only if it ends in `x`) the
  stripped form — but we **accept a title only when the FRED API confirms that code
  exists.** Anything unresolved (e.g. `AMDMNOx`, the `S&P …` labels that aren't FRED
  series) is left null rather than filled with a guess.
- **Provenance recorded.** The confirmed code lands in `fred_series.fred_code` so the
  resolution is auditable and the UI can deep-link to that exact FRED series page.

Run via `python -m core.scripts.load.fred.backfill_titles`. Idempotent; needs `FRED_API_KEY`.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError

from sqlalchemy import text

from core.backend.db.engine import session_scope
from core.config import settings

FRED_SERIES_API = "https://api.stlouisfed.org/fred/series"


def candidate_codes(series_id: str) -> list[str]:
    """FRED codes to try for a panel mnemonic, most-likely first.

    The mnemonic verbatim, then its `x`-stripped form (McCracken's adjusted-series
    flag). Mnemonics with spaces or `&` (the `S&P …` labels) aren't FRED codes, so we
    offer no candidate — they stay unresolved rather than mis-link.
    """
    if " " in series_id or "&" in series_id:
        return []
    out = [series_id]
    if series_id.endswith("x") and len(series_id) > 1:
        out.append(series_id[:-1])
    return out


def fetch_title(code: str, api_key: str, *, timeout: int = 30) -> str | None:
    """Return the official FRED title for `code`, or None if FRED doesn't know it.

    A 400 (bad/unknown series_id) is the expected "not found" signal and yields None;
    other transport errors also yield None so one bad lookup never aborts the backfill.
    """
    q = urllib.parse.urlencode(
        {"series_id": code, "api_key": api_key, "file_type": "json"}
    )
    try:
        with urllib.request.urlopen(f"{FRED_SERIES_API}?{q}", timeout=timeout) as r:  # noqa: S310
            payload = json.load(r)
    except (HTTPError, URLError, ValueError):
        return None
    series = payload.get("seriess") or []
    return series[0].get("title") if series else None


def _ensure_columns() -> None:
    """Add `fred_code` to an already-created `fred_series` table (idempotent).

    The schema is managed by `create_all`, which won't ALTER an existing table, so a
    DB loaded before this column existed needs the column added in place — without
    dropping the loaded panels.
    """
    with session_scope() as s:
        s.execute(
            text("ALTER TABLE fred_series ADD COLUMN IF NOT EXISTS fred_code varchar(64)")
        )


def backfill_titles(
    *, overwrite: bool = False, pause: float = 0.1, limit: int | None = None
) -> dict:
    """Look up and store the FRED title for every catalogue series.

    `overwrite=False` (default) only fills series whose title is still null, so reruns
    are cheap. `pause` throttles between API calls. Returns
    {"resolved", "unresolved", "unresolved_ids", "total"}.
    """
    api_key = settings.fred_api_key
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set in core/.env")

    _ensure_columns()

    with session_scope() as s:
        where = "" if overwrite else "WHERE title IS NULL"
        rows = s.execute(
            text(f"SELECT series_id FROM fred_series {where} ORDER BY series_id")
        ).fetchall()
    series_ids = [r[0] for r in rows]
    if limit is not None:
        series_ids = series_ids[:limit]

    resolved: list[tuple[str, str, str]] = []  # (series_id, fred_code, title)
    unresolved: list[str] = []
    for sid in series_ids:
        title = code = None
        for cand in candidate_codes(sid):
            title = fetch_title(cand, api_key)
            if title:
                code = cand
                break
            time.sleep(pause)
        if title:
            resolved.append((sid, code, title))
        else:
            unresolved.append(sid)
        time.sleep(pause)

    if resolved:
        with session_scope() as s:
            for sid, code, title in resolved:
                s.execute(
                    text(
                        "UPDATE fred_series SET title = :t, fred_code = :c "
                        "WHERE series_id = :s"
                    ),
                    {"t": title, "c": code, "s": sid},
                )

    return {
        "resolved": len(resolved),
        "unresolved": len(unresolved),
        "unresolved_ids": unresolved,
        "total": len(series_ids),
    }
