"""Where every byte in this database comes from — the data-source registry.

This is the **single source of truth** for provenance *and* for the load plan. One entry
per ingestable dataset: who provides it, the endpoint it is pulled from, which credential
unlocks it, what licence it carries, how big it lands, which tables it writes, and how it
is refreshed.

Three things read it, which is the whole point — they cannot drift:

- `core.setup.bootstrap` builds its step list from `DATASETS`, so the from-zero build
  runs exactly what is declared here (and can print provenance per step: `--sources`).
- the Setup UI and its scheduler run those same datasets by key, so a scheduled refresh
  refresh uses the same modes.
- `docs/setup/sources.md` is written from it by hand now that the generator is gone; the
  table of sources is generated, never hand-maintained.

**Adding a data source is therefore a registry entry plus a loader**, not an edit in four
places — and nothing can quietly ingest from somewhere undocumented.

    from core.backend import sources
    sources.DATASETS                 # every dataset, in dependency order
    sources.SOURCES["sharadar"]      # the provider behind it
    sources.sharadar_plan()          # [(TABLE, mode, kwargs)] for the loaders
"""
from __future__ import annotations

from dataclasses import dataclass, field

# --------------------------------------------------------------------------- providers


@dataclass(frozen=True)
class Source:
    """An upstream data provider."""

    id: str
    provider: str
    short: str                    # column-width-friendly name for CLI tables
    url: str                      # human landing page, for the docs
    licence: str                  # what you are allowed to do with it
    cadence: str                  # how often upstream changes
    blurb: str
    auth_env: str | None = None   # the core/.env key that unlocks it, if any
    docs_url: str = ""
    caveat: str = ""              # the thing that bites people


SOURCES: dict[str, Source] = {
    s.id: s
    for s in [
        Source(
            id="sharadar",
            short="Sharadar",
            provider="Sharadar (via Nasdaq Data Link)",
            url="https://data.nasdaq.com/databases/SFA",
            docs_url="https://data.nasdaq.com/databases/SFA/documentation",
            licence="Paid subscription — NOT redistributable",
            cadence="End-of-day, typically refreshed by mid-evening US time",
            auth_env="NASDAQ_DATA_LINK_API_KEY",
            blurb="US equity fundamentals, prices, corporate actions, insider "
                  "transactions and 13F institutional holdings, from 1998. The company "
                  "layer — the bulk of the database.",
            caveat="Your subscription tier decides which tables you can pull; a table "
                   "outside it returns 403 rather than an empty result.",
        ),
        Source(
            id="fred",
            short="FRED",
            provider="FRED — Federal Reserve Bank of St. Louis",
            url="https://fred.stlouisfed.org/",
            docs_url="https://fred.stlouisfed.org/docs/api/fred/",
            licence="Free; most series are public domain (some carry provider terms)",
            cadence="Per-series; the MD/QD panels publish a new vintage monthly",
            auth_env="FRED_API_KEY",
            blurb="Macro, rates and inflation series, plus the FRED-MD / FRED-QD "
                  "research panels — the broad-market layer everything else sits in.",
            caveat="The MD/QD vintage files are point-in-time snapshots: keeping every "
                   "vintage is what makes a no-look-ahead macro backtest possible.",
        ),
        Source(
            id="finra",
            short="FINRA",
            provider="FINRA",
            url="https://www.finra.org/finra-data/browse-catalog/short-interest",
            docs_url="https://api.finra.org/",
            licence="Free, public",
            cadence="Twice monthly, per settlement date",
            blurb="Consolidated short interest per security per settlement date.",
        ),
        Source(
            id="sec",
            short="SEC EDGAR",
            provider="SEC EDGAR",
            url="https://www.sec.gov/search-filings",
            docs_url="https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            licence="Free, public domain",
            cadence="Reference file; changes slowly",
            auth_env="SEC_USER_AGENT",
            blurb="Fund series/class map (CIK → series → share classes), used for the "
                  "ETF/fund-family navigation.",
            caveat="SEC returns 403 to any request without a descriptive User-Agent "
                   "carrying a real contact, and rate-limits by that identity — set "
                   "SEC_USER_AGENT to your own, never someone else's.",
        ),
        Source(
            id="derived",
            short="computed here",
            provider="Computed locally",
            url="",
            licence="Yours — produced from the sources above",
            cadence="Rebuilt after every ingest, once all inputs are fresh",
            blurb="Precomputed tables the app reads directly, so a page load never pays "
                  "for a multi-minute scan of the 40M-row panels.",
            caveat="Rebuilt LAST on purpose. Building one while its inputs are still "
                   "loading gives you a snapshot of half-updated data.",
        ),
    ]
}


