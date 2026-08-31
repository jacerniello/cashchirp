"""Macro endpoints — FRED-MD/QD panels (and the commodity FRED-Spot series) over
the `macro` repository. Replicates what the Dash Macro + Commodities pages showed:

    GET /macro/series[?dataset=<ds>]
        -> { series: [{ series_id, dataset, title, tcode, transform }], datasets: [...] }
    GET /macro/observations?series_id=<id>[&vintage=<v>]
        -> { series_id, title, vintage, observations: [{ date, value }] }

Observations are point-in-time: each value carries the release (`vintage`) it
appeared in. As in the Dash macro repo, the default (no `vintage`) is the
most-revised snapshot — the latest value per date — while passing a `vintage` pins
that release exactly so series stay backtest-safe (see CLAUDE.md / the FRED
point-in-time memory). The optional `dataset` filter lets the commodities page list
just the FRED-Spot series.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Query

from core.api.serialize import json_safe
from core.backend.db.engine import session_scope
from core.backend.ingest.fred.fred_md import TCODE_LABELS
from core.backend.queries.market import macro

router = APIRouter(prefix="/macro", tags=["macro"])


def _transform_label(tcode: Any) -> str | None:
    """McCracken transform label for a tcode (mirrors the Dash catalogue table)."""
    if tcode is None or (isinstance(tcode, float) and pd.isna(tcode)):
        return None
    try:
        return TCODE_LABELS.get(int(tcode))
    except (TypeError, ValueError):
        return None


@router.get("/series")
def list_series(dataset: str | None = Query(None)) -> dict[str, Any]:
    """Available FRED series (the catalogue). Optionally filtered by `dataset` so the
    commodities page can list just the FRED-Spot series. Each row carries the raw
    `tcode` and its human-readable `transform` label."""
    with session_scope() as s:
        cat = macro.catalogue(s, dataset)
        all_datasets = macro.datasets(s)
    series = []
    for r in cat.to_dict("records"):
        tcode = r.get("tcode")
        series.append({
            "series_id": r.get("series_id"),
            "dataset": r.get("dataset"),
            "title": r.get("title"),
            "tcode": tcode,
            "transform": _transform_label(tcode),
            "fred_code": r.get("fred_code"),
            "fred_url": macro.fred_url(r.get("series_id"), r.get("fred_code")),
        })
    return {"series": json_safe(series), "datasets": all_datasets}


@router.get("/vintages")
def list_vintages(series_id: str = Query(...)) -> dict[str, Any]:
    """Available release vintages for one series, newest first. Mirrors the Dash macro
    vintage dropdown: pick one to pin that point-in-time release (backtest-safe), or
    leave it unset for the latest-per-date snapshot."""
    with session_scope() as s:
        vintages = macro.vintages(s, series_id)
    return {"series_id": series_id, "vintages": vintages}


@router.get("/observations")
def get_observations(
    series_id: str = Query(...),
    vintage: str | None = Query(None),
) -> dict[str, Any]:
    """Time series for one FRED series. Default (no `vintage`) is the latest value
    per date (most-revised snapshot); a `vintage` pins that release exactly
    (point-in-time / backtest-safe)."""
    with session_scope() as s:
        df = macro.observations(s, series_id, vintage)
        title = macro.series_title(s, series_id)
    observations: list[dict] = []
    if not df.empty:
        d = df.copy()
        d["date"] = pd.to_datetime(d["date"]).dt.strftime("%Y-%m-%d")
        observations = json_safe(d[["date", "value"]].to_dict("records"))
    return {
        "series_id": series_id,
        "title": title,
        "vintage": vintage,
        "observations": observations,
    }
