"""ORM models — the storage schema.

Foundation for "collect and store data": a `securities` catalogue and a
`daily_prices` time series. Add tables here as new data types arrive
(fundamentals, events/catalysts, etc.) and they'll flow through the same layers.
"""
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.backend.db.base import Base


class EventCode(Base):
    """Legend for EVENTS.eventcodes — Sharadar's 2-digit code -> human label.

    Sourced from SHARADAR/INDICATORS where table='EVENTCODES'. Lets us decode
    "22|71|91" into readable catalyst labels (see the `events_decoded` view).
    """

    __tablename__ = "event_codes"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)


class FredSeries(Base):
    """A FRED-MD / FRED-QD macro series — the catalogue (id + recommended transform).

    Sourced from the St. Louis Fed curated panels. `series_id` is the panel's own
    column name (usually a FRED code like `CPIAUCSL`, sometimes McCracken-adjusted
    e.g. `RETAILx`, `VIXCLSx`, or a label like `S&P 500`). `tcode` is McCracken's
    recommended stationarity transform (see TCODE_LABELS) — kept as metadata and
    applied at analysis time, never baked into the stored values.
    """

    __tablename__ = "fred_series"

    series_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    dataset: Mapped[str | None] = mapped_column(String(16))  # FRED-MD | FRED-QD
    tcode: Mapped[int | None] = mapped_column(Integer)       # McCracken transform code
    title: Mapped[str | None] = mapped_column(Text)          # backfilled from FRED API
    # The underlying FRED series code the title was confirmed against (the panel's
    # `series_id` minus McCracken's trailing `x`, e.g. RETAILx -> RETAIL). Set only
    # when the FRED API confirmed it exists; lets the UI link straight to the FRED
    # series page. Null when unresolved (e.g. AMDMNOx, S&P 500) — never guessed.
    fred_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    observations: Mapped[list["FredObservation"]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )


