# core/

The data engine: a Python **backend** over a **Postgres** database, plus a thin **FastAPI**
bridge that exposes it as JSON. The frontend is `web/`.

## Layout

```
core/
├── config.py              # one source of truth (reads core/.env)
├── docker-compose.yml     # local Postgres
├── requirements.txt
├── backend/               # UI-agnostic data engine (reusable everywhere)
│   ├── db/                # engine, session, ORM models (schema)
│   ├── ingest/            # BaseIngestor pattern + Sharadar / FRED ingestors
│   ├── queries/           # the query API — call these, don't write SQL in routes
│   └── screens.py         # screen specs: config/screens/*.yaml -> a DataFrame filter
├── api/                   # FastAPI bridge, mounted at /api/v1
│   ├── main.py            # app factory + router mounting
│   └── routers/           # one module per resource (screener, company, macro, …)
├── setup/                 # the two entry points: bootstrap, reset_db
└── data/                  # downloads + run state (gitignored)
```

**Data flow:** `ingest` → Postgres → `queries` → `api/routers` → `web/`.
Most Sharadar tables need no per-table code — the generic loader is schema-driven.

**Personalisation lives outside this folder** on purpose: what to look for is
`config/screens/*.yaml`, and `core/` runs whatever those say. See
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

**Database structure** (tables, keys, the faithful-mirror design): see
[docs/reference/schema.md](../docs/reference/schema.md). **The upstream API** the Sharadar
loaders talk to (bulk export, the query API, the row cap, `INDICATORS`): see
[docs/reference/nasdaq-data-link.md](../docs/reference/nasdaq-data-link.md).

## Setup

```bash
# 0. from the repo root, with the venv active
pip install -r core/requirements.txt

# 1. config
cp core/.env.example core/.env        # edit if you like

# 2. start Postgres (Docker)
cd core && docker compose up -d && cd ..

# 3. create tables
python -m core.setup.bootstrap --only-phase schema

# 4. collect data (see "Loading / updating data" below)
python -m core.setup.bootstrap --dataset sharadar:TICKERS
python -m core.setup.bootstrap --dataset sharadar:SF1
python -m core.setup.bootstrap --only-phase fred                    # macro panel: FRED-MD vintages

# 5. build the screener snapshot
python -m core.setup.bootstrap --dataset derived:screener_snapshot

# 6. run the API  ->  http://127.0.0.1:8001/docs
uvicorn core.api.main:app --reload --port 8001
```

Full walkthrough, including which tables are worth loading and how big they are:
[../docs/setup/](../docs/setup/README.md).

> Prefer the Postgres already on your machine instead of Docker? Set the `POSTGRES_*`
> values in `core/.env` to point at it (and `createdb investing`); skip step 2.

## Loading / updating data

**Refresh everything with one command** — `python -m core.setup.bootstrap`. It runs every
Sharadar table in its correct sync mode (the per-table mapping below), then FRED (MD/QD
vintages + commodity spot), then FINRA short interest (incremental), then rebuilds the derived
objects (`screener_snapshot`, `holder_timeseries`, `derived.insider[_company]`) once, after all
inputs are fresh. Each step is isolated (a failure is logged and the run continues); it exits
non-zero if any step failed. This is what a schedule in Setup -> Schedules runs.
Narrow the run with `--only-phase`; there are no per-stage skip flags.

```bash
python -m core.setup.bootstrap                      # all tables + FRED + derived
python -m core.setup.bootstrap --plan               # print the step list, run nothing
python -m core.setup.bootstrap --only SEP SF1       # subset of Sharadar tables
python -m core.setup.bootstrap --only-phase derived # just rebuild the precomputed objects
```

**If a refresh hangs or stalls, open the Database tab at `/setup/database` first.** It's the
go-to first check when data won't refresh. A refresh stalls almost always because something
else is holding Postgres locks — most often the **app rebuilding a derived table**
(`screener_snapshot`, `holder_timeseries`) at the same time: a `DROP TABLE … ; rebuild` needs
an exclusive lock, an `idle in transaction` connection holds a read lock in front of it, and
every reader piles up behind.

That tab lists the current backends and offers **Unjam**, which stops this project's running
jobs and terminates the jammed backends (idle-in-transaction / blocked / blocking) so you can
start clean. It's narrowly scoped — never touches other projects or its own connection.

