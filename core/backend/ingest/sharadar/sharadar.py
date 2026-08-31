"""Sharadar bulk table downloads from Nasdaq Data Link.

"Bulk download" = export an entire table as one zipped CSV. The Nasdaq Data Link
SDK's `export_table` builds the file server-side, polls until it's ready, and
downloads it — so a daily refresh is one function call per table.

Docs: https://docs.data.nasdaq.com/  (package: nasdaq-data-link / import nasdaqdatalink)
"""
from pathlib import Path

import nasdaqdatalink

from core.config import settings

# Tables in the Sharadar Core US Equities bundle (vendor code SHARADAR).
SHARADAR_TABLES: dict[str, str] = {
    "SEP": "Equity prices, EOD (adjusted + unadjusted)",
    "SFP": "Fund prices (ETF/CEF), EOD",
    "SF1": "Core US Fundamentals (income/balance/cashflow)",
    "SF2": "Insider transactions (Form 3/4/5)",
    "SF3": "Institutional holdings (13F), by investor",
    "SF3A": "Institutional holdings aggregated by ticker",
    "SF3B": "Institutional holdings aggregated by investor",
    "DAILY": "Daily metrics (market cap, P/E, EV, etc.)",
    "METRICS": "Derived metrics",
    "TICKERS": "Ticker metadata / reference",
    "ACTIONS": "Corporate actions (splits, dividends, etc.)",
    "EVENTS": "Company events",
    "INDICATORS": "Indicator / column definitions",
    "SP500": "S&P 500 constituent additions/removals",
}

# Sensible daily default: prices + fundamentals + metrics + reference data.
DEFAULT_TABLES = ["SEP", "SF1", "DAILY", "TICKERS", "ACTIONS", "SP500"]

DEFAULT_DEST = Path(__file__).resolve().parents[2] / "data" / "sharadar"


def _ensure_api_key() -> None:
    key = settings.nasdaq_data_link_api_key
    if not key:
        raise RuntimeError(
            "NASDAQ_DATA_LINK_API_KEY is not set in core/.env"
        )
    nasdaqdatalink.ApiConfig.api_key = key


def export_table(table: str, dest_dir: Path = DEFAULT_DEST) -> Path:
    """Bulk-download one Sharadar table to `dest_dir/<TABLE>.zip`.

    Returns the path to the written zip (a single CSV inside). Idempotent:
    overwrites the previous day's file.
    """
    _ensure_api_key()
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{table}.zip"
    nasdaqdatalink.export_table(f"SHARADAR/{table}", filename=str(out))
    return out
