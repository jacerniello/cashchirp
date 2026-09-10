# The Nasdaq Data Link API

Sharadar is delivered through Nasdaq Data Link, so the whole company layer arrives over
this one API. This page covers how it works, its limits, and which parts of it the loader
uses where.

To build the database, follow [setup/database.md](../setup/database.md) instead. This page
is background: why the loader is shaped the way it is, and what you need to know to pull
something it doesn't.

---

## Addressing

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

The key authenticates you for every table on the platform, but entitlement is decided per
table. Request a Sharadar table your plan doesn't cover and you get a `403` rather than an
empty result, which is the more useful failure: an empty result would be indistinguishable
from a quiet day in the market.

The Sharadar Core US Equities bundle covers the thirteen tables this project loads. A
narrower Sharadar subscription will 403 on the ones it excludes, and the build records
those steps as failed and carries on with the rest.

## Two ways to get data out

The API offers two access paths with different limits, which is why the loader has two
code paths.

| | Bulk export | Tables query API |
|---|---|---|
| SDK call | `ndl.export_table("SHARADAR/SEP", filename=…)` | `ndl.get_table("SHARADAR/SEP", **filters)` |
| Under the hood | `?qopts.export=true` — server builds a zip, you poll and download | ordinary paged JSON/CSV response |
| Returns | the **whole table**, one zipped CSV | rows matching your filter |
| Row cap | none | ~1M per call (see below) |
| Latency | minutes; the server generates the file | seconds |
| Right for | the first backfill, or a repair | the daily delta |

Neither covers both cases. Exporting `SEP` nightly to pick up one day of prices moves
~941 MB compressed for a few hundred thousand rows; filtering `SEP` across its full
history exceeds the row cap on the first call.

So the loader backfills with the export and refreshes with the query API. That split is
the structure of `core/backend/ingest/sharadar/sharadar_generic.py`.

### Bulk export

```python
nasdaqdatalink.export_table("SHARADAR/SEP", filename="SEP.zip")
```

