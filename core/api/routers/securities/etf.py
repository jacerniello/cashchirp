"""ETF / fund endpoint — the dedicated fund deep-dive that the equity company page
can't serve (funds have no SF1 fundamentals, insiders, or short interest).

    GET /etf/{permaticker}  ->  { profile, metrics }

Keyed on **permaticker** (stable issuer id). `profile` is the canonical `tickers`
row (category == 'ETF'); `metrics` are price-derived headline stats from `sfp`
(`prices.etf_metrics` — last close, nominal 52w range, 90d avg volume, total-return
windows, inception). The price chart pulls from the existing `/prices` endpoint
(which already falls back to `sfp`), and the fund's 13F holders come from the
existing `/institutional/top-holders` endpoint — both keyed on the same permaticker.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from core.api.serialize import json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.securities import prices as prices_repo, securities

router = APIRouter(tags=["etf"])


@router.get("/etf/{permaticker}")
@router.get("/etf/{permaticker}/")
def get_etf(permaticker: str) -> dict[str, Any]:
    """Profile + price-derived metrics for one fund/ETF (by permaticker)."""
    pt = permaticker.strip().rstrip("/").strip()
    with session_scope() as s:
        profile = securities.get_profile(s, pt)
        if not profile:
            raise HTTPException(status_code=404, detail="security not found")
        metrics = prices_repo.etf_metrics(s, pt)
    # json_safe scrubs NaN/inf per row-dict (it takes a list); FastAPI serialises dates.
    return {
        "profile": json_safe([profile])[0],
        "metrics": json_safe([metrics])[0] if metrics else {},
    }


@router.get("/etf/{permaticker}/family")
@router.get("/etf/{permaticker}/family/")
def etf_family(permaticker: str) -> dict[str, Any]:
    """The fund's parent SEC CIK and its family of series + share classes (siblings).
    Classes we carry link to their page by permaticker; see securities.fund_family."""
    pt = permaticker.strip().rstrip("/").strip()
    with session_scope() as s:
        family = securities.fund_family(s, pt)
    return family or {"cik": None, "series": []}


@router.get("/etf/{permaticker}/is-fund")
def is_fund(permaticker: str) -> dict[str, Any]:
    """Lightweight check used by the equity page to redirect funds to /etf."""
    pt = permaticker.strip().rstrip("/").strip()
    with session_scope() as s:
        profile = securities.get_profile(s, pt) or {}
    return {"permaticker": pt, "is_fund": (profile.get("category") == "ETF")}
