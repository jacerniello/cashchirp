"""Sector cross-section — aggregate the equity universe by GICS-style sector.

A read-time roll-up of the precomputed `screener_snapshot` (one row per security,
~17k rows, so the group-by is instant — no derived table needed). For each sector it
reports breadth (constituent count, % profitable), size (total / median market cap
and the sector's share of total market cap), and **cap-weighted aggregate** valuation
& quality ratios.

Why **cap-weighted aggregates**, not medians: a sector's "P/E" computed as a *median
across members* is dominated by tiny, often loss-making micro-caps (the median P/E of
the whole tech universe is negative — not what an investor means by "the tech sector"),
and a median P/E is ill-defined when many members lose money (the ratio is discontinuous
through zero). So each ratio is rolled up cap-weighted: **P/E = 1 / Σ wᵢ·(1/P/Eᵢ)** (the
cap-weighted *earnings yield*, inverted — the index-P/E identity; loss-makers net in via
their negative yield, and if the sector's aggregate yield is ≤0 the P/E is reported null
rather than as a nonsense number), likewise P/S and P/B; margins, ROE and sales growth
are cap-weighted means.

**Currency-safe by construction.** We aggregate the *ratios*, never raw dollar sums:
`daily.marketcap` is USD but SF1 fundamentals are in each issuer's *reporting* currency
(foreign ADRs report revenue/equity in KRW, INR, … — and `tickers.currency` is the
*trading* currency, USD, so it can't flag them). A P/E or margin is dimensionless and
identical in any currency, so cap-weighting ratios sidesteps the mismatch that summing
Σcap(USD)/Σrevenue(local) would create. A **market-cap floor** (`min_mktcap`) trims the
micro-cap tail so the cross-section reflects the investable sector.

Caveat — sector labels are **point-in-time-naive**: `tickers.sector` is a single
*current* GICS-style classification with no history, so any over-time sector view
(`/sp500/sectors`) applies today's taxonomy backward (e.g. the 2018 Communication
Services reshuffle). This cross-section is as-of-now, so that doesn't bite here, but
it's the same `sector` field.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries.discovery import screener


def _cap_wavg(g: pd.DataFrame, col: str, clip: tuple[float, float] | None = None) -> float | None:
    """Cap-weighted mean of a currency-neutral per-company ratio (margin, ROE, growth).
    `clip` winsorises per-company values first: a margin/ROE/growth far outside a sane
    band is a near-zero-denominator artifact (e.g. net margin of 16,000% on trivial
    revenue) that would dominate even a cap-weighted mean, so it's pulled to the band."""
    sub = g[[col, "marketcap"]].dropna()
    w = sub["marketcap"].sum()
    if sub.empty or w <= 0:
        return None
    vals = sub[col].clip(*clip) if clip else sub[col]
    return float((vals * sub["marketcap"]).sum() / w)


def _cap_harmonic(g: pd.DataFrame, col: str) -> float | None:
    """Cap-weighted *harmonic* mean of a valuation multiple = 1 / Σ wᵢ·(1/ratioᵢ) — the
    index-multiple identity. Loss-makers (negative multiple) net in via their yield; a
    sector whose aggregate yield is ≤0 has no meaningful multiple, so return None."""
    sub = g[[col, "marketcap"]].dropna()
    sub = sub[sub[col] != 0]
    w = sub["marketcap"].sum()
    if sub.empty or w <= 0:
        return None
    yld = float((sub["marketcap"] * (1.0 / sub[col])).sum() / w)
    return (1.0 / yld) if yld > 0 else None


def overview(session: Session, min_mktcap: float = 0.0) -> pd.DataFrame:
    """One row per sector with breadth, size, % profitable, and cap-weighted aggregate
    valuation/quality ratios, over members with market cap ≥ `min_mktcap`. Sorted by
    total market cap, biggest first."""
    df = screener.snapshot(session)
    df = df[df["sector"].notna() & (df["sector"] != "")]
    df = df[df["marketcap"] > 0]
    if min_mktcap:
        df = df[df["marketcap"] >= min_mktcap]
    if df.empty:
        return pd.DataFrame()

    total_cap = float(df["marketcap"].sum())
    rows = []
    for sector, g in df.groupby("sector"):
        cap = float(g["marketcap"].sum())
        eps = g["eps"]
        n_eps = int(eps.notna().sum())
        rows.append({
            "sector": sector,
            "n": int(len(g)),
            "pct_profitable": (float((eps > 0).sum()) / n_eps * 100.0) if n_eps else None,
            "total_mktcap": cap,
            "weight": cap / total_cap * 100.0 if total_cap else None,
            "median_mktcap": float(g["marketcap"].median()),
            # cap-weighted aggregates of currency-neutral per-company ratios. Multiples
            # via the harmonic (earnings-yield) identity; margins/growth as decimals
            # (0.12 = 12%) so the UI's percent formatter applies.
            "pe": _cap_harmonic(g, "pe"),
            "ps": _cap_harmonic(g, "ps"),
            "pb": _cap_harmonic(g, "pb"),
            "net_margin": _cap_wavg(g, "net_margin", clip=(-1.0, 1.0)),
            "roe": _cap_wavg(g, "roe", clip=(-1.0, 1.0)),
            "sales_g_ttm": _cap_wavg(g, "sales_g_ttm", clip=(-0.9, 3.0)),
        })

    out = pd.DataFrame(rows).sort_values("total_mktcap", ascending=False)
    return out.replace({np.nan: None}).reset_index(drop=True)
