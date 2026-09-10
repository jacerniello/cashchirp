# The Nasdaq Data Link API

Sharadar is delivered through Nasdaq Data Link, so every byte of the company layer
arrives over this one API. This page explains how that API works, what it will and will
not let you do, and which parts of it this repo uses where.

If you only want to build the database, [setup/database.md](../setup/database.md) is the
guide. Read this when you want to know why the loader is shaped the way it is, or when
you want to pull something it doesn't.

---

## The shape of it

Nasdaq Data Link serves *datatables*: named, flat, columnar tables addressed by a vendor
code and a table code. Sharadar's vendor code is `SHARADAR`, so the equity price table is
`SHARADAR/SEP` and reaches you at:

```
https://data.nasdaq.com/api/v3/datatables/SHARADAR/SEP
```

Everything below is that one endpoint with different query parameters. There is no
per-security REST resource, no GraphQL, no streaming — a table, a filter, and rows back.

This repo talks to it through Nasdaq's own Python SDK (`nasdaq-data-link` on PyPI,
`import nasdaqdatalink`), which is a thin wrapper over that URL plus a pandas conversion.

## Authentication

One key, passed on every request. Get it from your Nasdaq Data Link account page and put
it in `core/.env` as `NASDAQ_DATA_LINK_API_KEY`; the loader sets it on the SDK's global
config:

```python
import nasdaqdatalink as ndl
ndl.ApiConfig.api_key = settings.nasdaq_data_link_api_key
```

**Your key encodes your subscription, and that is the part that surprises people.** The
key authenticates you for every table on the platform; what you are *entitled* to is
decided per table. Request a Sharadar table your plan doesn't cover and you get a `403`,
not an empty result — which is a good failure, because an empty result would look like a
quiet day in the market.

The Sharadar Core US Equities bundle covers the thirteen tables this project loads. A
narrower Sharadar subscription will 403 on the ones it excludes, and the build records
those steps as failed and carries on with the rest.

## Two ways to get data out

This is the central fact about the API, and the reason the loader has two code paths.

| | Bulk export | Tables query API |
|---|---|---|
| SDK call | `ndl.export_table("SHARADAR/SEP", filename=…)` | `ndl.get_table("SHARADAR/SEP", **filters)` |
| Under the hood | `?qopts.export=true` — server builds a zip, you poll and download | ordinary paged JSON/CSV response |
| Returns | the **whole table**, one zipped CSV | rows matching your filter |
| Row cap | none | ~1M per call (see below) |
| Latency | minutes; the server generates the file | seconds |
| Right for | the first backfill, or a repair | the daily delta |

Neither is a substitute for the other. Exporting `SEP` every night to pick up one day of
prices means moving ~941 MB compressed to get a few hundred thousand rows; filtering
`SEP` for its whole history means blowing the row cap on the first call.

So: **backfill with the export, refresh with the query API.** That split is the whole
design of `core/backend/ingest/sharadar/sharadar_generic.py`.

### Bulk export

```python
nasdaqdatalink.export_table("SHARADAR/SEP", filename="SEP.zip")
```

