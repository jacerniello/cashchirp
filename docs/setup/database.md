# Building the database

The database on its own — no frontend, no research workflow. Read this if you want the
data and nothing else, or if a build failed and you need to understand what happened.

This database is a **local mirror of data you license from someone else**: Sharadar (via
Nasdaq Data Link), FRED, FINRA and SEC. Nobody ships you a copy. You rebuild it from those
sources with your own keys, and `core.setup.bootstrap` is the thing that does it.

Where each dataset comes from, what it costs and what it's licensed for:
**[sources.md](sources.md)** (generated) or `bootstrap --sources`.

---

## The one command

```bash
python -m core.setup.bootstrap --create-db
```

Everything else on this page is a variation on that.

| Command | What it does |
|---|---|
| `--check` | Preflight only. Touches nothing. |
| `--plan` | The step list: what runs, from which source, how big, what share of the work. |
| `--sources` | Provenance: provider, licence, credential, endpoint, size. |
| `--create-db` | Create the database if missing, then build. |
| `--only SEP SF1` | Only these Sharadar tables. |
| `--only-phase fred` | Only these phases (`schema sharadar fred finra sec derived`). |
| `--force` | Re-run steps whose tables already hold rows. |
| `--status` | What the database holds right now — tables, rows, size on disk. |
| `--watch` | Follow a run started in another terminal. |
| `--plain` | One line per event instead of a redrawing display (for logs/CI). |

---

## 1 · Preflight

```bash
python -m core.setup.bootstrap --check
```

Checks the five things that actually go wrong, and prints the fix for any that fail:

```
Preflight
  PASS  core/.env present                        /path/to/core/.env
  PASS  NASDAQ_DATA_LINK_API_KEY set             …cDGD
  PASS  FRED_API_KEY set                         …9ab4
  PASS  Postgres reachable at 127.0.0.1:5432     server 16.14
  FAIL  database 'investing' exists              missing

Blocked:
  database 'investing' exists
      re-run with --create-db (or: createdb investing)
```

A missing database is the one failure it can fix itself, with `--create-db`.

## 2 · See the work before committing to it

```bash
python -m core.setup.bootstrap --plan
```

Steps are grouped by phase, with the size each lands on disk so you can plan the disk.

**The size column is not the progress bar.** While a build runs, completion is whatever
the loaders *report* — bytes copied against the bulk export's own size, or an explicit
`8,400,000/41,000,000 rows` — never a prediction. A step that reports no denominator shows
no percentage at all rather than a fabricated one, and a step skipped on resume counts as
done without pretending gigabytes moved.

```bash
python -m core.setup.bootstrap --sources
```