The sections below cover the individual loaders the orchestrator drives.

**One loader for every Sharadar table** — the schema-driven generic loader. It reads the
table's column types and primary key from Sharadar's own `INDICATORS` metadata, creates a
matching Postgres table (a faithful flat mirror, named after the code, lowercased), upserts
the bulk CSV on Sharadar's primary key, and stamps `permaticker` from `TICKERS`. Idempotent,
prints stage/MB progress, records every run in `load_log`.

```bash
python -m core.setup.bootstrap --dataset sharadar:SEP
python -m core.setup.bootstrap --dataset sharadar:SF1
python -m core.setup.bootstrap --dataset sharadar:TICKERS
python -m core.setup.bootstrap --dataset sharadar:ACTIONS
#   --force   re-run a step whose table already holds rows (still an incremental sync)
#   --full    re-download the bulk export from scratch and upsert the lot (hours)
```

Each table's sync mode and its watermark column are declared in the registry
(`core/backend/sources.py`), not passed on the command line: `mode="sync"` with an
optional `sync_col`, or `mode="quarters"` for the tables with no change column at all.
Changing how a table syncs means editing its `Dataset` entry.

Re-run to update in place (upsert on Sharadar's primary key). **Incremental updates** pick a
mode by what change-column the table has (the query API caps ~1M rows/call):

```bash
python -m core.setup.bootstrap --dataset sharadar:SF1
python -m core.setup.bootstrap --dataset sharadar:SEP
python -m core.setup.bootstrap --dataset sharadar:SF2
python -m core.setup.bootstrap --dataset sharadar:SF3
```

A `sync` table catches new rows (and, where it has `lastupdated`, edits too); a `quarters`
table re-pulls whole recent quarters so it captures amendments within them. `sfp` restamps a
single day past the cap, so it needs `--full`. See `docs/reference/schema.md` → Operational notes "Updating" for the
per-table table. The dataset keys are in `core/backend/sources.py`. Every table is
a flat 1:1 mirror; the app's Company page reads `sep` (by permaticker) directly.

**Special cases (still on top of the generic loader):**

```bash
# EVENTS code legend (event_codes) + the events_decoded view (load EVENTS first):
python -m core.setup.bootstrap --dataset sharadar:EVENTS

# permaticker needs no command: the loader stamps it after every ticker-bearing table.

# Macro data (FRED-MD/QD panels):
python -m core.setup.bootstrap --only-phase fred                 # MD + QD vintages + spot

# Precompute the Screener snapshot (also auto-runs after a DAILY load):
python -m core.setup.bootstrap --dataset derived:screener_snapshot
```

**Inspect what's loaded:** the Runs tab at `/setup/runs` (latest run per dataset).
Raw zips are downloaded on demand to `core/data/downloads/sharadar/` (gitignored) and
deleted once the load commits — the routine refresh syncs deltas over the query API and
never opens one. A load that raises keeps its zip so a retry can reuse it; there is no
download-only command.

**Scheduling:** the API runs its own scheduler, so a cadence is set in the UI at
`/setup/schedules` and stored in Postgres rather than in a crontab. To drive it from
outside the app instead, see [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#nightly-refresh).

## Screens

The screener's saved filters are YAML, not code — `config/screens/*.yaml`, loaded by
`backend/screens.py`. `ACTIVE_SCREEN` in `core/.env` picks the default.

Screens run from the UI: `/screener` to build one, `/screener/ideas` for every saved
screen. There is no CLI runner and no backtest harness — a screen produces a list of
candidates, not evidence that the filter has an edge. Schema:
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

## Reuse cheatsheet

- **New Sharadar table:** nothing to write — `python -m core.setup.bootstrap --dataset sharadar:
  <CODE>` (schema-driven from metadata).
- **New screen:** copy a YAML in `config/screens/`. No Python.
- **New (non-Sharadar) data source:** subclass `BaseIngestor` (`backend/ingest/`), add
  query functions in `backend/queries/`, and declare it in `backend/sources.py` (FRED is
  the worked example).
- **New endpoint:** add a module in `api/routers/` and register it in `api/main.py`. Query
  through `backend/queries/` — don't put SQL in a route. Identify securities by **permaticker**,
  not ticker.