The server builds the file, the SDK polls until it is ready (printing *"We are generating
the zip file now, please wait…"* on a long one), then downloads it. Inside the zip is a
single CSV with a header row.

Two things worth knowing when you handle the zip yourself:

- **The uncompressed size is in the zip's central directory**, so you can know exactly how
  many bytes you are about to stream before writing one. The loader reports progress
  against that. The compressed size is not a usable stand-in — `SF1` is 661 MB zipped and
  2,415 MB on the wire, and a progress bar measured against the wrong one runs off the end.
- **The export reflects the table at generation time.** There is no `asof` parameter; you
  get current state, not a point-in-time snapshot.

### Tables query API

```python
ndl.get_table("SHARADAR/SEP", paginate=True,
              lastupdated={"gte": "2026-09-01", "lte": "2026-09-10"})
```

Filters are `column={"op": value}` with `gte` / `lte` / `gt` / `lt`, or a bare
`column=value` for equality. They map onto query parameters
(`lastupdated.gte=2026-09-01`) and are applied server-side.

**Pagination is cursor-based.** Each response carries a `next_cursor_id`; the SDK follows
it when you pass `paginate=True` and stops otherwise, warning that you have seen only the
first page. This is a real trap in ad-hoc scripts: without `paginate=True` a query over a
million rows returns ten thousand and a `UserWarning`, and nothing about the resulting
DataFrame says it is truncated.

**There is a hard cap, and it is client-side.** The SDK stops after
`ApiConfig.page_limit` cursor pages — 100 by default — and raises `LimitExceededError`.
At the API's 10,000-row page that lands at roughly **one million rows per call**. You can
raise `page_limit`, but the ceiling exists for a reason: past that volume the export is
the right tool, and the error message says so.

**Retries are built in.** The SDK retries `429` and `5xx` five times with exponential
backoff, capped at 8 seconds between attempts. You do not need to write that loop, and
you should not add a second one on top.

## `SHARADAR/INDICATORS` — the table that describes the tables

This is the one that makes a schema-driven loader possible, and it is easy to miss.

`SHARADAR/INDICATORS` is a normal datatable whose *rows are column definitions* for every
other Sharadar table. Each row carries:

| Field | What it gives you |
|---|---|
| `table` | which Sharadar table the column belongs to (`SEP`, `SF1`, …) |
| `indicator` | the column name |
| `unittype` | its type — `currency`, `ratio`, `date`, `text`, `USD millions`, … |
| `isprimarykey` | `Y` on the columns forming that table's primary key |
| `title` / `description` | human documentation, if you want to surface it |

So you can ask the vendor for a table's schema instead of hand-writing it:

```python
ind = ndl.get_table("SHARADAR/INDICATORS", paginate=True)
sf1 = ind[ind["table"] == "SF1"]
types = {r.indicator: r.unittype for r in sf1.itertuples()}
pk    = sf1[sf1["isprimarykey"] == "Y"]["indicator"].tolist()
```

That is exactly what `fetch_schema()` does, and it is why adding a new Sharadar table to
this project needs no per-table code: the loader reads the types, maps `unittype` to a
Postgres type, creates the table, and upserts on the vendor's own declared primary key
rather than a key someone guessed.

**Trust it, but guard it.** The metadata is occasionally wrong — `SF1.fiscalperiod` is
typed as a date and holds `"2009-Q4"` — so the loader keeps a `TEXT_OVERRIDE` set for
columns the vendor mistypes, and every cast is value-guarded: a value that doesn't match
its declared type lands as `NULL` rather than failing the load. See the operational notes
in [schema.md](schema.md) for why that safety net has its own failure mode.

## How this repo uses it

The first load of any table goes through the export. Every load after that goes through
the query API, keyed on a watermark stored in `sync_state`.

Which watermark depends on what change-column the table has, and the three cases below
are the reason the registry carries a `mode` per dataset:

1. **Has `lastupdated`** (`SF1`, `DAILY`, `METRICS`, `TICKERS`). Filter
   `lastupdated >= watermark`. This catches new rows *and edits to old ones*, because
   Sharadar restamps `lastupdated` on revision. It is the mode you want wherever it works.

2. **Has `lastupdated`, but restamps heavily** (`SEP`, `SFP`). Price adjustments restamp
   `lastupdated` across years of history, so a multi-day window can exceed a million rows.
   The loader splits the date range and halves it again on `LimitExceededError` until each
   call fits. `SFP` restamps so hard that a *single day* is over the cap and cannot be
   split by date — that one is sub-chunked by ticker instead, over string-ordered key
   ranges that tile the space with no gaps.

3. **No `lastupdated` at all.** The append-only tables (`ACTIONS`, `SP500`, `EVENTS` on
   `date`, `SF2` on `filingdate`, `SF3A`/`SF3B` on `date`) key on a plain date column
   instead — which catches new rows but *not* retroactive edits, an acceptable trade for
   filings that do not change. `SF3` has no usable change column at all: its only date is
   a quarter-end shared by ~2.4M rows, so the loader re-pulls whole recent quarters in
   key-chunks and upserts them, which picks up amendments within those quarters.

Every one of those modes ends in the same upsert on the vendor's primary key, so a table
can be re-synced any number of times without duplicating a row.

## Why a local database at all

The API is a delivery mechanism, not a research tool, and the caps above are why.

Research questions are cross-sectional and historical: *every* company's margin trend
against *every* sector over *twenty* years. Asked over the query API that is thousands of
paginated calls, minutes of latency, and a million-row ceiling you will hit constantly.
Asked over a local Postgres mirror with the right indexes, it is one SQL statement that
returns while you are still reading it.

So the mirror is not a cache in front of the API. It is the thing you actually work
against, and the API is how you fill and refresh it. Everything downstream — the
screener, the derived tables, the pages — reads Postgres and never touches Nasdaq.

That is also why the mirror is deliberately *faithful*: one flat table per Sharadar
product, same rows, same values, vendor's own primary key. A mirror that quietly reshapes
the vendor's data is one you cannot reconcile against the source when a number looks
wrong — and in financial data, reconciling against the source is the only way you ever
find out that it is.

How the build actually runs: [setup/database.md](../setup/database.md). What the tables
hold once built: [schema.md](schema.md).

## What bites people

| Symptom | Cause |
|---|---|
| `403` on one table, others fine | that table is outside your Sharadar subscription tier |
| A query returns exactly 10,000 rows | you forgot `paginate=True`; check for the `UserWarning` |
| `LimitExceededError` | over ~1M rows in one call — narrow the filter or use the export |
| A column is entirely `NULL` after a load | `unittype` in `INDICATORS` disagrees with the actual values, and the value-guarded cast nulled every one. Treat a suspiciously empty column as this until proven otherwise |
| The export "hangs" | it is generated server-side on request; a large table genuinely takes minutes before the download starts |
| Nightly sync pulls far more than a day of rows | the table restamps `lastupdated` on adjustment (`SEP`, `SFP`) — expected, and why windowing exists |

## Reference

- API documentation — <https://docs.data.nasdaq.com/>
- Sharadar Core US Equities — <https://data.nasdaq.com/databases/SFA>
- Table documentation (column-by-column) — <https://data.nasdaq.com/databases/SFA/documentation>
- Python SDK — <https://github.com/Nasdaq/data-link-python>
- Provider notes, coverage and caveats — [sources.md](sources.md)
