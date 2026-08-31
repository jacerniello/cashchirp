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
  only FK in the DB is `fred_observations → fred_series`, which is FRED's own model.)
- **`permaticker` is the stable join key.** Ticker symbols get recycled; `permaticker` is
  Sharadar's unchanging issuer id. It lives natively only in `tickers`; it is stamped onto
  the other equity tables from `TICKERS` per `(table, ticker)` — never derived (ambiguous
  pairs are left NULL, not guessed). See `core/backend/ingest/permaticker.py`.
- **Verified, not trusted.** `python -m core.scripts.ops.verify_sharadar` checks every table
  against its downloaded file (row count + per-column non-null). All 13 Sharadar tables
  currently pass.
- **Loading/updating:** `python -m core.scripts.load.sharadar_load_generic <CODE>` (add `--sync`
  for incremental). See `core/README.md` → "Loading / updating data".

## Sharadar mirror tables

Row counts are the verified file counts. `permaticker` is stamped on equity tables
(investor-level `sf3b` has no ticker, so none).

| Table | Sharadar | Grain / what it is | Sharadar key (UNIQUE) | ~Rows |
|---|---|---|---|---|
| `sep` | SEP | Equity prices, EOD (incl. `closeunadj`) | `(ticker, date)` | 46,029,876 |
| `sfp` | SFP | Fund prices (ETF/CEF), EOD | `(ticker, date)` | 15,200,010 |
| `sf1` | SF1 | Core fundamentals (per dimension) | `(ticker, reportperiod, dimension, datekey)` | 3,194,206 |
| `sf2` | SF2 | Insider transactions (Form 3/4/5) | `(ticker, rownum, ownername, formtype, filingdate)` | 11,553,847 |
| `sf3` | SF3 | 13F holdings, by investor | `(ticker, securitytype, investorname, calendardate)` | 46,076,846 |
| `sf3a` | SF3A | 13F aggregated by ticker | `(ticker, calendardate)` | 654,709 |
| `sf3b` | SF3B | 13F aggregated by investor | `(investorname, calendardate)` | 297,021 |
| `daily` | DAILY | Daily valuation metrics (mktcap/PE/EV) | `(ticker, date)` | 39,787,849 |
| `metrics` | METRICS | Derived daily metrics | `(ticker, date)` | 31,289 |
| `events` | EVENTS | 8-K corporate events (codes) | `(ticker, date)` | 2,525,439 |
| `actions` | ACTIONS | Corporate actions (splits/divs) | `(ticker, name, date, contraticker, contraname, action)` | 665,062 |
| `sp500` | SP500 | S&P 500 membership log | `(ticker, date, action)` | 59,158 |
| `tickers` | TICKERS | Security master / reference | `(ticker, table, permaticker)` | 62,099 |

## Derived / reference objects

