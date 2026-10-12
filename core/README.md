# core/

The data engine: a Python backend over a Postgres database, plus a FastAPI bridge that
exposes it as JSON. The frontend is `web/`.

## Layout

```
core/
├── config.py              # one source of truth (reads core/.env)
├── docker-compose.yml     # local Postgres
├── requirements.txt
├── backend/               # UI-agnostic data engine (reusable everywhere)
│   ├── db/                # engine, session, ORM models (schema)
│   ├── ingest/            # BaseIngestor pattern + Sharadar / FRED / FINRA / SEC ingestors
│   ├── queries/           # the query API — call these, don't write SQL in routes
│   ├── jobs/              # job runtime + the scheduler behind Setup -> Schedules
│   ├── research/          # the research folder store + the AI guide and DD standard
│   ├── backtest/          # point-in-time backtest harness, reports, screen studies
│   ├── sources.py         # the dataset registry: provenance and the load plan
│   └── screens.py         # screen specs: config/screens/*.yaml -> a DataFrame filter
├── api/                   # FastAPI bridge, mounted at /api/v1
│   ├── main.py            # app factory + router mounting
│   └── routers/           # one module per resource, grouped by area (discovery, market, research, …)
├── setup/                 # the two entry points: bootstrap, reset_db
└── data/                  # downloads + run state (gitignored)
```

**Data flow:** `ingest` → Postgres → `queries` → `api/routers` → `web/`.
Most Sharadar tables need no per-table code — the generic loader is schema-driven.

Personalisation lives outside this folder: what to look for is `config/screens/*.yaml`,
and `core/` runs whatever those say. See
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

**Refresh everything:** `python -m core.setup.bootstrap --force`. It runs every
Sharadar table in its correct sync mode (the per-table mapping below), then FRED (MD/QD
vintages + commodity spot), then FINRA short interest (incremental), then the SEC fund-class
map, then rebuilds the derived objects (`screener_snapshot`, `holder_timeseries`,
`institutional_holdings_timeseries`, `derived.insider[_company]`, `sp500_concentration`)
once, after all inputs are fresh. Each step is isolated (a failure is logged and the run
continues); it exits non-zero if any step failed. A build schedule in Setup -> Schedules
runs the same command in update mode.
Narrow the run with `--only-phase`; there are no per-stage skip flags.

Without `--force`, a step whose table already holds rows is skipped. That is how a
from-zero build resumes, and it means a bare `bootstrap` on a built database refreshes
nothing.

```bash
python -m core.setup.bootstrap --force                      # all tables + FRED + FINRA + SEC + derived
python -m core.setup.bootstrap --plan                       # print the step list, run nothing
python -m core.setup.bootstrap --only SEP SF1 --force       # subset of Sharadar tables
python -m core.setup.bootstrap --only-phase derived --force # just rebuild the precomputed objects
```

**If a refresh hangs or stalls, open the Database tab at `/setup/database` first** (the
setup pages need `SETUP_ENABLED=true` in `core/.env`). It's the
go-to first check when data won't refresh. A refresh stalls almost always because something
else is holding Postgres locks — most often the **app rebuilding a derived table**
(`screener_snapshot`, `holder_timeseries`) at the same time: a `DROP TABLE … ; rebuild` needs
an exclusive lock, an `idle in transaction` connection holds a read lock in front of it, and
every reader piles up behind.

That tab lists the current backends and offers **Unjam**, which stops this project's running
jobs and terminates the jammed backends (idle-in-transaction / blocked / blocking) so you can
start clean. It's narrowly scoped — never touches other projects or its own connection.

The sections below cover the individual loaders the orchestrator drives.

**One loader for every Sharadar table.** The schema-driven generic loader reads the
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
#   --full    re-download the bulk export into a fresh copy, diff it, swap it in (hours,
#             and disk for a second copy of the table)
```

Each table's sync mode and its watermark column are declared in the registry
(`core/backend/sources.py`), not passed on the command line: `mode="sync"` with an
optional `sync_col`, or `mode="quarters"` for the tables with no change column at all.
Changing how a table syncs means editing its `Dataset` entry.

Re-run with `--force` to update in place (upsert on Sharadar's primary key). **Incremental
updates** pick a mode by what change-column the table has:

```bash
python -m core.setup.bootstrap --dataset sharadar:SF1 --force
python -m core.setup.bootstrap --dataset sharadar:SEP --force
python -m core.setup.bootstrap --dataset sharadar:SF2 --force
python -m core.setup.bootstrap --dataset sharadar:SF3 --force
```

A `sync` table catches new rows (and, where it has `lastupdated`, edits too); it streams
pages straight into Postgres, so the query API's ~1M-rows-per-call cap does not limit it. A
`quarters` table re-pulls whole recent quarters in key-chunks under the cap, so it captures
amendments within them. See `docs/reference/schema.md` → Operational notes "Updating" for the
per-table table. The dataset keys are in `core/backend/sources.py`. Every table is
a flat 1:1 mirror; the app's Company page reads `sep` (by permaticker) directly.

**Special cases (still on top of the generic loader):**

```bash
# EVENTS loads like any other table. The code legend (event_codes) and the
# events_decoded view come from load_event_codes() in
# backend/ingest/sharadar/sharadar_event_codes.py, which bootstrap does not call.

# permaticker needs no command: the loader stamps it after every ticker-bearing table.

# Macro data (FRED-MD/QD panels):
python -m core.setup.bootstrap --only-phase fred                 # MD + QD vintages + spot

# Precompute the Screener snapshot (the screener also builds it on demand when missing or stale):
python -m core.setup.bootstrap --dataset derived:screener_snapshot
```

**Inspect what's loaded:** the Setup overview at `/setup` (rows, size and latest load per
dataset); the Runs tab at `/setup/runs` lists every job the app has started.
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

Screens run from the UI: the Filter tab (`/screener`) to build one, Saved screens
(`/screener/ideas`) for every saved screen, Snapshots (`/screener/snapshots`) to freeze a
result. A screen produces a list of candidates, not evidence that the filter has an edge —
that is what a backtest is for (`backend/backtest/`). Schema:
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

## Research

`backend/research/store.py` reads and writes the research folder (`settings.research_dir`):
reports (each with its own per-stock DD, red teams and notes) and screener snapshots.
`backend/research/guide/` holds the DD and red-team standards and `AGENT_GUIDE.md`, which is
copied into the folder as `CLAUDE.md` (the file an AI agent reads there) when the API
starts. Routes: `api/routers/research/`. See
[../docs/RESEARCH.md](../docs/RESEARCH.md).

## Reuse cheatsheet

- **New Sharadar table:** nothing to write — `python -m core.setup.bootstrap --dataset sharadar:
  <CODE>` (schema-driven from metadata).
- **New screen:** copy a YAML in `config/screens/`. No Python.
- **New (non-Sharadar) data source:** subclass `BaseIngestor` (`backend/ingest/`), add
  query functions in `backend/queries/`, and declare it in `backend/sources.py` (FRED is
  the worked example).
- **New endpoint:** add a module in `api/routers/` and register it in `api/main.py`. Query
  through `backend/queries/` — don't put SQL in a route. Identify securities by
  `permaticker`, not ticker.
