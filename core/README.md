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
│   ├── repositories/      # the query API — call these, don't write SQL in routes
│   └── screens.py         # screen specs: config/screens/*.yaml -> a DataFrame filter
├── api/                   # FastAPI bridge, mounted at /api/v1
│   ├── main.py            # app factory + router mounting
│   └── routers/           # one module per resource (screener, company, macro, …)
└── scripts/               # CLI: init_db, sharadar_load_generic, run_screen,
                           #      verify_sharadar, load_status, update_all, fred/
```

**Data flow:** `scripts`/`ingest` → Postgres → `repositories` → `api/routers` → `web/`.
Most Sharadar tables need no per-table code — the generic loader is schema-driven.

**Personalisation lives outside this folder** on purpose: what to look for is
`config/screens/*.yaml`, and `core/` runs whatever those say. See
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

**Database structure** (tables, keys, the faithful-mirror design): see
[docs/reference/schema.md](../docs/reference/schema.md).

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
non-zero if any step failed. This is what the daily scheduled job
(`com.investing.sharadar.plist.example`) runs. Skip stages with `--no-fred` / `--no-finra` / `--no-derived` / `--no-sharadar`.

```bash
python -m core.setup.bootstrap              # all tables + FRED + derived
python -m core.setup.bootstrap --dry-run    # print the plan, run nothing
python -m core.setup.bootstrap --only SEP SF1   # subset of Sharadar tables
python -m core.setup.bootstrap --derived-only   # just rebuild the precomputed objects
```

**If a refresh hangs or stalls, run `the Database tab at /setup/database` first.** It's the go-to
first check when data won't refresh. A refresh stalls almost always because something else is
holding Postgres locks — most often the **app rebuilding a derived table** (`screener_snapshot`,
`holder_timeseries`) at the same time: a `DROP TABLE … ; rebuild` needs an exclusive lock, an
`idle in transaction` connection holds a read lock in front of it, and every reader piles up
behind. `unjam` stops this project's running jobs (`update_all`, `sharadar_*`, the app) and
terminates the jammed DB backends (idle-in-transaction / blocked / blocking) so you can start
clean. It's narrowly scoped — never touches other projects or its own connection.

```bash
the Database tab at /setup/database
the Database tab at /setup/database
the Database tab at /setup/database
```

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
#   --sync               incremental: pull rows with <col> >= watermark and upsert
#   --sync-col <col>     watermark column for --sync (default lastupdated; e.g. date,
#                        filingdate, calendardate for tables that lack lastupdated)
#   --sync-quarters      re-pull recent quarters in key-chunks (tables with no change
#                        column at all, e.g. SF3); --quarters N / --chunk-key <col>
#   --no-download        reuse an existing core/data/sharadar/<CODE>.zip
#   --dest <name>        override the destination table name
```

Re-run to update in place (upsert on Sharadar's primary key). **Incremental updates** pick a
mode by what change-column the table has (the query API caps ~1M rows/call):

```bash
python -m core.setup.bootstrap --dataset sharadar:SF1
python -m core.setup.bootstrap --dataset sharadar:SEP
python -m core.setup.bootstrap --dataset sharadar:SF2
python -m core.setup.bootstrap --dataset sharadar:SF3
```

`--sync`/`--sync-col` catch new rows (and, with `lastupdated`, edits too); `--sync-quarters`
re-pulls whole recent quarters so it captures amendments within them. `sfp` restamps a single
day past the cap → full backfill only. See `docs/reference/schema.md` → Operational notes "Updating" for the
per-table table. The dataset keys are in `core/backend/sources.py`. Every table is
a flat 1:1 mirror; the app's Company page reads `sep` (by permaticker) directly.

**Special cases (still on top of the generic loader):**

```bash
# EVENTS code legend (event_codes) + the events_decoded view (load EVENTS first):
python -m core.setup.bootstrap --dataset sharadar:EVENTS

# permaticker is stamped automatically on each load; to (re)backfill all tables at once:
# permaticker is stamped by the loader after every ticker-bearing table loads

# Macro data (FRED-MD/QD panels):
python -m core.setup.bootstrap --only-phase fred                 # --qd, --revised, --limit N

# Verify loaded tables match the downloaded files (row + per-column non-null):
# fidelity check: the verification helpers in `core/backend/verify.py` (`verify_all()`, importable; no CLI)

# Precompute the Screener snapshot (also auto-runs after a DAILY load):
python -m core.setup.bootstrap --dataset derived:screener_snapshot
```

**Inspect what's loaded:** `the Runs tab at /setup/runs` (latest run per dataset).
Raw zips are downloaded on demand to `core/data/sharadar/` (gitignored);
The download-only CLI has been removed.

**Scheduling:** copy `core/scripts/com.investing.sharadar.plist.example` (macOS launchd),
replacing `{{PROJECT_ROOT}}`. For a systemd timer, see
[../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#nightly-refresh).

## Screens

The screener's saved filters are YAML, not code — `config/screens/*.yaml`, loaded by
`backend/screens.py`. `ACTIVE_SCREEN` in `core/.env` picks the default.

```bash
# Screens run from the Screener UI now: /screener, and /screener/ideas for saved ones.
```

Both the live `/screener/ideas/` endpoint and the backtest harness load the same spec, so a
backtest provably tests the filter you ship. Schema:
[../docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

## Reuse cheatsheet

- **New Sharadar table:** nothing to write — `python -m core.setup.bootstrap --dataset sharadar:
  <CODE>` (schema-driven from metadata).
- **New screen:** copy a YAML in `config/screens/`. No Python.
- **New (non-Sharadar) data source:** subclass `BaseIngestor` (`backend/ingest/`), add
  repository functions, expose a `scripts/` CLI (FRED is the worked example).
- **New endpoint:** add a module in `api/routers/` and register it in `api/main.py`. Query
  through a repository — don't put SQL in a route. Identify securities by **permaticker**,
  not ticker.
