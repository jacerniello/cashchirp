# cashchirp

This repo is an open-source tool for building your own investing research setup on top of a high-quality dataset: a local
Postgres copy of the Sharadar dataset, kept current, with a screener and a web frontend over it.

## What Sharadar is

Sharadar is a vendor of US equity market data, sold through
[Nasdaq Data Link](https://data.nasdaq.com/databases/SFA). The Core US Equities bundle
this project targets covers roughly 21,000 companies, 7,000 funds and 10,000 institutional
investors, with history back to **1998**, delivered as a handful of flat tables:

| Table | What's in it |
|---|---|
| `SF1` | Core fundamentals — income statement, balance sheet, cash flow, per period and dimension |
| `SEP` / `SFP` | End-of-day prices for equities and for funds, adjusted and unadjusted |
| `DAILY` | Daily valuation — market cap, P/E, EV and friends |
| `SF2` | Insider transactions, from Forms 3, 4 and 5 |
| `SF3` / `SF3A` / `SF3B` | 13F institutional holdings — by position, by security, by investor |
| `TICKERS` | The security master, including `permaticker`, the issuer id that survives ticker recycling |
| `ACTIONS`, `EVENTS`, `SP500`, `METRICS` | Corporate actions, 8-K events, index membership, derived daily metrics |

Two things make it a reasonable base for research rather than just a price feed. It is
**point-in-time aware** where it matters — fundamentals carry both the report period and
the date they were filed, so you can ask what was actually knowable on a given day — and
it is **survivorship-complete**: delisted companies stay in the data, so a backward-looking
screen isn't quietly restricted to the firms that made it.

It is a **paid subscription**. The macro layer (FRED),
short interest (FINRA) and the fund reference data (SEC EDGAR) are all free. See
[docs/reference/sources.md](docs/reference/sources.md) for what each provider covers.

## Why a local database

The project is meant to be easily modifiable, and queries that may be difficult to make on 
subscription-based websites suddenly become feasible, once the database is set up.

The build (setup phase) pulls the tables down once and mirrors them into Postgres — one flat table
per Sharadar product, same rows, same values, the vendor's own primary key — after which
every question is a SQL query against local disk. Refreshes are incremental: each table
syncs only what changed.

How the API works and how the loader uses it:
[docs/reference/nasdaq-data-link.md](docs/reference/nasdaq-data-link.md). How the build
runs: [docs/setup/database.md](docs/setup/database.md).

Three parts:

- `core/` — the data engine. A Postgres database mirroring the Sharadar tables (one flat
  table per Sharadar product) plus FRED macro panels, the query modules over it, and
  `core/api/`, a FastAPI bridge serving them as JSON at `/api/v1`. See
  [core/README.md](core/README.md) and [docs/reference/schema.md](docs/reference/schema.md).
- `web/` — the frontend. Next.js, React and Tailwind: screener, company pages, macro and
  commodities. Routes are in `web/src/app`, shared components in `web/src/components`.
- `config/screens/` — the screens. YAML filters that say what you are looking for. This is
  the part you are meant to edit; the screener and the idea board both read these files.

## Documentation

| | |
|---|---|
| [docs/setup/](docs/setup/README.md) | Start here. Install, keys, build, verify. |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Sizing tiers, topology, the nightly refresh, backups. |
| [docs/setup/database.md](docs/setup/database.md) | The database on its own: build, resume, watch, repair. |
| [docs/setup/sources.md](docs/setup/sources.md) | Where each dataset comes from, and its licence. |
| [docs/reference/schema.md](docs/reference/schema.md) | Tables, keys, indexes, and the mirroring conventions. |
| [docs/reference/nasdaq-data-link.md](docs/reference/nasdaq-data-link.md) | How the Nasdaq Data Link API works, and how the loader uses it. |
| [docs/reference/sources.md](docs/reference/sources.md) | Long-form notes on each provider: coverage, access, caveats. |

## Running the app

One-time setup — database, Python deps, frontend deps:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r core/requirements.txt
cp core/.env.example core/.env            # add your API keys + SEC_USER_AGENT
cd core && docker compose up -d && cd ..  # local Postgres (or your own instance)
cd web && npm install && cd ..
python -m core.setup.bootstrap --check    # preflight, then:
python -m core.setup.bootstrap --create-db
```

The full build takes several hours and runs to tens of GB. It can be stopped and
resumed. See [docs/setup/](docs/setup/README.md), which also covers smaller builds that
still run the screener.

Then start both servers:

```bash
./dev.sh        # FastAPI bridge (:8001) + Next.js frontend (:3000)
open http://localhost:3000
```

The Next dev server proxies `/api/v1` to FastAPI. Ctrl-C stops both. To run them
separately:

```bash
uvicorn core.api.main:app --reload --port 8001       # API only (docs at /docs)
cd web && API_URL=http://127.0.0.1:8001 npm run dev  # frontend only (:3000)
```

## Screens

Screens live in `config/screens/` and run from the UI: `/screener` to build and save one,
`/screener/ideas` to run every saved screen against the latest snapshot.

There is no historical validation here. A screen returns a list of candidates to look
into, not evidence that the filter has an edge.

## Data

- Load or update one Sharadar table: `python -m core.setup.bootstrap --dataset sharadar:<CODE>`.
  One schema-driven loader; each table is a 1:1 mirror.
- Refresh everything: `python -m core.setup.bootstrap`.
- See what is loaded and when: the Runs tab at `/setup/runs`.
- If a load hangs: the Database tab at `/setup/database`. It is usually lock contention.

API keys live in `core/.env`, which is gitignored. Downloaded data under `core/data/` is
gitignored too, and can be re-fetched.

## License

[MIT](LICENSE) covers the code.

The data is not covered and is not redistributable. Sharadar is a paid Nasdaq Data Link
subscription under their terms; FRED, FINRA and SEC each have their own. This repo ships
the tools to build your own copy with your own keys. It never ships the data, and
`core/data/` is gitignored so a clone cannot carry it by accident.
