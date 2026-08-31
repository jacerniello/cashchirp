# Deployment

How to run this somewhere other than your laptop. The whole document turns on one number:
**the full dataset is ~47 GB**, and that single fact decides your architecture.

---

## Sizing — decide this first

The database dominates everything. Pick a tier before you pick a host.

Sizes below are summed from the data-source registry, whose per-dataset figures are
measured on a fully built instance — a full build measures 47 GB against the registry's
46.9 GB, so treat them as accurate rather than indicative.

| Tier | Build | DB size | Host | What works |
|---|---|---:|---|---|
| **Macro only** | `--only-phase schema fred` | ~2.2 GB | any 2 GB VPS | `/macro`. No equities. |
| **Screener** | `--only TICKERS SF1 DAILY` | ~9.7 GB | small VPS, 4 GB RAM | Screener, idea board, company fundamentals. **No backtests** (they need prices). |
| **Research** | `+ SEP` | ~19.2 GB | 8 GB RAM, SSD | Everything above **plus** the point-in-time backtest harness. **The recommended tier.** |
| **Full** | everything | ~46.9 GB | 16 GB RAM, home server or large VPS | Insider, institutional/13F, and ETF pages. Sharadar is 35 GB of it; the derived rebuilds add 8.9 GB. |

You can start at Screener and add `SEP` later — the loaders are incremental and
independent, and `bootstrap --only <TABLE>` / `--only-phase <PHASE>` builds a subset.
Per-dataset sizes and provenance: [setup/sources.md](setup/sources.md).

> **The 47 GB is the real constraint, and it is easy to under-plan.** A cheap VPS with a
> 25 GB disk cannot hold this dataset, and you will discover that four hours into a `SEP`
> load. Size the disk for **2× your tier** — Postgres needs headroom for index builds,
> vacuum, and the derived-table rebuilds, which write a full second copy before swapping it
> in. Fastest sane answer for the Full tier is usually a machine you already own with a
> large SSD, not rented cloud storage.

---

## Topology

Three processes. Only the first is stateful.

```
Postgres 16        the dataset                          port 5432, not public
FastAPI            core.api.main:app                    port 8001, behind the proxy
Next.js            web/                                 port 3000, behind the proxy
Nightly job        core.scripts.load.update_all              cron / launchd / systemd timer
```

The API is stateless and the frontend is stateless, so both scale trivially and neither
holds anything you'd be sad to lose. **All the value is in Postgres and in git** — the
research folder, the screens, and the watchlist are tracked; the 3.6 GB of downloaded
Sharadar files under `core/data/` are gitignored and regenerable.

A common and good split: put Postgres and the nightly job on a machine with the disk (a
home server works well), and run the API and frontend wherever is convenient, pointed at it
over a private network or tunnel. **Do not expose Postgres to the internet.**

---

## Deploying

### Database

```bash
cd core && docker compose up -d
cd .. && python -m core.scripts.setup.init_db
```

For production, override the compose defaults — `POSTGRES_PASSWORD=investing` is a
development convenience and nothing more. Bind the port to localhost only
(`127.0.0.1:5432:5432`) unless you're deliberately serving another host.

Then build it with `python -m core.scripts.setup.bootstrap --create-db` (see
[setup/database.md](setup/database.md) — it is resumable, and `--watch` follows a long run from
another terminal). Expect several hours for the Research tier and most of a day for Full.
Run `verify_sharadar` afterwards, always.

### API

```bash
pip install -r core/requirements.txt
uvicorn core.api.main:app --host 0.0.0.0 --port 8001 --workers 4
```

Behind nginx/Caddy on `/api/v1`. It is read-only over the database and holds an in-process
snapshot cache, so workers are independent and restarting is free.

### Frontend

The Next.js app in `web/` reads the API. See the root [README](../README.md) for its build
and run commands, and point it at the API's URL.

### Nightly refresh

One orchestrator does the whole update in the right order — each Sharadar table in its
correct **incremental** mode, then FRED and FINRA, then every derived table rebuilt once
the inputs are fresh. It exits non-zero if any step fails.

```bash
python -m core.scripts.load.update_all
```

**systemd timer** (Linux):

```ini
# /etc/systemd/system/investing-update.service
[Service]
Type=oneshot
WorkingDirectory=/srv/investing
ExecStart=/srv/investing/.venv/bin/python -m core.scripts.load.update_all
StandardOutput=append:/var/log/investing-update.log
StandardError=inherit
```
```ini
# /etc/systemd/system/investing-update.timer
[Timer]
OnCalendar=*-*-* 22:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

**macOS launchd:** `core/scripts/com.investing.sharadar.plist.example` — replace
`{{PROJECT_ROOT}}` and install as documented in the file's header. launchd does not expand
`~` or relative paths, and a wrong path fails *silently*: the job simply never runs.

Schedule it after Sharadar's EOD refresh (typically mid-evening US time). Because
`update_all` exits non-zero on failure, wrapping it in anything that alerts on non-zero
gives you monitoring for free — **and you want it**, because the failure mode of a broken
nightly job is not an error, it's a dashboard quietly showing last week's numbers.

**If a run hangs, `python -m core.scripts.ops.unjam` first.** A stall is almost always Postgres
lock contention — usually the API rebuilding a derived table while the ingest runs.

---

## Backups

Back up **Postgres** and **git**. Nothing else.

```bash
pg_dump -Fc investing > investing-$(date +%F).dump
```

A full dump of the Full tier is large and slow. The pragmatic position: the Sharadar data
is **re-downloadable** — your subscription is the backup. What is genuinely irreplaceable is
the small stuff, and it is all in git: `research/`, `config/screens/`, and your `.env`
values (stored wherever you keep secrets, *not* in git). If you're choosing where to spend
backup effort, spend it there. Consider dumping only `derived.*` and the derived tables if
rebuilding them from scratch is slower than restoring them.

---

## The degradation rule

**A page must degrade, not hang, when its data is absent.**

This is the design rule the deployment split has always been governed by, and it is worth
keeping whatever your topology. If a page calls an API that is unreachable — because that
tier isn't deployed, because the DB is mid-rebuild, because a load failed — the page must
say so. What you must never ship is **a spinner that never resolves**: a screen that hangs
is indistinguishable from a screen that's broken, and you will debug production for ten
minutes before remembering the data was never there.

So when adding a page, the question is **not** "does this touch the API?" but:

> **If every API call on this page fails, is the page still worth landing on?**

*Yes* → ship it, but make the failure **explicit and non-retrying** (an error branch that
renders a line like *"Price history unavailable right now"*), or you get the hanging
spinner by another route.
*No* → don't ship it in a tier that lacks its data. Gate the route and say which data is
missing, and name the route the visitor asked for — hiding the link from the nav is a
courtesy, not a mechanism, because a bookmark or a typed URL never goes through your navbar.

The general form, which applies well beyond this project:

> **Never let a true state (an empty page) imply a false one (a broken deploy).**
