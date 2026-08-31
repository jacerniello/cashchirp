# Setup

Everything needed to go from a fresh clone to a working system, as a checklist you can
tick off. Roughly **30 minutes of your attention**, then **several hours of unattended
downloading**.

| | |
|---|---|
| **This page** | The checklist. Start here. |
| **`/setup` in the app** | The same status, live — what's loaded, what's missing, and a running build's progress. |
| [database.md](database.md) | The database on its own — build, resume, watch, verify, repair. |
| [sources.md](sources.md) | Where every byte comes from. *Generated from the registry.* |
| [../CONFIGURATION.md](../CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | Running it somewhere other than your laptop. |

> **Nobody ships you the database.** It is a local mirror of data *you* license, rebuilt
> from source with your own keys. Step 4 is where that happens, and it is the long one.

---

## The checklist

### 1 · Prerequisites

- [ ] **Python 3.13+** — `python3 --version`
- [ ] **Postgres 16** — Docker (`cd core && docker compose up -d`) or your own instance
- [ ] **Node 20+** — only if you want the web frontend
- [ ] **Disk: 2× your target size.** A full build lands at **~47 GB** of tables, but
      Postgres needs headroom for index builds, vacuum, and the derived rebuilds, which
      write a full second copy before swapping it in. Check with `df -h`.
- [ ] **A Nasdaq Data Link account with a Sharadar Core US Equities subscription** — this
      one is paid, and it is 35 of those 47 GB. Everything else is free. You can skip it
      and still run the macro layer; see [Without Sharadar](#without-sharadar).

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
python -m core.scripts.setup.bootstrap --check       # preflight — catches the 5 things that go wrong
python -m core.scripts.setup.bootstrap --plan        # what will run, from where, how big
python -m core.scripts.setup.bootstrap --sources     # where every byte comes from
python -m core.scripts.setup.bootstrap --create-db   # go
```

- [ ] Preflight passes (`--check` prints `all checks passed`)
- [ ] You've looked at `--plan` and accepted the size
- [ ] Build finished, or you know which steps failed

It is **resumable** — re-run the same command and finished steps are skipped, so a
failure or a Ctrl-C costs only the step it happened in. `--watch` from a second terminal
follows a long run. You can close the laptop lid on it.

### 5 · Verify — before trusting a single number

Don't skip this. Financial data looks entirely plausible while being wrong, and every
downstream conclusion inherits the corruption silently.

```bash
python -m core.scripts.setup.bootstrap --status   # tables, row counts, sizes on disk
python -m core.scripts.ops.verify_sharadar      # local rows == what was downloaded, per table
python -m core.scripts.ops.load_status          # what loaded, and when
```

- [ ] `--status` shows the tables you expect, at plausible sizes
- [ ] `verify_sharadar` reports no mismatches

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
- [ ] `python -m core.scripts.screen.run_screen` prints a basket

That last one is the real end-to-end test: it exercises the database, the derived
snapshot, and your screen spec in one go.

### 7 · Make it yours

Nothing so far is personal. Two things are:

- [ ] **`config/screens/*.yaml`** — what you're looking for. Copy `quality-value.yaml`,
      change the numbers, point `ACTIVE_SCREEN` at yours.
      → [../CONFIGURATION.md](../CONFIGURATION.md)
- [ ] **`research/`** — your experiments, logs, insights and write-ups. Ships empty.
      → [../RESEARCH_WORKFLOW.md](../RESEARCH_WORKFLOW.md)

### 8 · Keep it fresh

`bootstrap` goes from nothing to a database. After that, refreshes are incremental:

```bash
python -m core.scripts.load.update_all
```

- [ ] Scheduled nightly (optional) — see [../DEPLOYMENT.md](../DEPLOYMENT.md#nightly-refresh)

It exits non-zero if any step fails, so anything that alerts on non-zero gives you
monitoring for free. You want that: a broken nightly job doesn't error at you, it just
quietly serves last week's numbers.

---

## Without Sharadar

The macro layer is free and independent. Build just it:

```bash
python -m core.scripts.setup.bootstrap --create-db --only-phase schema fred
```

You get the `/macro` endpoints. The screener, company, insider and institutional pages
return empty — and `run_screen` will tell you the gated columns are unpopulated rather
than pretending to have screened anything.

## Smaller builds

You do not need all 47 GB. `--only` takes Sharadar tables:

| You want | Build | Size |
|---|---|---:|
| Screener, ideas, company fundamentals | `--only TICKERS SF1 DAILY` | ~10 GB |
| **+ backtests** (needs prices) | `--only TICKERS SF1 DAILY SEP` | ~20 GB |
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
| A load hangs for many minutes | Lock contention — `python -m core.scripts.ops.unjam` |
| `No screen 'x' in config/screens` | `ACTIVE_SCREEN` names a missing file — `run_screen --list` |
| `operator does not exist: text = integer` | Joining `tickers.permaticker` (TEXT) to an equity table's (bigint). Cast: `tickers.permaticker::bigint` |
| `syntax error at or near "table"` | `table` is reserved *and* a real column in `tickers`. Quote it: `"table"` |

Build-time failures in more depth: [database.md](database.md#when-a-step-fails).
