# Sources

Registry of data sources and references used in the research program. One entry per
source: what it is, what it covers, how we access it, and where it lands.

> Access keys live in `core/.env` (gitignored) — never commit credentials here.

---

## Sharadar Core US Equities Bundle — Nasdaq Data Link

- **Provider:** Sharadar (via Nasdaq Data Link). Vendor code `SHARADAR`.
- **What:** Bundle of five Sharadar products — Core US Fundamentals, Institutional
  Investors (13F), Core US Insiders, Equity Prices, and Fund Prices.
- **Coverage:** 21,000+ companies, 7,000 funds, 10,000 investors. **History from Jan 1998.**
- **Frequency:** Daily delivery; data at daily / quarterly / annual granularity.
- **Status:** Premium — **subscribed.**
- **Access:** Nasdaq Data Link Tables API + bulk export.
  - Python pkg: `nasdaq-data-link` (`import nasdaqdatalink`).
  - API key: `NASDAQ_DATA_LINK_API_KEY` in `core/.env`.
- **In this repo:** wired into `core/` —
  - **Generic loader (the standard for almost every table):**
    `core/backend/ingest/sharadar/sharadar_generic.py`, CLI
    `python -m core.scripts.load.sharadar_load_generic <CODE>`. Schema-driven: reads the
    table's column types + primary key from `SHARADAR/INDICATORS`, creates a matching
    Postgres table (named after the code, lowercased), and upserts the bulk CSV.
    Idempotent (re-run to update), prints stage/MB progress. `--no-download` reuses an
    existing zip; `--dest` overrides the table name. Casts are value-guarded (a bad value
    → NULL, never a failed load).
  - **SEP → flat `sep` mirror** (faithful, incl. `closeunadj`), loaded by the generic
    loader like every other table; daily incremental via
    `python -m core.scripts.load.sharadar_load_generic SEP --sync`. The app's Company page
    reads `sep` (by permaticker) directly.
  - **permaticker:** stamped on every table from `TICKERS` (per `(table, ticker)`, never
    derived); `python -m core.scripts.load.enrich_permaticker` (re)backfills all.
  - **verify:** `python -m core.scripts.ops.verify_sharadar` checks each table against its
    downloaded file (row count + per-column non-null).
  - **EVENTS codes (special):** load `EVENTS` with the generic loader, then
    `python -m core.scripts.load.sharadar_load_event_codes` builds the `event_codes` legend +
    the `events_decoded` view (e.g. `35` = Schedule 13D filing) — the basis for catalyst
    tagging.
  - **Download only (zip, no load):** `python -m core.scripts.load.sharadar_bulk <CODE...>`
    (`--list` for tables); zips land in `core/data/sharadar/<CODE>.zip` (gitignored).
  - **load ledger:** every run (download / backfill / sync) is recorded in `load_log`
    with `requested_at` + `completed_at`; `python -m core.scripts.ops.load_status` shows the
    latest run per dataset (what's loaded + when last requested → selective refresh).
    `sync_state` holds per-table incremental watermarks (SEP today).
  - schedule: `core/scripts/com.investing.sharadar.plist` (launchd, once/day) runs the
    SEP incremental sync.
- **Key tables:** `SEP` (equity prices EOD), `SF1` (fundamentals), `SF2` (insiders),
  `SF3`/`SF3A`/`SF3B` (13F institutional), `DAILY` (mktcap/PE/EV), `METRICS`, `TICKERS`,
  `ACTIONS` (corporate actions), `EVENTS`, `SP500` (constituent changes), `SFP` (fund
  prices), `INDICATORS` (column definitions).
- **Docs:** https://data.nasdaq.com/databases/SFA/documentation ·
  SDK: https://docs.data.nasdaq.com/
- **Notes:** Tables carry a `lastupdated` column — for efficient daily syncs, filter on
  `lastupdated.gte=<date>` instead of re-pulling full history (future enhancement).

---

## FRED — Federal Reserve Economic Data (St. Louis Fed)

- **Provider:** Federal Reserve Bank of St. Louis.
- **What:** Macroeconomic & financial time series — rates, yields, inflation (CPI/PCE),
  employment, GDP, money supply, spreads, sentiment, etc. (800k+ series).
- **Why:** Supplies the **macro regime / broad-market context** layer (step 1 of the
  research arc — the "fundamental schematic of economic activity") that company-level
  Sharadar data gets measured against.
- **Coverage / history:** Series-dependent; many run for decades.
- **Status:** Free (API key required for the web API; the FRED-MD/QD panels need no key).

### How to pull data in bulk

FRED has **no single "whole-database dump"** — the public website only downloads one
series (or one map) at a time. Three real bulk paths, in order of usefulness here:

1. **FRED-MD / FRED-QD curated panels (what we use).** Wide CSVs of ~127 monthly
   (FRED-MD) / ~245 quarterly (FRED-QD) U.S. macro series, no key required. Each file's
   leading `Transform:` row gives McCracken's recommended stationarity transform per
   series. *This is the macro-regime backbone for step 1.* Comes in two forms — see the
   **⚠ Backtesting** box below, this distinction matters.
2. **FRED web API, series by series.** `/series/observations?series_id=…` (≤100k obs/call)
   after enumerating series via `/series/search`, `/category/series`, `/release/series`,
   or `/tags/series` (≤1000/call). Rate limit **120 req/min**. Right for a small curated
   list of extras the panels lack. Key: `FRED_API_KEY` in `core/.env`. *Implemented* in
   `core/backend/ingest/fred/fred_api.py` — `python -m core.scripts.load.fred.load_spot` loads the
   curated **commodity spot** set (WTI `DCOILWTICO`, Brent `DCOILBRENTEU`, Henry Hub gas
   `DHHNGSP` daily; copper `PCOPPUSDM` monthly) into `fred_observations` under dataset
   `FRED-Spot`, backing the Commodities page. These are revision-free **market prices**,
   so the published series *is* point-in-time (tagged `vintage="current"`, safe to
   backtest) — unlike the revised macro stats in the box below. FRED has no free
   gold/silver spot (the LBMA London fixing was withdrawn over ICE licensing); GLD/SLV
   are their proxy.
3. **FRED API v2 bulk-by-release** (announced 2025-11-04): all observations for an entire
   release in one call. Not yet reachable on the standard endpoint/key — track for later.

### ⚠ Backtesting with FRED — revised vs. point-in-time (READ THIS)

Macro data is **revised** for months/years after first release. Two forms of FRED-MD:

| Form | What it is | Backtest? |
|------|-----------|-----------|
| **`current.csv`** (revised) | Latest values, full history to **1959**. Every number reflects *all later revisions*. | **NO** — injects look-ahead. Exploratory/descriptive only. |
| **Vintages** (`YYYY-MM`) | Monthly real-time snapshots; each holds only what was *known that month* (e.g. the 2015-01 snapshot stops at the Dec-2014 obs — publication lag included). | **YES** — genuine point-in-time. |

- **Verdict: FRED is fine for backtesting *iff* you use vintages.** FRED-MD/QD vintages
  are ALFRED-derived real-time data, built for exactly this (McCracken's real-time
  forecasting research). The revised `current.csv` is **not** backtest-safe.
- **Floor:** real-time vintages start **2015-01** (FRED-MD) / **2018-05** (FRED-QD).
  There is **no point-in-time FRED-MD before 2015** — pre-2015 is revised-only.
- **Where vintages come from:** a bundled zip per dataset
  (`historical-vintages-of-fred-md-2015-01-to-2024-12.zip`, ~120 monthly files).
  *Note:* bare `…/monthly/YYYY-MM.csv` URLs do **not** work — they need a per-file
  `?hash=` and the naming drifts (`-md` suffix from 2025-04); use the zip.
- **In this repo this is the default:** the loader ingests the **vintage history**
  unless you pass `--revised`. To reconstruct macro state as of date *D*, query the
  `fred_observations` rows whose `vintage` ≤ *D*'s month.

- **In this repo:** **FRED-MD/QD ingestion built.**
  - ingestor (BaseIngestor): `core/backend/ingest/fred/fred_md.py` — fetch CSV (or vintage
    zip) → melt wide→long → upsert. Stores values **raw**; the transform code is
    metadata applied at analysis time (`TCODE_LABELS`).
  - tables (`core/backend/db/models.py`): `fred_series` (id, dataset, `tcode`, title) +
    `fred_observations` (series_id, date, value, **`vintage`**); keyed
    (series_id, date, vintage) so every snapshot + the revised `current` coexist.
  - CLI: `python -m core.scripts.load.fred.load_md` → **point-in-time vintages (default,
    backtest-grade)** · `--qd` (FRED-QD) · `--limit N` (first N snapshots) ·
    `--revised` (the NOT-point-in-time `current.csv`). Every run logged to `load_log`
    (source=`FRED`).
- **Key series (FRED-MD examples):** `CPIAUCSL`/`PCEPI` (inflation), `UNRATE`/`PAYEMS`
  (labor), `FEDFUNDS`/`GS10`/`GS1`/`T10Y…` (rates/curve), `BAA`/`AAA` (credit), `S&P 500`,
  `VIXCLSx` (risk), `INDPRO`/`HOUST` (activity).
- **Docs:** FRED-MD/QD: https://www.stlouisfed.org/research/economists/mccracken/fred-databases ·
  API: https://fred.stlouisfed.org/docs/api/fred/ ·
  API keys: https://fredaccount.stlouisfed.org/apikeys

---

## FINRA Consolidated Equity Short Interest

- **Provider:** FINRA (Financial Industry Regulatory Authority). Query API.
- **What:** Consolidated short-interest positions across **all** U.S. markets
  (NYSE/Nasdaq/ARCA/AMEX/Cboe/OTC) — current & previous short shares, change, average
  daily volume, days-to-cover — one row per security per settlement date.
- **Why:** The **squeeze signal** the Sharadar bundle lacks and that DFV weighted heavily
  (the GME thesis hinged on ~140%-of-float short interest). Fills the biggest data gap
  identified by deep-value screens. Includes GME's full Jan-2021
  squeeze (71M short on 2020-12-31 → 21M by 2021-01-29).
- **Coverage / history:** **2017-12-29 → present** (verified by probe), **bi-monthly**
  (mid-month + end-of-month settlement, ~24 dates/yr), ~19k symbols/date, ~3.8M rows.
- **Status:** **Free, fully public — no API key, no OAuth** (verified). No `core/.env`
  entry needed.
- **Access:** `POST https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest`
  with `Accept: application/json` (defaults to CSV otherwise). Pagination via `limit`
  (≤5000/page), `offset`, and the `Record-Total` response header. **`settlementDate` is
  the partition key** — sort/page only *within* a date pinned by an EQUAL `compareFilter`,
  so we load date-by-date.
- **In this repo:** **ingestion built.**
  - ingestor: `core/backend/ingest/finra/finra_short_interest.py` — discover settlement-date
    calendar (from data), fetch each date paged, upsert. **Mirror is byte-faithful:** only
    FINRA's own fields are stored (no CUSIP/permaticker/float in the feed).
  - table (`core/backend/db/models.py`): `finra_short_interest`, keyed
    `(symbol, settlementdate, market)`.
  - **permaticker is NOT stored** — resolved at **read time** by the
    `finra_short_interest_resolved` view via a *point-in-time* join (the issuer that held
    the symbol on the settlement date, `tickers.[firstpricedate, lastpricedate]`),
    exposed only when unambiguous (recycled-ticker collisions → NULL, zero false
    positives). Market is **not** a join key (FINRA's `marketClassCode` doesn't map to
    Sharadar exchanges). Exchange-listed names resolve 63–94%; OTC barely resolves (~2%)
    as Sharadar's bundle doesn't cover pink-sheet names — an honest universe gap.
  - **% of float / days-to-cover are computed at read time** against `sf1`/`daily`, never
    stored. ⚠ **Split caveat:** FINRA `current_short` is **as-filed**; `sf1.sharesbas` is
    **split-adjusted backward** — divide as-filed-by-split-adjusted and you understate
    short% by the split factor (GME: 61.7M short ÷ 279M split-adj shares = 22% vs. the
    real ~88% on ~70M pre-split shares). Reconcile splits (like `holder_timeseries`'
    `adj_units`) when building the feature.
  - CLI: `python -m core.scripts.load.finra_load` (incremental sync, default) ·
    `--backfill` (full 2017→present) · `--backfill --start YYYY-MM-DD`. `sync_state`
    holds the settlement-date watermark; every run logged to `load_log` (source=`FINRA`).
- **Docs:** https://developer.finra.org/docs (Query API) ·
  https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data

## SEC EDGAR — Mutual-fund ticker / series / class map

- **Provider:** U.S. SEC (EDGAR). Free, no key.
- **What:** `company_tickers_mf.json` — one row per registered fund **share class**:
  `(cik, seriesId, classId, symbol)`. This is the structure behind EDGAR's "Series for
  CIK = …" page: a filer **CIK** owns many **Series** (funds), each with several
  **Class/Contract** share classes, some carrying a ticker (e.g. Vanguard Index Funds
  CIK `0000036405` → Series `S000002839` *Vanguard 500 Index Fund* → classes VFINX /
  VFIAX / **VOO** (ETF) / VFFSX).
- **Why:** Sharadar gives no fund-family structure. This powers the **fund page's "Fund
  family" navigation** — from one ETF, show its parent CIK and all sibling series/classes,
  linking the ones we carry. The CIK itself is parsed from `tickers.secfilings` (the EDGAR
  link Sharadar already stores), so 99% of our funds resolve without this file; the file
  adds the full series/class tree incl. mutual-fund classes we don't carry.
- **Access:** plain HTTPS GET of `https://www.sec.gov/files/company_tickers_mf.json`
  (~1 MB, ~28k rows). ⚠ The SEC **requires a descriptive `User-Agent` with a contact
  e-mail** or returns 403 — set `SEC_USER_AGENT` in `core/.env` (see
  [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md)). SEC rate-limits by that identity,
  so use your own contact rather than borrowing one.
- **In this repo:** loaded into `sec_fund_class` (see [docs/reference/schema.md](../../docs/reference/schema.md))
  by `python -m core.scripts.load.load_sec_fund_classes`; refreshed by the orchestrator
  (`update_all`, step "SEC fund-class map"). Reference data, changes slowly.
- **Caveat:** the JSON has **no series/class display names** ("Investor Shares" etc.) —
  we show the symbol + our own fund name (the series name we derive from a carried class).
  Class-level names would require scraping the EDGAR HTML page.
- **Docs:** https://www.sec.gov/search-filings/edgar-application-programming-interfaces ·
  https://www.sec.gov/os/webmaster-faq#developers (User-Agent policy)
