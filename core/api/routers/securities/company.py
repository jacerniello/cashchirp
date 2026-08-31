"""Company-detail endpoints — the per-security drill-down behind the React company
page. All routes are keyed on **permaticker** (the stable issuer id; an int in the
equity tables), never on `ticker` (symbols recycle across Sharadar products).

    GET /company/{permaticker}                 -> { profile, snapshot }
    GET /company/{permaticker}/fundamentals    -> { dimension, rows, altman_z }
    GET /company/{permaticker}/valuation       -> { daily, metrics }
    GET /company/{permaticker}/events          -> { events, actions, sp500 }

Reuses the existing repositories (securities / valuation / fundamentals / events /
health / prices). `daily.marketcap` and `daily.ev` are stored in USD **millions**, so
the snapshot scales them by 1e6 to absolute dollars before serialising. Everything is
run through `core.api.serialize` so NaN/inf collapse to null.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from core.api.serialize import df_records, json_safe
from core.backend.db.engine import session_scope
from core.backend.queries.securities import events, fundamentals, health, prices as prices_repo, securities, valuation

router = APIRouter(prefix="/company", tags=["company"])

# Profile fields surfaced to the React company header (subset of securities.get_profile).
_PROFILE_FIELDS = (
    "ticker", "name", "category", "exchange", "sector", "industry", "permaticker",
    "firstpricedate", "lastpricedate", "isdelisted", "companysite", "secfilings",
)


def _num(value: Any) -> float | None:
    """Coerce a DB value to float (None on missing/junk) for arithmetic + scaling."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


@router.get("/{permaticker}")
@router.get("/{permaticker}/")
def company_detail(permaticker: int) -> dict[str, Any]:
    """Profile + a one-row snapshot (headline valuation, fundamentals, health) for one
    security. Daily marketcap/EV are USD-millions in the mirror, so scale by 1e6."""
    with session_scope() as s:
        profile_full = securities.get_profile(s, permaticker) or {}
        daily = valuation.latest_daily(s, permaticker) or {}
        metrics = valuation.latest_metrics(s, permaticker) or {}
        fund = fundamentals.latest(s, permaticker, "MRT") or {}
        summary = prices_repo.price_summary(s, permaticker) or {}
        z = health.altman_z_timeseries(s, permaticker)

    profile = {k: profile_full.get(k) for k in _PROFILE_FIELDS}

    # Market cap: prefer the daily panel (USD millions -> absolute), fall back to the
    # MRT fundamentals marketcap (already absolute USD).
    market_cap = _num(daily.get("marketcap"))
    if market_cap is not None:
        market_cap *= 1e6
    else:
        market_cap = _num(fund.get("marketcap"))

    # Latest Altman Z (TTM) + its zone label.
    altman_z = None
    if not z.empty:
        altman_z = _num(z.iloc[-1]["altman_z"])
    altman_zone = health.z_zone(altman_z)

    snapshot = {
        "market_cap": market_cap,
        "revenue": _num(fund.get("revenue")),
        "net_income": _num(fund.get("netinc")),
        "eps": _num(fund.get("eps")),
        "pe": _num(daily.get("pe")) if daily.get("pe") is not None else _num(fund.get("pe")),
        "ps": _num(daily.get("ps")) if daily.get("ps") is not None else _num(fund.get("ps")),
        "pb": _num(daily.get("pb")) if daily.get("pb") is not None else _num(fund.get("pb")),
        "gross_margin": _num(fund.get("grossmargin")),
        "net_margin": _num(fund.get("netmargin")),
        "roe": _num(fund.get("roe")),
        "debt_equity": _num(fund.get("de")),
        "return_1y": _num(metrics.get("return1y")),
        "beta_1y": _num(metrics.get("beta1y")),
        "altman_z": altman_z,
        "altman_zone": altman_zone,
        "low_52w": _num(summary.get("low_52w")),
        "high_52w": _num(summary.get("high_52w")),
        "last_close": _num(summary.get("last_close")),
        "last_date": str(summary["last_date"]) if summary.get("last_date") else None,
    }

    return {"profile": json_safe([profile])[0], "snapshot": json_safe([snapshot])[0]}


def _z_band(value: float | None) -> dict[str, Any]:
    """Latest Altman-Z value with its zone label (mirrors the Dash band annotation)."""
    return {"value": value, "zone": health.z_zone(value)}


@router.get("/{permaticker}/fundamentals")
@router.get("/{permaticker}/fundamentals/")
def company_fundamentals(
    permaticker: int, dimension: str = Query("ARY")
) -> dict[str, Any]:
    """Wide fundamentals time series for one basis, plus the Altman Z (TTM) series and
    the grouping metadata. Returns the raw `sf1` records (json-safe); the React side
    recreates the grouped Income/Balance/Cash-flow/Margins/Valuation statements via the
    `groups`/`labels`/`kinds` maps (the same FIELD_GROUPS/FIELD_LABELS/FIELD_KIND the
    Dash tab uses), so the two stay in lockstep."""
    with session_scope() as s:
        dims = fundamentals.available_dimensions(s, permaticker)
        df = fundamentals.timeseries(s, permaticker, dimension)
        z = health.altman_z_timeseries(s, permaticker)

    z_latest = _num(z.iloc[-1]["altman_z"]) if not z.empty else None

    return {
        "dimension": dimension,
        "available_dimensions": dims,
        "rows": df_records(df),
        "altman_z": df_records(z[["calendardate", "altman_z"]]) if not z.empty else [],
        "altman_latest": _z_band(z_latest),
        "groups": fundamentals.FIELD_GROUPS,
        "labels": fundamentals.FIELD_LABELS,
        "kinds": fundamentals.FIELD_KIND,
    }


@router.get("/{permaticker}/valuation")
@router.get("/{permaticker}/valuation/")
def company_valuation(permaticker: int) -> dict[str, Any]:
    """Daily valuation (`daily`) and trading-metrics (`metrics`) series for one
    security, each capped to the most recent 2500 rows to bound the payload."""
    with session_scope() as s:
        daily = valuation.daily_series(s, permaticker)
        metrics = valuation.metrics_series(s, permaticker)

    return {
        "daily": df_records(daily.tail(2500)),
        "metrics": df_records(metrics.tail(2500)),
    }


@router.get("/{permaticker}/events")
@router.get("/{permaticker}/events/")
def company_events(permaticker: int) -> dict[str, Any]:
    """Corporate events (8-K), corporate actions (splits/dividends) and S&P 500
    membership history for one security."""
    with session_scope() as s:
        evts = events.for_security(s, permaticker)
        actions = events.actions_for_security(s, permaticker)
        sp500 = events.sp500_membership(s, permaticker)

    return {
        "events": df_records(evts),
        "actions": df_records(actions),
        "sp500": df_records(sp500),
    }