| Object | Kind | Purpose |
|---|---|---|
| `event_codes` | table | EVENTS code → label legend (from `INDICATORS`); e.g. `35` = Schedule 13D |
| `events_decoded` | view | expands `events.eventcodes` (`"22\|71\|91"`) into ordered labels |
| `permaticker_lookup` | table | `(product, ticker) → permaticker` map built from `tickers` (ambiguous pairs excluded) |
| `sec_fund_class` | table | SEC mutual-fund map `(cik, series_id, class_id, symbol)` — every registered fund **share class** under its parent filer CIK. Powers the fund page's "Fund family" navigation: a fund's CIK (parsed from its `tickers.secfilings` EDGAR link) groups all its sibling series/classes; classes we carry are linked by permaticker. Loaded from the SEC's `company_tickers_mf.json` by **`python -m core.scripts.load.load_sec_fund_classes`** (a full reload of one ~1 MB JSON; the SEC needs a descriptive `User-Agent` with a contact e-mail). Refreshed by the orchestrator (`update_all`, the `SEC fund-class map` step). Reference data — drop and reload freely. |
| `screener_snapshot` | table | one precomputed row per security for the app's Screener: latest valuation + trailing SF1 fundamentals, margins, returns, ratios, growth, net cash (cash−debt) % of cap, **Altman Z-score** (bankruptcy-distance survivability gate, computed in `repositories/health.py` from ART/TTM `sf1` — calibrated for non-financials), company age (from `tickers.firstpricedate`), 52-week-low/high proximity (from `metrics`), 13F holder count — tagged with an `asof` date. Built by `python -m core.scripts.build.build_screener_snapshot`; auto-refreshed after a DAILY load. Nothing warms it at app startup. Rebuild from `sf1`/`daily`/`sf3a`/`metrics`/`tickers` — never hand-edit. |
| `holder_timeseries` | table | every SHR 13F holder's quarterly positions for every security — `(permaticker, investorname, rank, calendardate, value, units, adj_units, price, asof)`, ~33M rows / ~3.8 GB. Each holder carries a per-security `rank` (1 = largest by max position value over all time), so the Company page's holdings-over-time bubble chart can **paginate all holders** as a `(permaticker, rank)` range scan (~1ms) instead of a 46M-row `sf3` self-join. `units` is as-filed; `adj_units` is split-adjusted (× the product of splits *after* each quarter, from `actions`) so the shares-over-time view is continuous across splits. `asof` = max 13F `calendardate` at build time. Built by `python -m core.scripts.build.build_holder_timeseries`; auto-refreshed after an SF3 load. Nothing warms it at app startup. Rebuild from `sf3`+`actions` — never hand-edit. |
| `sp500_concentration` | table | one row per S&P 500 **snapshot date** (every `sp500` *historical* quarter-end 1998→present, plus the latest *current* snapshot) with the index's concentration measures: cap-weight of the top 1/3/5/10/25/50 constituents, the **HHI** (Herfindahl points), and the **effective number of constituents** (1/Σwᵢ²), plus `n_constituents`, `total_mktcap`, and the top-1 name/ticker. **Point-in-time:** membership is the `sp500` log as it stood at each date, each constituent's cap is its `daily.marketcap` as of that date (latest close in a 10-day lookback). **Full-cap** weighting (Sharadar has no float — a documented proxy for S&P's float-adjusted weights, not faked). ~111 rows. Built by `python -m core.scripts.build.build_sp500_concentration`; auto-refreshed after an SP500 load and by the orchestrator. Rebuild from `sp500`+`daily`+`tickers` — never hand-edit. |
| `sp500_sector_weights` | table | the sector cut of the same build: one row per `(date, sector)` with that GICS-style sector's index cap-`weight` (%), constituent count `n`, and `mktcap`, so the `/sp500` page shows the index's sector mix rotating over time. Same build/provenance as `sp500_concentration`; indexed on `date`. ~1.2k rows. |
| `institutional_holdings_timeseries` | table | the **per-investor transpose** of `holder_timeseries`: every 13F filer's quarterly position in every SHR security it has held — `(investorname, permaticker, ticker, rank, calendardate, value, units, adj_units, price, asof)`, ~33M rows. Each security carries a per-filer `rank` (1 = the filer's largest-ever position by value), so the Institution page (`/institutional/<name>`) holdings-over-time bubble chart **paginates all of a filer's holdings** as an `(investorname, rank)` range scan instead of an `sf3` scan. `adj_units` is split-adjusted per security (same `actions` logic as `holder_timeseries`); `asof` = max 13F `calendardate` at build time. Built by `python -m core.scripts.build.build_institutional_holdings_timeseries`; auto-refreshed after an SF3 load. Nothing warms it at app startup. Rebuild from `sf3`+`actions` — never hand-edit. |

**Funds / ETFs need no derived object.** The dedicated fund page (`/etf/<permaticker>`,
API `GET /api/v1/etf/{permaticker}`) serves profile from `tickers` (`category = 'ETF'`)
and price-derived headline stats (last close, nominal 52w range, 90d avg volume,
total-return windows via `closeadj`, inception) computed **on the fly** by
`repositories/prices.py::etf_metrics` straight off `sfp` — `sfp` is permaticker-indexed
so one fund is a few ms. The price chart reuses `/prices` (which already falls back to
`sfp`) and the fund's 13F holders reuse `/institutional/top-holders`. The equity company
page redirects to `/etf` when `category == 'ETF'` (funds have no SF1 fundamentals,
insiders, or short interest).

### `derived` schema — insider people pages

Built from `sf2` (+ `sep` for market valuation) by **`python -m core.scripts.build.build_insiders`**.
**Rerun whenever `sf2` changes** (any new insider load) — both tables are stamped with
`asof` = `max(sf2.filingdate)` at build time. **Rerun it after every SF2 load** — nothing rebuilds
these automatically, so a stale `asof` (stored `asof` ≠ current `max(sf2.filingdate)`)
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
| `sync_state` | per-table incremental watermark (max sync-column value ingested — `lastupdated`, or the `--sync-col`/quarter date for tables without it) for `--sync`/`--sync-quarters` |
| `report` | saved lab configurations — `(id, name, tool, spec jsonb, created_at, updated_at)`. Read-write **app state** (not a derived cache): a *report* is a named, tool-tagged JSON spec (security + `transforms` list + analysis params) so a lab setup (e.g. "SPY, real, +4%") survives a reload and can be reopened. Created lazily (`CREATE TABLE IF NOT EXISTS`) by `repositories/reports.py` — no migration step; backs every lab via the `tool` tag. |

## FRED (macro)

| Table | Purpose |
|---|---|
| `fred_series` | FRED-MD/QD series catalogue (id, dataset, transform code) |
| `fred_observations` | one raw value per series/date/vintage (point-in-time) — FK → `fred_series` |
| `fred_files` | registry of downloaded FRED source files (also the vintage watermark) |

