# Deployment

How to run this somewhere other than your laptop.

---

## Decide what to build first

The database dominates the hosting decision, so settle its scope before picking a host.
You do not have to load everything:

| Build | What works |
|---|---|
| `--only-phase schema fred` | `/macro` only. No equities, and nothing paid. |
| `--only TICKERS SF1 DAILY` | Screener, idea board, company fundamentals. No price history or charts. |
| `+ SEP` | The above plus prices: charts and historical analysis. |
| everything | Adds insider, institutional/13F and ETF pages. |

The tables are incremental and independent, so you can start narrow and add `SEP` or the
13F tables later without rebuilding.

> **Size the disk from a measurement, not an estimate.** A full build runs to tens of GB,
> dominated by `SEP` and the 13F tables, and Postgres needs headroom on top for index
> builds, vacuum, and the derived-table rebuilds, which write a second copy before
> swapping it in. `bootstrap --status` reports what the tables actually occupy via
> `pg_total_relation_size`; it is the only measured figure available. Running out of disk
> part-way through `SEP` means restarting that step.

---

## Topology

Three processes. Only the first is stateful.

```
Postgres 16        the dataset                    port 5432, not public
FastAPI            core.api.main:app              port 8001, behind the proxy
Next.js            web/ (npm start)               port 3010, behind the proxy
Nightly refresh    a schedule in Setup, or a      the API's own scheduler (only with
                   systemd timer                  SETUP_ENABLED=true), or the timer
```

The API and the frontend are both stateless, so they scale independently and hold nothing
that needs backing up. The state is in Postgres and in git: the screens and the docs are
tracked, and the downloaded Sharadar files under `core/data/` are gitignored and can be
re-fetched.

One workable split is to put Postgres and the refresh job on a machine with the disk (a
home server does fine) and run the API and frontend wherever is convenient, pointed at it
over a private network or tunnel. Do not expose Postgres to the internet.

---

## Deploying

### Database

```bash
cd core && docker compose up -d
cd .. && python -m core.setup.bootstrap --only-phase schema
```

For production, override the compose defaults — `POSTGRES_PASSWORD=investing` is a
development convenience and nothing more. Bind the port to localhost only
(`127.0.0.1:5432:5432`) unless you're deliberately serving another host.

Then build it with `python -m core.setup.bootstrap --create-db` (see
[setup/database.md](setup/database.md) — it is resumable, and `--watch` follows a long run from
another terminal). Expect several hours for a partial build and most of a day for a full one.

### API

```bash
pip install -r core/requirements.txt
uvicorn core.api.main:app --host 0.0.0.0 --port 8001 --workers 4
```

Behind nginx/Caddy on `/api/v1`. It reads the database, with one exception: when
`screener_snapshot` is older than the latest `daily` date, the first screener request
rebuilds and persists it (and still serves if the write fails). It holds an in-process
snapshot cache, so workers are independent and restarting is free. Research reports and
saved screens are files the API writes under `RESEARCH_DIR` and `config/screens/`, so those
live on the API's machine.

