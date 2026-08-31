"""Fundamentals (`sf1`) — Sharadar Core US Fundamentals.

One row per (ticker, reportperiod, dimension, datekey). `dimension` selects the view:
AR* = as-reported, MR* = most-recent (restated); *Q quarterly, *Y annual, *T trailing-12m.
Default to **MRT** (trailing twelve months, restated) for time series. Lookups by
permaticker (indexed, stable).
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from core.backend.queries._common import query_df, rows

DIMENSIONS = ["MRT", "ART", "MRQ", "ARQ", "MRY", "ARY"]

# Grouped fields surfaced in the UI (Sharadar SF1 columns).
FIELD_GROUPS: dict[str, list[str]] = {
    "Income statement": [
        "revenue", "cor", "gp", "opex", "ebitda", "ebit", "opinc", "intexp",
        "taxexp", "netinc", "netinccmn", "eps", "epsdil", "shareswa",
    ],
    "Balance sheet": [
        "assets", "assetsc", "assetsnc", "cashneq", "investments", "inventory",
        "receivables", "ppnenet", "intangibles", "liabilities", "liabilitiesc",
        "liabilitiesnc", "debt", "deferredrev", "payables", "equity", "retearn",
    ],
    "Cash flow": [
        "ncfo", "ncfi", "ncff", "capex", "fcf", "depamor", "sbcomp",
        "ncfdiv", "ncfdebt", "ncfcommon",
    ],
    "Margins & returns": [
        "grossmargin", "ebitdamargin", "netmargin", "roe", "roa", "roic", "ros",
        "assetturnover", "payoutratio", "divyield",
    ],
    "Valuation": [
        "marketcap", "ev", "pe", "pe1", "ps", "ps1", "pb", "evebit", "evebitda",
        "price", "bvps", "fcfps", "sps", "dps", "currentratio", "de",
    ],
}
ALL_FIELDS = [f for fields in FIELD_GROUPS.values() for f in fields]

# Human-readable line-item labels for the recreated statements (Sharadar SF1 codes).
FIELD_LABELS: dict[str, str] = {
    # Income statement
    "revenue": "Revenue", "cor": "Cost of revenue", "gp": "Gross profit",
    "opex": "Operating expenses", "ebitda": "EBITDA", "ebit": "EBIT",
    "opinc": "Operating income", "intexp": "Interest expense",
    "taxexp": "Income tax expense", "netinc": "Net income",
    "netinccmn": "Net income to common", "eps": "EPS (basic)",
    "epsdil": "EPS (diluted)", "shareswa": "Weighted avg shares",
    # Balance sheet
    "assets": "Total assets", "assetsc": "Current assets",
    "assetsnc": "Non-current assets", "cashneq": "Cash & equivalents",
    "investments": "Investments", "inventory": "Inventory",
    "receivables": "Receivables", "ppnenet": "Property, plant & equip (net)",
    "intangibles": "Intangibles & goodwill", "liabilities": "Total liabilities",
    "liabilitiesc": "Current liabilities", "liabilitiesnc": "Non-current liabilities",
    "debt": "Total debt", "deferredrev": "Deferred revenue", "payables": "Payables",
    "equity": "Shareholder equity", "retearn": "Retained earnings",
    # Cash flow
    "ncfo": "Cash from operations", "ncfi": "Cash from investing",
    "ncff": "Cash from financing", "capex": "Capital expenditure",
    "fcf": "Free cash flow", "depamor": "Depreciation & amortization",
    "sbcomp": "Stock-based compensation", "ncfdiv": "Dividends paid",
    "ncfdebt": "Net debt issued/(repaid)", "ncfcommon": "Net stock issued/(repurchased)",
    # Margins & returns
    "grossmargin": "Gross margin", "ebitdamargin": "EBITDA margin",
    "netmargin": "Net margin", "roe": "Return on equity", "roa": "Return on assets",
    "roic": "Return on invested capital", "ros": "Return on sales",
    "assetturnover": "Asset turnover", "payoutratio": "Payout ratio",
    "divyield": "Dividend yield",
    # Valuation
    "marketcap": "Market cap", "ev": "Enterprise value", "pe": "P/E", "pe1": "P/E (1y)",
    "ps": "P/S", "ps1": "P/S (1y)", "pb": "P/B", "evebit": "EV/EBIT",
    "evebitda": "EV/EBITDA", "price": "Price", "bvps": "Book value / share",
    "fcfps": "FCF / share", "sps": "Sales / share", "dps": "Dividends / share",
    "currentratio": "Current ratio", "de": "Debt / equity",
}


# How each field should be formatted (kinds map to core.frontend.components.format).
_PCT = {"grossmargin", "ebitdamargin", "netmargin", "roe", "roa", "roic", "ros",
        "payoutratio", "divyield"}
_RATIO = {"pe", "pe1", "ps", "ps1", "pb", "evebit", "evebitda", "currentratio",
          "de", "assetturnover"}
_PERSHARE = {"eps", "epsdil", "bvps", "fcfps", "sps", "dps", "price"}
FIELD_KIND: dict[str, str] = {
    f: ("percent" if f in _PCT else "ratio" if f in _RATIO
        else "pershare" if f in _PERSHARE else "shares" if f == "shareswa"
        else "money")
    for f in ALL_FIELDS
}


def available_dimensions(session: Session, permaticker: int | str) -> list[str]:
    df = query_df(
        session,
        "SELECT DISTINCT dimension FROM sf1 WHERE permaticker = :pt",
        {"pt": int(permaticker)},
    )
    have = set(df["dimension"].tolist())
    return [d for d in DIMENSIONS if d in have] or DIMENSIONS


def timeseries(
    session: Session, permaticker: int | str, dimension: str = "MRT",
    fields: list[str] | None = None,
) -> pd.DataFrame:
    """Wide fundamentals time series for one security/dimension, by calendardate."""
    cols = fields or ALL_FIELDS
    cols = [c for c in cols if c in ALL_FIELDS]  # whitelist
    select = ", ".join(["calendardate", "reportperiod", "datekey", "fiscalperiod"] + cols)
    return query_df(
        session,
        f"SELECT {select} FROM sf1 "
        "WHERE permaticker = :pt AND dimension = :dim "
        "ORDER BY calendardate",
        {"pt": int(permaticker), "dim": dimension},
    )


def latest(
    session: Session, permaticker: int | str, dimension: str = "MRT"
) -> dict | None:
    res = rows(
        session,
        "SELECT * FROM sf1 WHERE permaticker = :pt AND dimension = :dim "
        "ORDER BY calendardate DESC LIMIT 1",
        {"pt": int(permaticker), "dim": dimension},
    )
    return res[0] if res else None