...answers the other question: *where is this actually coming from, and am I allowed to
use it?* Provider, licence, the env var that unlocks it (and whether it's set), the exact
endpoint, and the tables each dataset writes.

## 3 · Build

```bash
python -m core.setup.bootstrap --create-db
```

Phases run in dependency order — **schema → Sharadar → FRED → FINRA → SEC → derived** —
and two constraints in that order are load-bearing:

- **`TICKERS` first.** It builds `permaticker_lookup`, which every other table's
  `permaticker` stamping reads. Load it late and the rest stamp nothing.
- **Derived last**, once every input is fresh. Rebuilding `screener_snapshot` while `SF1`
  is still loading gives you a snapshot of half-updated data — which looks perfectly
  valid and is silently wrong.

While it runs:

```
Building investing  127.0.0.1:5432   elapsed 2:14:07

 ✔ schema (create tables)                 0:00
 ✔ sharadar tickers (security master)     0:18   23,412 rows
 ✔ sharadar fundamentals  (sync)         14:22   16,940,113 rows
 ▶ sharadar equity prices (EOD)  (sync)   staging rows 8,400,000/41,000,000 …
 · sharadar fund prices (ETF/CEF)
 · sharadar daily valuation

 ████████░░░░░░░░░░░░░░░░░░░░   28.4%   4/25 steps
```

**A failed step does not stop the run.** It's recorded and the rest continues, so one
flaky download doesn't cost you the other twenty-four steps. The exit code is non-zero if
anything failed, and the summary lists exactly what.

## 4 · Watching a long run

State is written to `core/data/bootstrap-state.json` after every step and at least once a
second during one. From any other terminal:

```bash
python -m core.setup.bootstrap --watch
```

That file is why you can close the laptop lid on a six-hour backfill and still find out
what happened. Over SSH, run the build under `tmux`/`nohup` and `--watch` from wherever.
Piping to a file or a CI log switches automatically to one line per event (force with
`--plain`).

## 5 · Resuming, and when a step fails

Re-run the exact same command:

```bash
python -m core.setup.bootstrap --create-db
```

Steps whose table already holds rows are **skipped**, so a resume costs only the work that
didn't finish. Ctrl-C is safe.

```bash
python -m core.setup.bootstrap --force            # redo everything, ignore existing rows
python -m core.setup.bootstrap --only SEP SF1     # rebuild specific Sharadar tables
python -m core.setup.bootstrap --only-phase derived   # just rebuild the derived tables
```

### When a step fails

| Symptom | Cause | Fix |
|---|---|---|
| `no watermark / table empty — full backfill` | normal on a first run | nothing — that's the backfill starting |
| API `403` / `429` | key wrong, or your subscription lacks that table | check the key; confirm your Sharadar plan covers it |
| a single table exceeds the query-API cap | Sharadar restamped a huge day | `--only <TABLE>` re-runs just it |
| `connection refused` | Postgres not running | `cd core && docker compose up -d` |
| a step hangs for many minutes | lock contention | `the Database tab at /setup/database` |
| out of disk mid-build | the 2× headroom rule | free space, then re-run — it resumes |

**`unjam` is the first thing to try on a stall.** A hang is almost always Postgres lock
contention: the app rebuilding a derived table needs an exclusive lock, an
`idle in transaction` connection holds a read lock in front of it, and every reader queues
behind. `unjam` stops this project's jobs and terminates the jammed backends — narrowly
scoped, never touching other projects or its own connection.

```bash
the Database tab at /setup/database
the Database tab at /setup/database
```

## 6 · Confirm it worked

```bash
python -m core.setup.bootstrap --status   # tables, row counts, sizes
the Runs tab at /setup/runs          # latest load per dataset, from load_log
```

`--status` tells you rows *exist*, not that they are right. Numbers in finance look
plausible while being wrong, and a silently truncated table is indistinguishable from a
correct one until it quietly gives you the wrong answer — so treat row counts as a
liveness check, not a correctness one.

Then serve it:

```bash
uvicorn core.api.main:app --port 8001       # docs at http://localhost:8001/docs
curl 'http://localhost:8001/api/v1/screener/?limit=5'
```

---

## Keeping it current

`bootstrap` goes from nothing to a full database. Once you have one, the routine refresh
is incremental:

```bash
python -m core.setup.bootstrap           # only what changed
python -m core.setup.bootstrap --plan    # the step list, without running it
```

No table does a full re-download on a routine run. `update_all` derives its plan from the
same registry `bootstrap` builds from, so the two can't drift apart. Scheduling it:
[../DEPLOYMENT.md](../DEPLOYMENT.md#nightly-refresh).

## Adding a data source

The registry is the single source of truth, so adding a source is one entry plus one
loader — not an edit in four places.

1. Add a `Source` (if it's a new provider) and one or more `Dataset` entries to
   [`core/backend/sources.py`](../../core/backend/sources.py) — provider, endpoint,
   licence, credential, size, and the tables it writes.
2. Give it a runner in `_runner()` in
   [`core/setup/bootstrap.py`](../../core/setup/bootstrap.py), or reuse a phase that
   already has one (a new Sharadar table needs no code at all — the loader is
   schema-driven).
3. Regenerate the docs:

```bash
# docs/setup/sources.md was generated from the registry; the generator has been removed.
```

`bootstrap`, `update_all` and [sources.md](sources.md) all pick it up automatically. That
is the point of the registry: nothing can ingest from somewhere undocumented, and the
documentation can't describe something that doesn't run.

## Schema reference

Tables, keys, and the faithful-mirror conventions: [`docs/reference/schema.md`](../reference/schema.md).