# --------------------------------------------------------------------------- datasets


@dataclass(frozen=True)
class Dataset:
    """One ingestable unit — a step in a build, and a row in the sources table."""

    key: str                       # "sharadar:SEP"; the bootstrap step id
    source: str                    # -> SOURCES[...]
    label: str                     # human name
    phase: str                     # schema | sharadar | fred | finra | sec | derived
    endpoint: str                  # Nasdaq table code, URL, or - for derived - the FULL
                                   # dotted path of the function that builds it. Full, not
                                   # relative: a path assembled from a guessed package
                                   # prefix breaks silently when modules are moved.
    tables: tuple[str, ...] = ()   # Postgres tables it writes
    mode: str | None = None        # sharadar loader mode: sync | quarters | full
    kwargs: dict = field(default_factory=dict)
    note: str = ""


    @property
    def table(self) -> str | None:
        """The table used to decide "has this step already run?" on a resume."""
        return self.tables[0] if self.tables else None


# Order is dependency order and is load-bearing:
#   TICKERS first  — it builds permaticker_lookup, which every other table's permaticker
#                    stamping reads.
#   derived last   — rebuilt once, after every input is fresh.
DATASETS: list[Dataset] = [
    # -- schema ------------------------------------------------------------------
    Dataset(key="schema", source="derived", label="schema (create tables)",
            phase="schema", endpoint="core.backend.db.models", note="Creates the tables SQLAlchemy owns. Safe to re-run."),

    # -- Sharadar ----------------------------------------------------------------
    # `mode` is not a style choice: Sharadar tables differ in which change-column they
    # expose, and the query API caps ~1M rows/call. See docs/reference/schema.md -> "Updating".
    Dataset(key="sharadar:TICKERS", source="sharadar", label="tickers (security master)",
            phase="sharadar", endpoint="SHARADAR/TICKERS", tables=("tickers",), mode="sync",
            note="Load first — builds permaticker_lookup for every other table."),
    Dataset(key="sharadar:SF1", source="sharadar", label="fundamentals",
            phase="sharadar", endpoint="SHARADAR/SF1", tables=("sf1",), mode="sync"),
    Dataset(key="sharadar:METRICS", source="sharadar", label="metrics",
            phase="sharadar", endpoint="SHARADAR/METRICS", tables=("metrics",), mode="sync"),
    Dataset(key="sharadar:SEP", source="sharadar", label="equity prices (EOD)",
            phase="sharadar", endpoint="SHARADAR/SEP", tables=("sep",), mode="sync",
            note="The big one. Required for price history and charts."),
    Dataset(key="sharadar:SFP", source="sharadar", label="fund prices (ETF/CEF)",
            phase="sharadar", endpoint="SHARADAR/SFP", tables=("sfp",), mode="sync", kwargs={"chunk_key": "ticker"},
            note="Restamps >1M rows/day, so that day is pulled in ticker-chunks."),
    Dataset(key="sharadar:DAILY", source="sharadar", label="daily valuation (mktcap, P/E, EV)",
            phase="sharadar", endpoint="SHARADAR/DAILY", tables=("daily",), mode="sync",
            note="Drives the screener snapshot."),
    Dataset(key="sharadar:ACTIONS", source="sharadar", label="corporate actions",
            phase="sharadar", endpoint="SHARADAR/ACTIONS", tables=("actions",), mode="sync", kwargs={"sync_col": "date"}),
    Dataset(key="sharadar:SP500", source="sharadar", label="S&P 500 membership changes",
            phase="sharadar", endpoint="SHARADAR/SP500", tables=("sp500",), mode="sync", kwargs={"sync_col": "date"}),
    Dataset(key="sharadar:EVENTS", source="sharadar", label="events",
            phase="sharadar", endpoint="SHARADAR/EVENTS", tables=("events",), mode="sync", kwargs={"sync_col": "date"}),
    Dataset(key="sharadar:SF2", source="sharadar", label="insider transactions",
            phase="sharadar", endpoint="SHARADAR/SF2", tables=("sf2",), mode="sync", kwargs={"sync_col": "filingdate"},
            note="No lastupdated column — deltas come off filingdate."),
    # The 13F tables date on `date`, not `calendardate`: Sharadar renamed it, and SF3
    # swapped `investorname` for `investorid` and dropped `price`. Verified against
    # INDICATORS, the query API and the bulk export, which all agree. SF3B carries the
    # investorid -> investorname map (13,247 ids, 1:1), which is why it must load BEFORE
    # SF3 — the sf3 enrichment reads it to denormalise the name back on.
    Dataset(key="sharadar:SF3A", source="sharadar", label="13F holdings by investor",
            phase="sharadar", endpoint="SHARADAR/SF3A", tables=("sf3a",), mode="sync", kwargs={"sync_col": "date"}),
    Dataset(key="sharadar:SF3B", source="sharadar", label="13F holdings by security",
            phase="sharadar", endpoint="SHARADAR/SF3B", tables=("sf3b",), mode="sync", kwargs={"sync_col": "date"},
            note="Also the investor dimension: investorid -> investorname for SF3."),
    Dataset(key="sharadar:SF3", source="sharadar", label="13F holdings detail",
            phase="sharadar", endpoint="SHARADAR/SF3", tables=("sf3",), mode="quarters",
            kwargs={"quarter_col": "date"},
            note="No change column at all — recent quarters are re-pulled in key-chunks."),

    # -- FRED --------------------------------------------------------------------
    Dataset(key="fred:FRED-MD", source="fred", label="FRED-MD monthly vintages",
            phase="fred",
            endpoint="https://www.stlouisfed.org/-/media/project/frbstl/stlouisfed/research/fred-md/monthly",
            tables=("fred_observations",),
            note="Every published vintage — point-in-time macro, no look-ahead."),
    Dataset(key="fred:FRED-QD", source="fred", label="FRED-QD quarterly vintages",
            phase="fred",
            endpoint="https://www.stlouisfed.org/-/media/project/frbstl/stlouisfed/research/fred-md/quarterly",
            tables=("fred_observations",)),
    Dataset(key="fred:spot", source="fred", label="commodity spot series",
            phase="fred", endpoint="FRED API — COMMODITY_SPOT_SERIES",
            tables=("fred_observations",)),

    # -- FINRA -------------------------------------------------------------------
    Dataset(key="finra:short_interest", source="finra", label="short interest",
            phase="finra", endpoint="https://api.finra.org/ (equity short interest)",
            tables=("finra_short_interest",)),

    # -- SEC ---------------------------------------------------------------------
    Dataset(key="sec:fund_classes", source="sec", label="fund class map",
            phase="sec", endpoint="https://www.sec.gov/files/company_tickers_mf.json",
            tables=("sec_fund_class",)),

    # -- derived (computed here, from everything above) ---------------------------
    Dataset(key="derived:screener_snapshot", source="derived", label="screener snapshot",
            phase="derived", endpoint="core.backend.queries.discovery.screener.refresh_snapshot",
            tables=("screener_snapshot",),
            note="What the screener and every saved screen actually read."),
    Dataset(key="derived:holder_timeseries", source="derived", label="holder time-series",
            phase="derived", endpoint="core.backend.queries.ownership.institutional.refresh_holder_timeseries",
            tables=("holder_timeseries",)),
    Dataset(key="derived:institutional_holdings_timeseries", source="derived",
            label="institutional holdings time-series", phase="derived",
            endpoint="core.backend.queries.ownership.institutional.refresh_investor_holdings_timeseries",
            tables=("institutional_holdings_timeseries",)),
    Dataset(key="derived:derived.insider", source="derived", label="insider aggregates",
            phase="derived", endpoint="core.backend.queries.ownership.insiders.refresh", tables=("derived.insider", "derived.insider_company"),
            note="Lives in the `derived` schema, not `public`."),
    Dataset(key="derived:sp500_concentration", source="derived", label="S&P 500 concentration",
            phase="derived", endpoint="core.backend.queries.market.sp500.refresh_concentration", tables=("sp500_concentration", "sp500_sector_weights")),
]