Leave `SETUP_ENABLED` unset here. It mounts the endpoints that start and stop ingests, and
[CONFIGURATION.md](CONFIGURATION.md#setup_enabled--the-build-control-surface) explains why
the default is off.

### Frontend

The Next.js app in `web/` reads the API. Production is a build step and a long-running
server, not `npm run dev`:

```bash
npm --prefix web ci --no-audit --no-fund   # NOT --omit=dev, see below
API_URL=http://127.0.0.1:8001 npm --prefix web run build
API_URL=http://127.0.0.1:8001 PORT=3010 npm --prefix web start
```

`API_URL` points the app at the API, and it is needed at **build** time as well as at
start. The browser's `/api/v1` proxy (the rewrite in `web/next.config.ts`) is resolved by
`npm run build` and written into `.next/routes-manifest.json`; only the server-side
requests read `API_URL` when the app starts. So set it for both commands, and rebuild
after changing it. If it is unset, both fall back to `http://127.0.0.1:8001`. `PORT` picks
the port the server listens on — 3010 in the units below, to keep it clear of a dev server
on 3000.

> **Do not `npm ci --omit=dev`.** `typescript`, `tailwindcss` and `@tailwindcss/postcss`
> are devDependencies and the build needs all three. Omitting them breaks `next build` and
> leaves `next.config.ts` unreadable at startup — a failure that looks like a code problem
> and isn't.

### Services

Two units, both running as an unprivileged user that owns the checkout:

```ini
# /etc/systemd/system/cashchirp-api.service
[Unit]
Description=cashchirp API
After=network.target postgresql.service

[Service]
User=cashchirp
WorkingDirectory=/opt/cashchirp
ExecStart=/opt/cashchirp/.venv/bin/uvicorn core.api.main:app --host 127.0.0.1 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
```ini
# /etc/systemd/system/cashchirp-web.service
[Unit]
Description=cashchirp web
After=network.target cashchirp-api.service

[Service]
User=cashchirp
WorkingDirectory=/opt/cashchirp/web
Environment=API_URL=http://127.0.0.1:8001
Environment=PORT=3010
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Both bind to localhost; the reverse proxy is what faces the internet. Enable with
`systemctl enable --now cashchirp-api cashchirp-web`.

### Deploying updates

`deploy.sh` is the update path once the above is running. From the checkout on the server:

```bash
sudo ./deploy.sh             # pull, rebuild what the diff touched, restart, verify
sudo ./deploy.sh --force     # rebuild and restart everything, even with no new commits
sudo ./deploy.sh --dry-run   # say what would happen, change nothing
```

It pulls, then decides what to rebuild from what the diff touched: pip only if
`core/requirements*` changed, `npm ci` only if the lockfile moved, a frontend build only
for changes under `web/`, and a restart only of the service whose tree changed. Builds run
before any restart, so a failed build leaves the previous version serving rather than a
half-updated site.

Then it verifies: it polls `/health` on the API and `/` on the web server for up to 30
seconds each, and on failure prints the last 25 journal lines from both units and exits
non-zero. Override the URLs with `API_HEALTH_URL` / `WEB_HEALTH_URL`, and the unit names
with `API_SERVICE` / `WEB_SERVICE`, if your names differ from the ones above.

Two refusals are intentional. It will not deploy over a dirty working tree: a server
checkout should have no local edits, and if it does, someone changed something in
production and should be told rather than overwritten. And if the pull changes `deploy.sh`
itself, it re-executes the new version rather than continuing — bash reads a script
incrementally from a byte offset, so carrying on would run a mix of the old and new file.

### Serving generated data instead

The public demo runs the same checkout against a small synthetic database — no licensed
data on a public host. `demo/generate_demo_data.py` writes a few hundred MB of seeded,
obviously-fake issuers, prices and fundamentals into an empty database, covering only the
tables the UI reads:

```bash
python demo/generate_demo_data.py --dsn postgresql://user:pw@host/demo --tickers 300
```

The site-wide banner in `web/src/config/banner.ts` says the figures are generated. It is
opt-out: a deployment that sets nothing still shows it. Hide it on a machine serving the
real mirror with `NEXT_PUBLIC_BANNER_DISABLED=true` in `web/.env.local`. The default runs
that way round because a demo presenting generated figures as real is the more damaging
error; a redundant banner on your own machine is not.

### Nightly refresh

One orchestrator does the whole update in the right order — each Sharadar table in its
correct **incremental** mode, then FRED, FINRA and the SEC fund map, then every derived
table rebuilt once the inputs are fresh. It exits non-zero if any step fails.

```bash
python -m core.setup.bootstrap --force
```

`--force` is required. Without it bootstrap resumes a build: every step whose table already
holds rows is skipped, so a nightly run would do nothing. The app's scheduled update jobs
pass `--force` for the same reason.

**systemd timer** (Linux):

```ini
# /etc/systemd/system/cashchirp-update.service
[Service]
Type=oneshot
User=cashchirp
WorkingDirectory=/opt/cashchirp
ExecStart=/opt/cashchirp/.venv/bin/python -m core.setup.bootstrap --force
StandardOutput=append:/var/log/cashchirp-update.log
StandardError=inherit
```
```ini
# /etc/systemd/system/cashchirp-update.timer
[Timer]
OnCalendar=*-*-* 22:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

**Or use the app's own scheduler.** The API runs a daemon thread that fires schedules
stored in Postgres, editable at `/setup/schedules` (interval, daily, weekly or monthly).
It needs no root and survives a restart, but nothing fires while the API is stopped —
which is the right trade for a tool whose only control surface is that same API. The
scheduler starts only when `SETUP_ENABLED=true`, so it belongs on a private API instance,
not a public one. Use a systemd timer instead when the ingest must run on a box where the
app itself is not kept up, or where setup is disabled.

Whichever you pick, use one: two schedulers pointed at the same database will overlap.

Schedule it after Sharadar's EOD refresh (typically mid-evening US time). `bootstrap`
exits non-zero on failure, so wrapping it in anything that alerts on non-zero gives you
monitoring. Worth doing: a broken nightly job does not raise an error, it serves last
week's numbers.

**If a run hangs, check the Database tab at `/setup/database` first.** A stall is almost
always Postgres lock contention — usually the API rebuilding a derived table while the
ingest runs.

---

## Backups

Back up **Postgres**, **git**, and the **research folder**.

```bash
pg_dump -Fc investing > investing-$(date +%F).dump
```

A full dump is large and slow. The Sharadar data is re-downloadable, so the subscription
is effectively its backup. What cannot be re-fetched is small and mostly in git:
`config/screens/`, `docs/`, and your `.env` values (kept wherever you store secrets, not in
git). If rebuilding the derived tables takes longer than restoring them, dump those
selectively.

The research folder (`RESEARCH_DIR`, default `<repo>/research/`) is the one thing here that
exists nowhere else: your reports (with their per-stock DD, red teams and notes), snapshots
and backtest reports are plain files, deliberately kept out of git and out of Postgres. Copy it somewhere off the machine on
a schedule (`rsync`/`tar` it, or make the folder its own private git repo). Deploys never
touch it — `deploy.sh` only updates tracked files.

---

## The degradation rule

**A page must degrade, not hang, when its data is absent.**

This matters more once the deployment is split, because a page can now be missing its data
for reasons that are not bugs: that tier was not deployed, the database is mid-rebuild, a
load failed. In each case the page should say so. A spinner that never resolves is
indistinguishable from a broken deploy, which makes it expensive to diagnose.

The test when adding a page is: if every API call on it fails, is the page still worth
landing on?

If yes, ship it with an explicit, non-retrying error branch — a line such as "Price history
unavailable right now" — otherwise the hanging spinner returns by another route.

If no, don't ship it in a tier that lacks its data. Gate the route, name the route the
visitor asked for, and say which data is missing. Hiding the link from the nav is not
sufficient: a bookmark or a typed URL never passes through the navbar.

The general form:

> Never let a true state (an empty page) imply a false one (a broken deploy).