class FredObservation(Base):
    """One raw (untransformed) value per series, per date, per vintage.

    `vintage` = "current" for the latest release, or "YYYY-MM" for a dated FRED-MD
    vintage — letting point-in-time vintages coexist for honest (no look-ahead)
    backtests. Long format mirrors `daily_prices`: one row per series/date.
    """

    __tablename__ = "fred_observations"
    __table_args__ = (
        UniqueConstraint(
            "series_id", "date", "vintage", name="uq_fred_obs_series_date_vintage"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[str] = mapped_column(
        ForeignKey("fred_series.series_id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date] = mapped_column(Date, index=True)
    value: Mapped[float | None] = mapped_column(Float)
    vintage: Mapped[str] = mapped_column(String(16), default="current")

    series: Mapped["FredSeries"] = relationship(back_populates="observations")


class FredFile(Base):
    """Registry of FRED source files saved on disk under `core/data/fred/`.

    One row per downloaded file (the revised `current.csv` and each point-in-time
    vintage CSV). Tracks provenance + freshness: `requested_at` is the last time we
    fetched it from the source; `content_updated_at` is the last time the bytes
    actually changed (detected via `sha256`), so re-runs that re-download identical
    files don't spuriously bump it. `path` is relative to `core/data/fred/`.
    """

    __tablename__ = "fred_files"

    path: Mapped[str] = mapped_column(String(255), primary_key=True)
    dataset: Mapped[str | None] = mapped_column(String(16))   # FRED-MD | FRED-QD
    kind: Mapped[str | None] = mapped_column(String(16))      # revised | vintage
    vintage: Mapped[str | None] = mapped_column(String(16))   # YYYY-MM | current
    source_url: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))
    n_bytes: Mapped[int | None] = mapped_column(BigInteger)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class FinraShortInterest(Base):
    """FINRA Consolidated Equity Short Interest — bi-monthly short positions.

    A faithful mirror of FINRA's public `otcMarket/consolidatedShortInterest`
    dataset (no auth, no key): one row per security per settlement date, all
    markets (NYSE/Nasdaq/ARCA/AMEX/Cboe/OTC) consolidated. Bi-monthly (mid-month
    + end-of-month settlement), 2017-12-29 → present. This is the squeeze-signal
    layer DFV weighted heavily and the Sharadar bundle lacks (see
    a squeeze setup).

    Stored verbatim (data-fidelity: mirror the source, derive nothing). The feed
    carries **no CUSIP, no permaticker, no float, no shares outstanding** — so we
    store *only* FINRA's own fields and resolve `permaticker` at **read time**
    (never materialized here) via the `finra_short_interest_resolved` view, which
    point-in-time-joins `symbol` to the issuer that held it on the settlement
    date (`tickers.[firstpricedate, lastpricedate]`). Market is NOT a join key:
    FINRA's `marketClassCode` (NNM/SC/ARCA/BZX/…) doesn't map cleanly to Sharadar
    exchanges. Short-%-of-float / days-to-cover-vs-our-volume are likewise
    computed at read time against `sf1`/`daily`, never stored.

    Column → FINRA field:
      symbol           ← symbolCode            issue_name     ← issueName
      settlementdate   ← settlementDate        market         ← marketClassCode
      current_short    ← currentShortPositionQuantity
      previous_short   ← previousShortPositionQuantity
      change_short     ← changePreviousNumber  change_pct     ← changePercent
      avg_daily_vol    ← averageDailyVolumeQuantity
      days_to_cover    ← daysToCoverQuantity   accounting_ym  ← accountingYearMonthNumber
      stock_split_flag ← stockSplitFlag        revision_flag  ← revisionFlag
      issuer_exchange  ← issuerServicesGroupExchangeCode
    """

    __tablename__ = "finra_short_interest"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "settlementdate", "market",
            name="uq_finra_si_symbol_date_market",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    issue_name: Mapped[str | None] = mapped_column(Text)
    settlementdate: Mapped[date] = mapped_column(Date, index=True)
    market: Mapped[str | None] = mapped_column(String(8))
    current_short: Mapped[int | None] = mapped_column(BigInteger)
    previous_short: Mapped[int | None] = mapped_column(BigInteger)
    change_short: Mapped[int | None] = mapped_column(BigInteger)
    change_pct: Mapped[float | None] = mapped_column(Float)
    avg_daily_vol: Mapped[int | None] = mapped_column(BigInteger)
    days_to_cover: Mapped[float | None] = mapped_column(Float)
    accounting_ym: Mapped[int | None] = mapped_column(Integer)
    stock_split_flag: Mapped[str | None] = mapped_column(String(8))
    revision_flag: Mapped[str | None] = mapped_column(String(8))
    issuer_exchange: Mapped[str | None] = mapped_column(String(8))


class SyncState(Base):
    """Watermark per source table: the high-water `lastupdated` we've ingested.

    Incremental syncs query the source for rows with lastupdated >= this date,
    upsert them, then advance the watermark. One row per source table.
    """

    __tablename__ = "sync_state"

    table_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    last_updated_date: Mapped[date | None] = mapped_column(Date)
    last_run: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rows_loaded: Mapped[int | None] = mapped_column(BigInteger)


class LoadLog(Base):
    """Append-only ledger of every ingestion: which dataset, when requested, how
    it went. One row per run (downloads, backfills, syncs) — the audit trail
    behind `latest_by_dataset()` ("what have we loaded and when").
    """

    __tablename__ = "load_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32))  # SHARADAR, FRED, ...
    dataset: Mapped[str] = mapped_column(String(64), index=True)  # e.g. SHARADAR/SEP
    operation: Mapped[str] = mapped_column(String(32))  # download | backfill | sync
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok | error
    rows: Mapped[int | None] = mapped_column(BigInteger)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    detail: Mapped[str | None] = mapped_column(Text)
