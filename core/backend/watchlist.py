"""Watchlist annotations — the user's own notes on names a screen surfaces.

A screen is mechanical: it can tell you a company is cheap and profitable, but not *why*
the market put it on sale, whether the discount is temporary or structural, or that a name
it caught is a value trap. That judgement is yours, and it is personal — so it lives in a
git-tracked data file you own (`research/watchlist/annotations.json`), never in the code
that serves it.

The file is optional. With no file, `GET /api/v1/screener/ideas/` returns the unannotated
screen — every survivor, no notes — which is the correct empty state, not a broken one.
See `research/watchlist/README.md` for the schema and an example.
"""
from __future__ import annotations

import json
from typing import Any

from core.config import PROJECT_ROOT

ANNOTATIONS_PATH = PROJECT_ROOT / "research" / "watchlist" / "annotations.json"

_EMPTY: dict[str, dict[int, Any]] = {"notes": {}, "cautions": {}}


def load_annotations() -> dict[str, dict[int, Any]]:
    """Read the watchlist file, keyed by **permaticker as int** (tickers get recycled and
    are not a stable id — see CLAUDE.md). Returns empty dicts when the file is absent or
    malformed; an unreadable annotation file must degrade the idea board to "no notes",
    never take the endpoint down."""
    if not ANNOTATIONS_PATH.exists():
        return {"notes": {}, "cautions": {}}
    try:
        raw = json.loads(ANNOTATIONS_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {"notes": {}, "cautions": {}}

    def _keyed(section: str) -> dict[int, Any]:
        out = {}
        for k, v in (raw.get(section) or {}).items():
            try:
                out[int(k)] = v
            except (TypeError, ValueError):
                continue          # a non-numeric key is a typo'd permaticker; skip it
        return out

    return {"notes": _keyed("notes"), "cautions": _keyed("cautions")}
