# Database structure

The Postgres database (`investing`) is a **faithful local mirror of the Sharadar data**
plus the FRED macro panels, with a few derived/meta objects on top. Every Sharadar table
is a flat 1:1 copy of the corresponding Sharadar product table — same rows, same values —
loaded by the one schema-driven generic loader.

## Conventions (how fidelity is guaranteed)

- **Surrogate PK + Sharadar key as UNIQUE.** Each mirror table has a `id bigserial PRIMARY
  KEY` (technical key) plus a `UNIQUE` constraint on **Sharadar's own primary key**, taken
  from `SHARADAR/INDICATORS` (`isprimarykey='Y'`) — never guessed. The loader upserts on
  that unique constraint, so re-running updates in place on Sharadar's intended key.
- **No invented foreign keys.** Sharadar ships flat, denormalized files joined logically on
  `ticker`/`permaticker`; there is no FK layer in its design, so the mirror has none. (The
  only FKs in the DB are `fred_observations → fred_series`, which is FRED's own model, and
  the job ledger's `job_run → job_schedule`.)
- **`permaticker` is the stable join key.** Ticker symbols get recycled; `permaticker` is
  Sharadar's unchanging issuer id. It lives natively only in `tickers`; it is stamped onto
  the other equity tables from `TICKERS` per `(table, ticker)` — never derived (ambiguous
  pairs are left NULL, not guessed). See `core/backend/ingest/permaticker.py`.
- **Typed from the source.** Column types come from Sharadar's own INDICATORS metadata, and a value that does not match its declared type is stored as NULL rather than failing the load. `TEXT_OVERRIDE` in the loader pins the columns Sharadar mistypes (`fiscalperiod` is `"2009-Q4"`, not a date). The row counts were once reconciled against the downloaded files (rows + per-column non-null) for all 13 Sharadar tables, but no command re-checks this — it is a point-in-time result, not a standing guarantee.
- **Loading/updating:** `python -m core.setup.bootstrap --dataset sharadar:<CODE>` loads an
  empty table. Without `--force`, bootstrap resumes: any step whose table already holds rows
  is skipped. A refresh is `--dataset sharadar:<CODE> --force`, which syncs incrementally in
  whatever mode the table's registry entry declares and never removes rows. The same applies
  to every `bootstrap` command on this page, derived tables included. `--full` re-downloads the bulk export into a fresh copy, checks and diffs it,
  then swaps it in, so retroactive edits and deleted rows are both caught (not SF3, which is
  refreshed by whole quarter). The Setup **Rebuilds** tab runs and schedules this, and the
  **Watermarks** tab rewinds where the next incremental sync starts. See `core/README.md` →
  "Loading / updating data".

## Sharadar mirror tables

Row counts are `pg_class.reltuples` estimates from a full build (November 2026); they grow
with every load. `permaticker` is stamped on equity tables (investor-level `sf3b` has no
ticker, so none).

| Table | Sharadar | Grain / what it is | Sharadar key (UNIQUE) | ~Rows |
|---|---|---|---|---|
| `sep` | SEP | Equity prices, EOD (incl. `closeunadj`) | `(ticker, date)` | 47,482,412 |
| `sfp` | SFP | Fund prices (ETF/CEF), EOD | `(ticker, date)` | 15,796,391 |
| `sf1` | SF1 | Core fundamentals (per dimension) | `(ticker, reportperiod, dimension, datekey)` | 3,229,767 |
| `sf2` | SF2 | Insider transactions (Form 3/4/5) | `(ticker, rownum, ownername, formtype, filingdate)` | 11,550,923 |
| `sf3` | SF3 | 13F holdings, by investor | `(ticker, securitytype, investorid, date)` (see below) | 83,051,040 |
| `sf3a` | SF3A | 13F aggregated by ticker | `(ticker, date)` | 683,721 |
| `sf3b` | SF3B | 13F aggregated by investor | `(investorid, date)` | 311,155 |
| `daily` | DAILY | Daily valuation metrics (mktcap/PE/EV) | `(ticker, date)` | 40,087,612 |
| `metrics` | METRICS | Derived daily metrics | `(ticker, date)` | 143,210 |
| `events` | EVENTS | 8-K corporate events (codes) | `(ticker, date)` | 2,529,499 |
| `actions` | ACTIONS | Corporate actions (splits/divs) | `(ticker, name, date, contraticker, contraname, action)` | 698,008 |
| `sp500` | SP500 | S&P 500 membership log | `(ticker, date, action)` | 62,704 |
| `tickers` | TICKERS | Security master / reference | `(ticker, table, permaticker)` | 74,801 |

> **13F column names (Sharadar, 2026).** Sharadar renamed the 13F date column from
> `calendardate` to `date` (on `sf3`, `sf3a` and `sf3b`), replaced `sf3.investorname` with
> `investorid`, and dropped `sf3.price`. The mirror stores what Sharadar ships. Two
> app-facing columns are restored on `sf3` at load time: `investorname` (joined from
> `sf3b`, the 13,247-id investor map) and `price` (GENERATED as `value / units * 1000` —
> value is in millions, units in thousands; reconciled against SEP closes). There is no
> `calendardate` column on the 13F tables any more: the queries read `date` and alias it
> `AS calendardate` where the name is part of an API response, and the derived holdings
> tables keep their own `calendardate` column. See `core/backend/ingest/permaticker.py`
> (`denormalise_sf3`).

`sf3`'s key above is Sharadar's key on the shipped file. On a built database `sf3` carries
no primary key or UNIQUE constraint: the first-build denormalisation writes a new table
with `CREATE TABLE … (LIKE sf3 INCLUDING STORAGE)` and swaps it in, which copies no
constraints, and only the three helper indexes are recreated. Nothing upserts into `sf3`
(its refresh deletes and re-inserts whole quarters), so loads still work, but the key is
not enforced.

## Derived / reference objects

| Object | Kind | Purpose |
|---|---|---|
| `event_codes` | table | EVENTS code → label legend (from `INDICATORS`); e.g. `35` = Schedule 13D. Created empty by the `schema` step; filled by `load_event_codes()` in `core/backend/ingest/sharadar/sharadar_event_codes.py`, which no bootstrap step or Setup job currently calls |
| `events_decoded` | view | expands `events.eventcodes` (`"22\|71\|91"`) into ordered labels. Created by the same `load_event_codes()`, so it is absent until that runs |
| `permaticker_lookup` | table | `(product, ticker) → permaticker` map built from `tickers` (ambiguous pairs excluded) |
| `sec_fund_class` | table | SEC mutual-fund map `(cik, series_id, class_id, symbol)` — every registered fund **share class** under its parent filer CIK. Powers the fund page's "Fund family" navigation: a fund's CIK (parsed from its `tickers.secfilings` EDGAR link) groups all its sibling series/classes; classes we carry are linked by permaticker. Loaded from the SEC's `company_tickers_mf.json` by **`python -m core.setup.bootstrap --dataset sec:fund_classes`** (a full reload of one ~1 MB JSON; the SEC needs a descriptive `User-Agent` with a contact e-mail). Refreshed by the `sec` phase of a full `bootstrap --force` run. Reference data — drop and reload freely. |
| `screener_snapshot` | table | one precomputed row per security for the app's Screener: latest valuation + trailing SF1 fundamentals, margins, returns, ratios, growth, net cash (cash−debt) % of cap, **Altman Z-score** (bankruptcy-distance survivability gate, computed in `queries/securities/health.py` from ART/TTM `sf1` — calibrated for non-financials), company age (from `tickers.firstpricedate`), 52-week-low/high proximity (from `metrics`), 13F holder count — tagged with an `asof` date. Built by `python -m core.setup.bootstrap --dataset derived:screener_snapshot`; auto-refreshed after a standalone DAILY load, and the API rebuilds and persists it on the first screener read after `daily` advances. Nothing warms it at app startup. Rebuild from `sf1`/`daily`/`sf3a`/`metrics`/`tickers` — never hand-edit. |
| `holder_timeseries` | table | every SHR 13F holder's quarterly positions for every security — `(permaticker, investorname, rank, calendardate, value, units, adj_units, price, asof)`, ~62M rows. Each holder carries a per-security `rank` (1 = largest by max position value over all time), so the Company page's holdings-over-time bubble chart can **paginate all holders** as a `(permaticker, rank)` range scan (~1ms) instead of an `sf3` self-join. `units` is as-filed; `adj_units` is split-adjusted (× the product of splits *after* each quarter, from `actions`) so the shares-over-time view is continuous across splits. `asof` = max 13F quarter (`sf3.date`) at build time. Built by `python -m core.setup.bootstrap --dataset derived:holder_timeseries`; auto-refreshed after a standalone SF3 load. Nothing warms it at app startup. Rebuild from `sf3`+`actions` — never hand-edit. |
| `sp500_concentration` | table | one row per S&P 500 **snapshot date** (every `sp500` *historical* quarter-end 1998→present, plus the latest *current* snapshot) with the index's concentration measures: cap-weight of the top 1/3/5/10/25/50 constituents, the **HHI** (Herfindahl points), and the **effective number of constituents** (1/Σwᵢ²), plus `n_constituents`, `total_mktcap`, and the top-1 name/ticker. **Point-in-time:** membership is the `sp500` log as it stood at each date, each constituent's cap is its `daily.marketcap` as of that date (latest close in a 10-day lookback). **Full-cap** weighting (Sharadar has no float — a documented proxy for S&P's float-adjusted weights, not faked). ~113 rows. Built by `python -m core.setup.bootstrap --dataset derived:sp500_concentration`; auto-refreshed after an SP500 load and by the orchestrator. Rebuild from `sp500`+`daily`+`tickers` — never hand-edit. |
| `sp500_sector_weights` | table | the sector cut of the same build: one row per `(date, sector)` with that GICS-style sector's index cap-`weight` (%), constituent count `n`, and `mktcap`, so the `/sp500` page shows the index's sector mix rotating over time. Same build/provenance as `sp500_concentration`; indexed on `date`. ~1.2k rows. |
| `institutional_holdings_timeseries` | table | the **per-investor transpose** of `holder_timeseries`: every 13F filer's quarterly position in every SHR security it has held — `(investorname, permaticker, ticker, rank, calendardate, value, units, adj_units, price, asof)`, ~62M rows. Each security carries a per-filer `rank` (1 = the filer's largest-ever position by value), so the Institution page (`/institutional/<name>`) holdings-over-time bubble chart **paginates all of a filer's holdings** as an `(investorname, rank)` range scan instead of an `sf3` scan. `adj_units` is split-adjusted per security (same `actions` logic as `holder_timeseries`); `asof` = max 13F quarter (`sf3.date`) at build time. Built by `python -m core.setup.bootstrap --dataset derived:institutional_holdings_timeseries`; auto-refreshed after a standalone SF3 load. Nothing warms it at app startup. Rebuild from `sf3`+`actions` — never hand-edit. |

**Funds / ETFs need no derived object.** The dedicated fund page (`/etf/<permaticker>`,
API `GET /api/v1/etf/{permaticker}`) serves profile from `tickers` (`category = 'ETF'`)
and price-derived headline stats (last close, nominal 52w range, 90d avg volume,
total-return windows via `closeadj`, inception) computed **on the fly** by
`queries/securities/prices.py::etf_metrics` straight off `sfp` — `sfp` is permaticker-indexed
so one fund is a few ms. The price chart reuses `/prices` (which already falls back to
`sfp`) and the fund's 13F holders reuse `/institutional/top-holders`. The equity company
page redirects to `/etf` when `category == 'ETF'` (funds have no SF1 fundamentals,
insiders, or short interest).

### `derived` schema — insider people pages

Built from `sf2` (+ `sep` for market valuation) by **`python -m core.setup.bootstrap --dataset derived:derived.insider --force`**.
**Rerun whenever `sf2` changes** (any new insider load) — both tables are stamped with
`asof` = `max(sf2.filingdate)` at build time. **Rerun it after every standalone SF2 load** — an
SF2 load does not trigger it (a full `bootstrap --force` run rebuilds it in its `derived` phase), so a stale `asof` (stored `asof` ≠ current `max(sf2.filingdate)`)
just means the pages serve old numbers until you do. The whole build
is a single grouped scan + one `sep` join (~2 min). Both are pure caches — drop and rebuild
freely, never hand-edit.

| Object | Kind | Purpose |
|---|---|---|
| `derived.insider` | table | one row per distinct insider — `(owner_id, ownername, txns, companies, first_trade, last_trade, ever_director, ever_officer, ever_tenpct, asof)`. SF2 has **no owner CIK**, so `owner_id` = `substr(md5(upper(ownername)),1,12)` is a *deterministic surrogate* (stable across rebuilds → people-page URLs `/insider/<owner_id>` don't rot) that keeps the raw name out of the URL. Caveat: being name-derived, two real people sharing a name collapse to one id. Unique index on `owner_id`, index on `ownername`. |
| `derived.insider_company` | table | one row per `(insider, company)` — `(owner_id, ownername, permaticker, ticker, issuername, txns, acquired_value, disposed_value, net_value, acquired_shares, disposed_shares, om_buy_value, om_sell_value, om_net_value, om_buy_shares, om_sell_shares, om_txns, first_trade, last_trade, latest_shares, asof)`. The heavy lifting done once. **Two nets** are precomputed so the UI can toggle basis: *all-codes* (`net_value` = acquired(`…A`)−disposed(`…D`) by `right(securityadcode,1)` — total net position change incl. grants/exercises/tax) and *open-market* (`om_net_value` = buys(`P`)−sells(`S`) only — the conviction signal). Each transaction's $ is **valued at the raw `sep.closeunadj` close where the filing reports no price** (grants/exercises/gifts otherwise read as zeros) — raw, NOT split-adjusted `close`, to match as-filed (unadjusted) `transactionshares`. `latest_shares` = most recent `sharesownedfollowing…` (ties broken by `filingdate`). Powers the Company → Insiders stat cards + top-insiders ranking (both bases) and the people page instantly (no per-request `sep` join). Indexed on `permaticker` and `owner_id`. |

## Meta tables

| Table | Purpose |
|---|---|
| `load_log` | append ledger of every ingestion (source, dataset, op, rows, `requested_at`/`completed_at`) — `load_status` reads it |
| `sync_state` | per-table incremental watermark (max sync-column value ingested — `lastupdated`, or the registry's `sync_col`/quarter date for tables without it; FINRA keeps its settlement-date watermark here too). The Setup **Watermarks** tab rewinds it |
| `job_schedule` | standing schedules for the API's scheduler (dataset or build key, cadence `interval`/`daily`/`weekly`/`monthly`, `next_run_at`) — edited at `/setup/schedules` |
| `job_run` | process-level run history (key, trigger `manual`/`scheduled`/`cli`, status, pid, log file name); FK → `job_schedule` |
| `scheduler_worker` | each API worker's scheduler heartbeat, published every 5 s (thread alive, last tick, holds lock, consecutive failures); rows not refreshed in 20 s are workers that are gone |
| `scheduler_control` | one row of instructions for every API worker's scheduler thread: `paused` (kept across restarts) and a `restart_seq` counter; written by Stop/Restart at `/setup/schedules` |
| `api_rate_samples` | Nasdaq Data Link rate-limit readings (at most one a minute per provider), charted on the Setup page |

## FRED (macro)

| Table | Purpose |
|---|---|
| `fred_series` | FRED-MD/QD series catalogue (id, dataset, transform code) |
| `fred_observations` | one raw value per series/date/vintage (point-in-time) — FK → `fred_series` |
| `fred_files` | registry of downloaded FRED source files (also the vintage watermark) |

**Refreshing (incremental).** `python -m core.setup.bootstrap --only-phase fred --force` loads both
FRED-MD and FRED-QD vintages plus the spot series, and is **incremental**: point-in-time
vintages are immutable, so it only ingests vintages not already in `fred_files` — if the
watermark already covers the bundled historical zip's end, the zip isn't even downloaded;
it just discovers and loads any vintage newer than `max(vintage)`. (`--full` applies to
Sharadar tables only.) The revised `current.csv` is not loaded — it has look-ahead.
Commodity spot series: `python -m core.setup.bootstrap --dataset fred:spot` (revision-free,
upserts).

## FINRA (short interest)

| Object | Kind | Purpose |
|---|---|---|
| `finra_short_interest` | table | FINRA Consolidated Equity Short Interest — bi-monthly short positions across all U.S. markets, one row per `(symbol, settlementdate, market)`, 2017-12-29 → present (~3.9M rows). Byte-faithful mirror of FINRA's public Query API (no key/auth); stores only FINRA's own fields. The squeeze signal Sharadar lacks. Load with `python -m core.setup.bootstrap --dataset finra:short_interest` (a full backfill when there is no watermark); refresh with the same command plus `--force` (incremental). |
| `finra_short_interest_resolved` | view | adds `permaticker`, resolved at read time by a **point-in-time** join (issuer that held the symbol on the settlement date, `tickers.[firstpricedate, lastpricedate]`) — exposed only when unambiguous (recycled-ticker collisions → NULL). **permaticker is deliberately not stored** on the base table; market is not a join key. % of float / days-to-cover are computed at read time against `sf1`/`daily` — mind the split caveat (FINRA short is as-filed, `sf1.sharesbas` is split-adjusted backward; see sources.md). |

See [`sources.md`](sources.md) for source/provenance details.

## Indexes (read-side helpers, not data)

Beyond each table's surrogate PK and Sharadar-key UNIQUE, the loader adds two helper
indexes per applicable table (non-destructive — they index, never alter, the mirrored
data):

- `ix_<table>_permaticker` — stable-issuer lookups (the app keys on permaticker).
- `ix_<table>_date` — a **standalone `date`** index (the UNIQUE keys lead with `ticker`,
  so cross-sectional "latest row across all securities" scans, e.g. the app's Screener,
  have no usable date index without it). Added in `_enrich_after_load`.

Surface-specific helper indexes added for the app's entity pages (in `ingest/permaticker.py`,
so a fresh build keeps them):

- `ix_sf2_ownername ON sf2(ownername)` — the single-insider page (`/insider/<owner_id>`)
  filters SF2 by owner *name*; without it every load seq-scanned ~11M rows (~13–17s → ~0.2s).
- `ix_sep_permaticker_date ON sep(permaticker, date)` — the per-transaction market-close
  LEFT JOIN that values insider grants/exercises; a direct probe instead of a `BitmapAnd`.
- `ix_sf3_investorname_date ON sf3(investorname, date)` — the investor (13F filer) page
  (`/institutional/<name>`) filters SF3 by investorname alone; without it a large filer
  (BlackRock) seq-scanned the whole table (~21–60s → ~0.4s). Built by `denormalise_sf3`,
  since `investorname` only exists after it runs.

When filtering by a date *window* relative to `max(date)`, resolve `max(date)` in the app
and pass a **concrete date literal**, not `date >= (SELECT max(date) …) - INTERVAL`: the
planner can't estimate the runtime expression and falls back to a full seq scan (turned a
0.1s screener into 27s). See `queries/discovery/screener.py::build_snapshot`.

## Operational notes (hard-won — read before changing the loader)

- **The loader's casts are value-guarded**: a value that doesn't match its declared type
  becomes NULL instead of crashing the load. That turned a load failure into *silent
  corruption* twice — `sf3` collapsed 46M→7M (a NULL date made the key non-unique, so
  `DISTINCT ON` dropped rows), and `sf1.fiscalperiod` went 100% NULL because Sharadar types
  it as a date while it holds `"2009-Q4"`. Both are pinned now: `fiscalperiod` is in the
  loader's `TEXT_OVERRIDE`. There is no automated check for a third case — a column added
  or retyped upstream will load as all-NULL without erroring, so read the INDICATORS
  metadata when adding a table, and treat a suspiciously empty column as this bug until
  proven otherwise.
- **`fiscalperiod` is text, not a date.** Sharadar's `INDICATORS` types it as a date but it
  holds `"2009-Q4"`. It's in `TEXT_OVERRIDE` in `sharadar_generic.py`; add any similar
  period-string columns there.
- **Big loads need memory.** The loader sets `work_mem`/`maintenance_work_mem = 1GB` for the
  session; without it a 46M-row `DISTINCT ON` sort spills to disk and takes ~30 min instead
  of a few. Keep that.
- **permaticker is taken from `TICKERS`, never derived.** Map per `(table, ticker)`; resolve
  equity tables via SEP with an SFP fallback for funds; **exclude globally-ambiguous tickers**
  (>1 permaticker anywhere) so a stamp is provably unique → zero false positives. Unmatched
  tickers stay NULL (honest gap), never force-filled. Loader hook stamps only *new* rows
  (`only_null`) so incremental syncs stay fast; `enrich_table` without `only_null` (or
  `enrich_all`) does a full re-stamp (drop+re-add the column) when the mapping changes.
- **Updating — the mode follows what change-column the table has.** Each table's mode and
  sync column live in its registry entry (`core/backend/sources.py`), not in command-line
  flags. The incremental sync follows the query API's cursor itself and streams each page
  into the staging COPY, so it has no per-call row cap to work around; nothing reaches the
  table until every page is in, and the upsert and the watermark move commit together.
  - **Has `lastupdated`** (`sf1`, `daily`, `metrics`, `tickers`, `sep`, `sfp`): the sync
    pulls only rows with `lastupdated >= watermark` and catches *edits as well as new rows*.
    `sep` and `sfp` restamp `lastupdated` across history on price adjustments, so their
    deltas can run to millions of rows; that is expected, and the streaming fetch handles it.
  - **No `lastupdated`, but a usable date column** (`actions`/`sp500`/`events` → `date`,
    `sf2` → `filingdate`, `sf3a`/`sf3b` → `date`): `sync_col` in the registry. Keys on that
    date instead. *Caveat: catches new rows, not retroactive edits to existing ones* — fine
    for these append-only event/filing tables.
  - **No change column at all + coarse date** (`sf3`: only `date`, one value per quarter ≈
    2.4M rows): mode `quarters` re-pulls the most recent 2 quarters, each fetched in
    recursive `ticker` key ranges to stay under the loader's 3M-row ceiling, and **replaces each
    quarter wholesale** (delete then insert, in one transaction). Catches new, amended and
    deleted rows *within those quarters*; amendments to older quarters are missed, and SF3
    has no `--full` copy-and-swap path.
  - A populated table with no watermark is reloaded whole by copy-and-swap; an empty one is
    backfilled from the bulk export.
