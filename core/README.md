# core/

The data engine: a Python backend over a Postgres database, plus a FastAPI bridge that
exposes it as JSON. The frontend is `web/`.

This page is a map of the code. Installing, building the database and keeping it fresh
are in [../docs/setup/](../docs/setup/README.md) — the checklist — and
[../docs/setup/database.md](../docs/setup/database.md), which has every `bootstrap`
command and flag.

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
Most Sharadar tables need no per-table code — the generic loader is schema-driven: it
reads each table's column types and key from Sharadar's `INDICATORS` metadata, creates a
matching flat mirror table, and stamps `permaticker` from `TICKERS` after every load.

## Run it

```bash
pip install -r core/requirements.txt
cp core/.env.example core/.env                    # then fill in the keys
python -m core.setup.bootstrap --create-db         # build the database (hours; see docs/setup)
uvicorn core.api.main:app --reload --port 8001     # -> http://127.0.0.1:8001/docs
```

`./dev.sh` at the repo root runs the API and the frontend together. To refresh a built
database, use `python -m core.setup.bootstrap --force` — without `--force` it only resumes,
skipping every table that already holds rows.

## Where things are documented

| Topic | Document |
|---|---|
| Building, refreshing, resuming, unjamming | [../docs/setup/database.md](../docs/setup/database.md) |
| Tables, keys, indexes, per-table sync modes | [../docs/reference/schema.md](../docs/reference/schema.md) |
| The Nasdaq Data Link API the Sharadar loaders use | [../docs/reference/nasdaq-data-link.md](../docs/reference/nasdaq-data-link.md) |
| Each provider: licence, access, caveats | [../docs/reference/sources.md](../docs/reference/sources.md) |
| Settings and the screen YAML schema | [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md) |
| Research folder, backtests, screen studies | [../docs/RESEARCH.md](../docs/RESEARCH.md) |
| Running it on a server, the nightly refresh | [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) |

The dataset list itself is not copied into any doc: `python -m core.setup.bootstrap
--sources` prints it from `backend/sources.py`.

## Reuse cheatsheet

- **New Sharadar table:** add a `Dataset` entry in `backend/sources.py`; the loader needs
  no code — `python -m core.setup.bootstrap --dataset sharadar:<CODE>`.
- **New screen:** copy a YAML in `config/screens/`, or save one from the Screener. No Python.
- **New (non-Sharadar) data source:** subclass `BaseIngestor` (`backend/ingest/`), add
  query functions in `backend/queries/`, and declare it in `backend/sources.py` (FRED is
  the worked example).
- **New endpoint:** add a module in `api/routers/` and register it in `api/main.py`. Query
  through `backend/queries/` — don't put SQL in a route. Identify securities by
  `permaticker`, not ticker.
- **New derived table:** build into `<name>__new` under `queries/_rebuild.single_flight`,
  then `swap_in()`; register it as a `derived:` dataset so bootstrap rebuilds it last.