The server builds the file, the SDK polls until it is ready (printing *"We are generating
the zip file now, please wait…"* on a long one), then downloads it. Inside the zip is a
single CSV with a header row.

Two notes if you handle the zip yourself:

- The uncompressed size is recorded in the zip's central directory, so the byte count is
  known before streaming starts. The loader reports progress against it. The compressed
  size is not a usable substitute: `SF1` is 661 MB zipped and 2,415 MB on the wire, so a
  progress bar measured against the wrong one runs off the end.
- The export reflects the table at generation time. There is no `asof` parameter — you get
  current state, not a point-in-time snapshot.

### Tables query API

```python
ndl.get_table("SHARADAR/SEP", paginate=True,
              lastupdated={"gte": "2026-09-01", "lte": "2026-09-10"})
```

Filters are `column={"op": value}` with `gte` / `lte` / `gt` / `lt`, or a bare
`column=value` for equality. They map onto query parameters
(`lastupdated.gte=2026-09-01`) and are applied server-side.

Pagination is cursor-based. Each response carries a `next_cursor_id`, which the SDK
follows when passed `paginate=True` and otherwise ignores, warning that only the first
page was read. Without `paginate=True` a query over a million rows returns ten thousand
and a `UserWarning`; nothing about the resulting DataFrame indicates it is truncated.

The row cap is client-side. The SDK stops after `ApiConfig.page_limit` cursor pages — 100
by default — and raises `LimitExceededError`. At the API's 10,000-row page that is roughly
one million rows per call. Raising `page_limit` is possible, but above that volume the
export is the appropriate path, and the error message says so.

Retries are handled by the SDK: `429` and `5xx` are retried five times with exponential
backoff, capped at 8 seconds between attempts. Adding a second retry loop on top is
redundant.

## `SHARADAR/INDICATORS` — the table that describes the tables

This is what makes the schema-driven loader possible.

`SHARADAR/INDICATORS` is a normal datatable whose *rows are column definitions* for every
other Sharadar table. Each row carries:

| Field | What it gives you |
|---|---|
| `table` | which Sharadar table the column belongs to (`SEP`, `SF1`, …) |
| `indicator` | the column name |
| `unittype` | its type — `currency`, `ratio`, `date`, `text`, `USD millions`, … |
| `isprimarykey` | `Y` on the columns forming that table's primary key |
| `title` / `description` | human-readable documentation for the column |

So a table's schema can be read from the vendor rather than hand-written:

```python
ind = ndl.get_table("SHARADAR/INDICATORS", paginate=True)
sf1 = ind[ind["table"] == "SF1"]
types = {r.indicator: r.unittype for r in sf1.itertuples()}
pk    = sf1[sf1["isprimarykey"] == "Y"]["indicator"].tolist()
```

That is what `fetch_schema()` does, and it is why adding a Sharadar table needs no
per-table code: the loader reads the types, maps `unittype` to a Postgres type, creates
the table, and upserts on the vendor's declared primary key rather than a guessed one.

The metadata is occasionally wrong — `SF1.fiscalperiod` is typed as a date and holds
`"2009-Q4"` — so the loader keeps a `TEXT_OVERRIDE` set for columns the vendor mistypes,
and every cast is value-guarded: a value that doesn't match its declared type lands as
`NULL` rather than failing the load. That safety net has its own failure mode; see the
operational notes in [schema.md](schema.md).

## How this repo uses it

The first load of any table goes through the export. Every load after that goes through
the query API, keyed on a watermark stored in `sync_state`.

Which watermark depends on the table's change-column. These three cases are why the
registry carries a `mode` per dataset:

1. **Has `lastupdated`** (`SF1`, `DAILY`, `METRICS`, `TICKERS`). Filter
   `lastupdated >= watermark`. This catches new rows and edits to existing ones, since
   Sharadar restamps `lastupdated` on revision. Preferred wherever it is available.

2. **Has `lastupdated`, but restamps heavily** (`SEP`, `SFP`). Price adjustments restamp
   `lastupdated` across years of history, so a multi-day window can exceed a million rows.
   The loader splits the date range and halves it again on `LimitExceededError` until each
   call fits. For `SFP` a single day exceeds the cap and cannot be split by date, so it is
   sub-chunked by ticker over string-ordered key ranges that tile the space with no gaps.

3. **No `lastupdated`.** The append-only tables (`ACTIONS`, `SP500`, `EVENTS` on `date`,
   `SF2` on `filingdate`, `SF3A`/`SF3B` on `date`) key on a plain date column instead.
   That catches new rows but not retroactive edits — an acceptable trade for filings that
   do not change. `SF3` has no usable change column at all: its only date is a quarter-end
   shared by ~2.4M rows, so the loader re-pulls recent quarters in key-chunks and upserts
   them, picking up amendments within those quarters.

All three modes end in the same upsert on the vendor's primary key, so a table can be
re-synced repeatedly without duplicating a row.

## Why a local database

The caps above are the reason. The API is built for delivery, not for analysis.

Research questions tend to be cross-sectional and historical — every company's margin
trend against every sector over twenty years. Over the query API that is thousands of
paginated calls, minutes of latency, and repeated collisions with the million-row cap.
Over a local Postgres mirror with the right indexes it is a single SQL statement.

The mirror is therefore not a cache in front of the API; it is what the app reads, and the
API is how it gets filled and refreshed. The screener, the derived tables and the pages
all read Postgres and never contact Nasdaq.

It is also why the mirror stays faithful to the source: one flat table per Sharadar
product, same rows, same values, the vendor's own primary key. A mirror that reshapes the
vendor's data cannot be reconciled against it when a number looks wrong, and reconciling
against the source is how such errors get found.

How the build runs: [setup/database.md](../setup/database.md). What the tables hold once
built: [schema.md](schema.md).

## Common failures

| Symptom | Cause |
|---|---|
| `403` on one table, others fine | that table is outside your Sharadar subscription tier |
| A query returns exactly 10,000 rows | `paginate=True` was omitted; check for the `UserWarning` |
| `LimitExceededError` | over ~1M rows in one call — narrow the filter or use the export |
| A column is entirely `NULL` after a load | `unittype` in `INDICATORS` disagrees with the actual values, so the value-guarded cast nulled every one. A suspiciously empty column is usually this |
| The export appears to hang | it is generated server-side on request; a large table takes minutes before the download starts |
| Nightly sync pulls far more than a day of rows | the table restamps `lastupdated` on adjustment (`SEP`, `SFP`) — expected, and the reason windowing exists |

## Reference

- API documentation — <https://docs.data.nasdaq.com/>
- Sharadar Core US Equities — <https://data.nasdaq.com/databases/SFA>
- Table documentation (column-by-column) — <https://data.nasdaq.com/databases/SFA/documentation>
- Python SDK — <https://github.com/Nasdaq/data-link-python>
- Provider notes, coverage and caveats — [sources.md](sources.md)