**Refreshing (incremental).** `python -m core.scripts.load.fred.load_md` (add `--qd` for
quarterly) is **incremental by default**: point-in-time vintages are immutable, so it
only ingests vintages not already in `fred_files` — if the watermark already covers the
bundled historical zip's end, the zip isn't even downloaded; it just discovers and loads
any vintage newer than `max(vintage)`. `--full` forces a re-ingest (repair). Never load
the revised `current.csv` (`--revised`) into a backtest — it has look-ahead. Commodity
spot series: `python -m core.scripts.load.fred.load_spot` (revision-free, upserts).

## FINRA (short interest)

| Object | Kind | Purpose |
|---|---|---|
| `finra_short_interest` | table | FINRA Consolidated Equity Short Interest — bi-monthly short positions across all U.S. markets, one row per `(symbol, settlementdate, market)`, 2017-12-29 → present (~3.8M rows). Byte-faithful mirror of FINRA's public Query API (no key/auth); stores only FINRA's own fields. The squeeze signal Sharadar lacks. Load with `python -m core.scripts.load.finra_load --backfill`. |
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

Also `ix_sf1_perma_dim_date ON sf1(permaticker, dimension, calendardate DESC)` — turns
"latest fundamentals per security per dimension" (the screener-snapshot build) from a 3.2M
-row seq-scan + sort into an index scan.

Surface-specific helper indexes added for the React app's entity pages (idempotent
`CREATE INDEX IF NOT EXISTS` in `ingest/permaticker.py`, so a fresh build keeps them):

- `ix_sf2_ownername ON sf2(ownername)` — the single-insider page (`/insider/<owner_id>`)
  filters SF2 by owner *name*; without it every load seq-scanned ~11M rows (~13–17s → ~0.2s).
- `ix_sep_permaticker_date ON sep(permaticker, date)` — the per-transaction market-close
  LEFT JOIN that values insider grants/exercises; a direct probe instead of a `BitmapAnd`.
- `ix_sf3_investorname_calendardate ON sf3(investorname, calendardate)` — the investor
  (13F filer) page (`/institutional/<name>`) filters SF3 by investorname alone; without it
  a large filer (BlackRock) seq-scanned ~46M rows (~21–60s → ~0.4s).

When filtering by a date *window* relative to `max(date)`, resolve `max(date)` in the app
and pass a **concrete date literal**, not `date >= (SELECT max(date) …) - INTERVAL`: the
planner can't estimate the runtime expression and falls back to a full seq scan (turned a
0.1s screener into 27s). See `repositories/valuation.py::screener`.

## Operational notes (hard-won — read before changing the loader)

- **Always `verify_sharadar` after a load.** The loader's casts are *value-guarded*: a
  value that doesn't match its declared type becomes NULL instead of crashing. That turned
  a load failure into *silent corruption* twice — `sf3` collapsed 46M→7M (a NULL date made
  the key non-unique → `DISTINCT ON` dropped rows), and `sf1.fiscalperiod` went 100% NULL.
  Row-count + per-column-null checks against the downloaded file catch both. Don't trust a
  load you didn't verify.
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
  (`only_null`) so incremental syncs stay fast; `enrich_permaticker` does a full re-stamp
  (drop+re-add the column) when the mapping changes.
- **Updating — pick the mode by what change-column the table has** (the `--sync` query API
  caps at ~1M rows per call, so high-volume deltas must be windowed):
  - **Has `lastupdated`** (`sf1`, `daily`, `metrics`, `tickers`): `--sync` pulls only the delta
    and catches *edits as well as new rows*. Fast.
  - **`lastupdated` but heavy restamping** (`sep`, `sfp`): a multi-day delta blows the cap
    because price adjustments restamp `lastupdated` across history. `--sync` auto-windows the
    date range (halving on a cap error), which fixes `sep`. `sfp` restamps so hard that a
    *single day* exceeds the cap and can't be windowed → use a **full backfill** for it.
  - **No `lastupdated`, but a usable date column** (`actions`/`sp500`/`events` → `date`,
    `sf2` → `filingdate`, `sf3a`/`sf3b` → `calendardate`): `--sync --sync-col <col>`. Keys on
    that date instead. *Caveat: catches new rows, not retroactive edits to existing ones* —
    fine for these append-only event/filing tables.
  - **No change column at all + coarse date** (`sf3`: only `calendardate`, one value per
    quarter ≈ 2.4M rows, past the cap and impossible to date-window): `--sync-quarters`
    re-pulls the most recent N quarters (default 2), each fetched in recursive `--chunk-key`
    (default `ticker`) ranges to stay under the cap, then upserts. Catches new + amended rows
    *within those quarters*; amendments to older quarters need a full backfill.
