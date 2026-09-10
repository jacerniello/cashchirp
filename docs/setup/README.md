# Setup

A checklist for going from a fresh clone to a working system. Around 30 minutes of
setup, then several hours of unattended downloading.

| | |
|---|---|
| **This page** | The checklist. Start here. |
| **`/setup` in the app** | The same status, live — what's loaded, what's missing, and a running build's progress. |
| [database.md](database.md) | The database on its own — build, resume, watch, verify, repair. |
| [sources.md](sources.md) | Where every byte comes from. Kept in step with the registry by hand. |
| [../CONFIGURATION.md](../CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Running it somewhere other than your laptop. |

> There is no database to download. It is a local mirror of data you license, rebuilt
> from source with your own keys. Step 4 does that, and it is the long step.

---

## The checklist

### 1 · Prerequisites

- [ ] **Python 3.13+** — `python3 --version`
- [ ] **Postgres 16** — Docker (`cd core && docker compose up -d`) or your own instance
- [ ] **Node 20+** — only if you want the web frontend
- [ ] **Disk: 2× your target size.** A full build is about 47 GB of tables, and Postgres
      needs headroom on top for index builds, vacuum, and the derived rebuilds, which
      write a second copy before swapping it in. Check with `df -h`.
- [ ] **A Nasdaq Data Link account with a Sharadar Core US Equities subscription** — the
      paid one, and 35 of those 47 GB. Everything else is free. You can skip it and run
      only the macro layer; see [Without Sharadar](#without-sharadar).

### 2 · Install

```bash
git clone <your-fork> cashchirp && cd cashchirp
python -m venv .venv && source .venv/bin/activate
pip install -r core/requirements.txt
cd web && npm install && cd ..          # only if you want the frontend
```

- [ ] Dependencies installed

### 3 · Credentials

```bash
cp core/.env.example core/.env
```

Fill in three values. `core/.env` is gitignored, so nothing leaves your machine.

- [ ] `NASDAQ_DATA_LINK_API_KEY` — https://data.nasdaq.com/account/profile
- [ ] `FRED_API_KEY` — https://fredaccount.stlouisfed.org/apikeys (free, instant)
- [ ] `SEC_USER_AGENT` — **your own** name and email, e.g. `Jane Doe jane@example.com`

> SEC EDGAR returns `403` to any request without a descriptive User-Agent carrying a real
> contact, and it rate-limits by that identity — borrow someone else's and you both get
> blocked. There is deliberately no default.

The full list of what each credential unlocks: [sources.md](sources.md#credentials-you-need).

### 4 · Build the database

This is the long step, and it has its own guide: **[database.md](database.md)**.

```bash
python -m core.setup.bootstrap --check       # preflight: env file, keys, Postgres, database
python -m core.setup.bootstrap --plan        # what will run, from where, how big
python -m core.setup.bootstrap --sources     # where every byte comes from
python -m core.setup.bootstrap --create-db   # go
```

- [ ] Preflight passes (`--check` prints `all checks passed`)
- [ ] You've looked at `--plan` and accepted the size
- [ ] Build finished, or you know which steps failed

Re-running the same command skips finished steps, so a failure or a Ctrl-C costs only
the step it happened in. `--watch` from a second terminal follows a run in progress.

### 5 · Check the build

Worth doing before relying on any number: financial data looks plausible while being
wrong, and anything downstream inherits the error without complaint.

```bash
python -m core.setup.bootstrap --status   # tables, row counts, sizes on disk
```

- [ ] `--status` shows the tables you expect, at plausible sizes

Once the app is running, **http://localhost:3000/setup** shows the same picture in the
browser — per-dataset loaded/missing, sizes, sources, and the live progress of a build
that is still running. It is the page to open when another page errors: it tells
"not loaded yet" apart from "the app is broken".

### 6 · Run it

```bash
./dev.sh                     # API on :8001, web on :3000
open http://localhost:3000
```

- [ ] http://localhost:3000 loads
- [ ] http://127.0.0.1:8001/health returns `{"status":"ok"}`
- [ ] `/screener/ideas` shows a basket

The last of those covers the whole path at once — database, derived snapshot, and your
screen spec.

### 7 · Make it yours

Nothing so far is specific to you. This is:

- [ ] **`config/screens/*.yaml`** — what you're looking for. Copy `quality-value.yaml`,
      change the numbers, point `ACTIVE_SCREEN` at yours.
      → [../CONFIGURATION.md](../CONFIGURATION.md)

### 8 · Keep it fresh

`bootstrap` goes from nothing to a database. After that, refreshes are incremental:

```bash
python -m core.setup.bootstrap
```

- [ ] Scheduled nightly (optional) — see [../DEPLOYMENT.md](../DEPLOYMENT.md#nightly-refresh)

It exits non-zero if any step fails, so anything that alerts on a non-zero exit gives
you monitoring. A broken nightly job otherwise gives no signal at all — it just keeps
serving last week's numbers.

---

## Without Sharadar

The macro layer is free and independent. Build just it:

```bash
python -m core.setup.bootstrap --create-db --only-phase schema fred
```

You get the `/macro` endpoints. The screener, company, insider and institutional pages
return empty — and the screener reports that its gated columns are unpopulated rather
than pretending to have screened anything.

## Smaller builds

You do not need all 47 GB. `--only` takes Sharadar tables:

| You want | Build | Size |
|---|---|---:|
| Screener, ideas, company fundamentals | `--only TICKERS SF1 DAILY` | ~10 GB |
| **+ price history and charts** | `--only TICKERS SF1 DAILY SEP` | ~20 GB |
| + insider / 13F / ETF pages | everything | ~47 GB |

Add tables later; the loaders are incremental and independent. Sizes above are the raw
tables — the derived rebuilds add ~9 GB on a full build.

## When something goes wrong

| Symptom | Cause |
|---|---|
| `connection refused` | Postgres isn't running — `cd core && docker compose up -d` |
| `relation "daily" does not exist` | That table isn't loaded — `bootstrap --status` |
| SEC calls return `403` | `SEC_USER_AGENT` unset, or not a real contact |
| API `403`/`429` mid-build | Key wrong, or your Sharadar plan doesn't cover that table |
| A load hangs for many minutes | Lock contention — see the Database tab at `/setup/database` |
| `No screen 'x' in config/screens` | `ACTIVE_SCREEN` names a file that isn't in `config/screens/` |
| `operator does not exist: text = integer` | Joining `tickers.permaticker` (TEXT) to an equity table's (bigint). Cast: `tickers.permaticker::bigint` |
| `syntax error at or near "table"` | `table` is reserved *and* a real column in `tickers`. Quote it: `"table"` |

Build-time failures in more depth: [database.md](database.md#when-a-step-fails).