BY_KEY: dict[str, Dataset] = {d.key: d for d in DATASETS}

# The two KINDS of work, which differ in every way that matters operationally:
#
#   ingest  - pulls bytes from an external provider. Slow, network-bound, rate-limited,
#             Interrupting one costs a download you may have to repeat.
#   derive  - computes locally from what is already in the database. No network, no cost,
#             minutes not hours, and safe to re-run at any time.
#
# They are separated because "rebuild the screener snapshot" and "re-download 35 GB" are
# not the same decision, and a UI that offers one button for both makes the cheap, safe
# operation feel as risky as the expensive one.
INGEST_PHASES: tuple[str, ...] = ("sharadar", "fred", "finra", "sec")
DERIVE_PHASES: tuple[str, ...] = ("derived",)


def phase_kind(phase: str) -> str:
    """`ingest`, `derive`, or `schema` - what kind of work a phase does."""
    if phase in INGEST_PHASES:
        return "ingest"
    if phase in DERIVE_PHASES:
        return "derive"
    return "schema"


# Phase order + a one-line description, for the docs and the checklist.
PHASES: list[tuple[str, str]] = [
    ("schema", "Create the tables SQLAlchemy owns."),
    ("sharadar", "The company layer — the bulk of the data, and the only paid source."),
    ("fred", "The macro layer. Free, and independent of Sharadar."),
    ("finra", "Short interest."),
    ("sec", "Fund series/class reference data."),
    ("derived", "Precomputed tables the app reads. Rebuilt last, once inputs are fresh."),
]


# --------------------------------------------------------------------------- helpers


def sharadar_plan() -> list[tuple[str, str, dict]]:
    """`[(TABLE, mode, kwargs)]` in load order — what the Sharadar loaders consume.

    `update_all.SHARADAR_PLAN` is this, so the routine refresh and the from-zero build
    are the same plan by construction rather than by discipline."""
    return [
        (d.key.split(":", 1)[1], d.mode or "full", dict(d.kwargs))
        for d in DATASETS
        if d.phase == "sharadar"
    ]



def step_tables() -> dict[str, str]:
    """Step key -> the table that answers "did this already run?" on a resume."""
    return {d.key: d.table for d in DATASETS if d.table}


def by_phase(phase: str) -> list[Dataset]:
    return [d for d in DATASETS if d.phase == phase]




def required_env() -> list[tuple[str, list[str]]]:
    """`[(ENV_VAR, [source provider, ...])]` — every credential a full build needs, and
    what each one unlocks. Drives the preflight and the setup checklist."""
    out: dict[str, list[str]] = {}
    used = {d.source for d in DATASETS}
    for sid in used:
        src = SOURCES[sid]
        if src.auth_env:
            out.setdefault(src.auth_env, []).append(src.provider)
    return sorted(out.items())
