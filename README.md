# investing

A data-driven market-dynamics research project: build a faithful local database of US
equity/market data, then model how stocks behave, find outliers, and explain their
catalysts.

Three parts:

- **`core/`** — the data engine. A Postgres database that is a **faithful local mirror of
  the Sharadar data** (one flat table per Sharadar product) plus FRED macro panels, the
  Python repositories over it, and **`core/api/`** — a thin **FastAPI** bridge exposing the
  repositories as JSON at `/api/v1`. See [core/README.md](core/README.md) and
  [docs/reference/schema.md](docs/reference/schema.md) (schema, keys, fidelity).
- **`web/`** — the app. A **Next.js + React + Tailwind** frontend (screener, company pages,
  macro/commodities) that reads `core/api`. Routes are `web/src/app`, shared
  components `web/src/components`.
- **`config/screens/`** — the **screens**: declarative YAML filters that define what you're
  looking for. This is the main personalisation knob, and the live idea board and the
  CLI run the identical file.

## Documentation

| | |
|---|---|
| **[docs/setup/](docs/setup/README.md)** | **Start here.** The setup checklist: install, keys, build, verify. |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Sizing tiers, topology, the nightly job, backups. |
| [CLAUDE.md](CLAUDE.md) | Project charter: mission, operating principles, DB gotchas. |
| [docs/setup/database.md](docs/setup/database.md) | The database on its own: build, resume, watch a long run, repair. |
| [docs/setup/sources.md](docs/setup/sources.md) | Where every byte comes from — *generated* from the source registry. |
| [docs/reference/schema.md](docs/reference/schema.md) | Schema reference: schema, keys, fidelity. |

## Running the app

One-time setup (database + Python deps + the frontend's npm deps):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r core/requirements.txt
cp core/.env.example core/.env           # add your API keys + SEC_USER_AGENT
cd core && docker compose up -d && cd ..  # local Postgres (or your own instance)
cd web && npm install && cd ..            # one-time: install the frontend deps
python -m core.setup.bootstrap --check  # preflight, then:
python -m core.setup.bootstrap --create-db
```

The build takes hours and the full dataset is ~47 GB — it is resumable, and
**[docs/setup/](docs/setup/README.md) is the checklist**, and covers the smaller builds that
still run the screener.

Then start everything with one command:

```bash
./dev.sh        # FastAPI bridge (:8001) + Next.js frontend (:3000)
open http://localhost:3000
```

`dev.sh` runs both servers; the Next dev server proxies `/api/v1` → FastAPI. Stop with
Ctrl-C. To run them separately:

```bash
uvicorn core.api.main:app --reload --port 8001          # API only (docs at /docs)
cd web && API_URL=http://127.0.0.1:8001 npm run dev              # frontend only (:3000)
```

## Research

Define what you're looking for, then find out whether it ever worked:

```bash
# Screens live in config/screens/ and run from the Screener UI:
#   /screener            build and save one
#   /screener/ideas      every saved screen, run against the latest snapshot
```

There is no built-in historical validation: a basket is a list of candidates to research,
not evidence the filter has an edge.

## Data

- **Load/update any Sharadar table:** `python -m core.setup.bootstrap --dataset sharadar:<CODE>`
  (`--sync` for incremental). One schema-driven loader; tables are 1:1 mirrors.
- **Refresh everything:** `python -m core.setup.bootstrap` (the nightly job).
- **What's loaded + when:** `the Runs tab at /setup/runs`.
- **If a load hangs:** `the Database tab at /setup/database` — it's almost always lock contention.

> API keys live in `core/.env` (gitignored). The downloaded data under `core/data/` is
> gitignored and regenerable.

## License

[MIT](LICENSE) — the code.

**The data is not covered and is not redistributable.** Sharadar is a paid subscription
licensed from Nasdaq Data Link under their terms, and FRED, FINRA and SEC each have their
own. This repo ships the *tools* to build your own mirror with your own keys; it never
ships the data, and `core/data/` is gitignored precisely so a clone can't accidentally
carry it.
