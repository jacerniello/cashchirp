"""Prices endpoint — SEP/SFP OHLCV for one security, shaped for the web
PriceChart (web/src/hooks/usePrices.ts):

    GET /prices/?perma_ticker=<pt>   ->  { prices: {date: PricePoint},
                                           corporate_actions: [...], meta: {...} }

Reuses `prices.get_prices_by_permaticker`. Sharadar SEP open/high/low/close are
split-adjusted and `closeadj` is split+dividend (total-return) adjusted, so the
adjusted OHL are the raw OHL scaled by the dividend factor (closeadj/close);
volume is already split-adjusted.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Query

from core.api.serialize import json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.securities import events, prices as prices_repo, securities

router = APIRouter(tags=["prices"])


@router.get("/prices/")
def get_prices(
    perma_ticker: str | None = Query(None),
    ticker: str | None = Query(None),
) -> dict[str, Any]:
    with session_scope() as s:
        pt = perma_ticker
        if not pt and ticker:
            resolved = securities.resolve_ticker(s, ticker)  # ticker -> permaticker
            pt = resolved.get("permaticker") if resolved else None
        if not pt:
            return {"prices": {}, "corporate_actions": [], "meta": {}}

        df = prices_repo.get_prices_by_permaticker(s, pt)
        asset = "equity"
        if df.empty:
            df = prices_repo.get_prices_by_permaticker(s, pt, table="sfp")
            asset = "fund"
        profile = securities.get_profile(s, pt) or {}
        actions = events.actions_for_security(s, pt)

    prices: dict[str, dict] = {}
    if not df.empty:
        d = df.copy()
        d["date"] = pd.to_datetime(d["date"]).dt.strftime("%Y-%m-%d")
        # dividend factor = closeadj / close (close is split-adj, closeadj is total-return)
        factor = (d["adj_close"] / d["close"]).where(d["close"] > 0, 1.0).fillna(1.0)
        for r, f in zip(d.to_dict("records"), factor):
            prices[r["date"]] = {
                "date": r["date"],
                "open": r["open"], "high": r["high"], "low": r["low"],
                "close": r["close"], "volume": r["volume"],
                "adj_open": (r["open"] or 0) * f, "adj_high": (r["high"] or 0) * f,
                "adj_low": (r["low"] or 0) * f,
                "adj_close": r.get("adj_close") if r.get("adj_close") is not None else r["close"],
                "adj_volume": r["volume"],
            }

    corp: list[dict] = []
    if not actions.empty:
        for r in actions.to_dict("records"):
            kind = "split" if "split" in str(r.get("action", "")).lower() else "dividend"
            corp.append({
                "date": pd.to_datetime(r["date"]).strftime("%Y-%m-%d"),
                "type": kind, "value": r.get("value"),
                "color": "#2563eb" if kind == "split" else "#16a34a",
                "radius": 5,
            })

    meta = {
        "ticker": profile.get("ticker"),
        "name": profile.get("name"),
        "exchange": profile.get("exchange"),
        "asset_type": asset,
    }
    # NaN guard on the price values
    json_safe(list(prices.values()))
    return {"prices": prices, "corporate_actions": corp, "meta": meta}
