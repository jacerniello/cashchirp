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

> **Size the disk generously, and measure rather than trust a number.** A full build runs
> to tens of GB, dominated by `SEP` and the 13F tables, and Postgres needs substantial
> headroom on top: index builds, vacuum, and the derived-table rebuilds, which write a
> full second copy before swapping it in. Run `bootstrap --status` on a build to see what
> your tables actually occupy — that reads `pg_total_relation_size`, so it is the only
> figure here that is measured rather than estimated. Running out of disk mid-`SEP` is the
> common way to lose an afternoon.

---

## Topology

Three processes. Only the first is stateful.

```
Postgres 16        the dataset                    port 5432, not public
FastAPI            core.api.main:app              port 8001, behind the proxy
Next.js            web/ (npm start)               port 3010, behind the proxy
Nightly refresh    a schedule in Setup            the API's own scheduler
```

The API is stateless and the frontend is stateless, so both scale trivially and neither
holds anything you'd be sad to lose. **All the value is in Postgres and in git** — the
the screens and the docs are tracked; the downloaded
Sharadar files under `core/data/` are gitignored and regenerable.

A common and good split: put Postgres and the nightly job on a machine with the disk (a
home server works well), and run the API and frontend wherever is convenient, pointed at it
over a private network or tunnel. **Do not expose Postgres to the internet.**

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
another terminal). Expect several hours for the Research tier and most of a day for Full.

### API

```bash
pip install -r core/requirements.txt
uvicorn core.api.main:app --host 0.0.0.0 --port 8001 --workers 4
```

Behind nginx/Caddy on `/api/v1`. It is read-only over the database and holds an in-process
snapshot cache, so workers are independent and restarting is free.

Leave `SETUP_ENABLED` unset here. It mounts the endpoints that start and stop ingests, and
[CONFIGURATION.md](CONFIGURATION.md#setup_enabled--the-build-control-surface) explains why
the default is off.

### Frontend

The Next.js app in `web/` reads the API. Production is a build step and a long-running
server, not `npm run dev`:

```bash
npm --prefix web ci --no-audit --no-fund   # NOT --omit=dev, see below
npm --prefix web run build
API_URL=http://127.0.0.1:8001 PORT=3010 npm --prefix web start
```

`API_URL` is read at runtime and points the app at the API. `PORT` picks the port the
server listens on — 3010 in the units below, to keep it clear of a dev server on 3000.

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

It pulls, then decides what to rebuild from **what the diff actually touched** — pip only
if `core/requirements*` changed, `npm ci` only if the lockfile moved, a frontend build only
for changes under `web/`, and a restart only of the service whose tree changed. Builds all
happen before any restart, so a build that fails leaves the previous version serving rather
than a half-updated site.

Then it verifies: it polls `/health` on the API and `/` on the web server for up to 30
seconds each, and on failure prints the last 25 journal lines from both units and exits
non-zero. Override the URLs with `API_HEALTH_URL` / `WEB_HEALTH_URL`, and the unit names
with `API_SERVICE` / `WEB_SERVICE`, if your names differ from the ones above.

Two refusals are deliberate. It **will not deploy over a dirty working tree** — a server
checkout should never have local edits, and if it does, someone edited in production and
should be told rather than overwritten. And if the pull changes `deploy.sh` itself, it
re-executes the new version rather than continuing: bash reads a script incrementally from
a byte offset, so carrying on would run a mix of the old and new file.

### Serving generated data instead

The public demo runs the same checkout against a small synthetic database — no licensed
data on a public host. `demo/generate_demo_data.py` writes a few hundred MB of seeded,
obviously-fake issuers, prices and fundamentals into an empty database, covering only the
tables the UI reads:

```bash
python demo/generate_demo_data.py --dsn postgresql://user:pw@host/demo --tickers 300
```

The site-wide banner in `web/src/config/banner.ts` says the figures are generated, and it
is **opt-out**: a deployment that sets nothing still shows it. Hide it on a machine serving
the real mirror with `NEXT_PUBLIC_BANNER_DISABLED=true` in `web/.env.local`. That direction
is deliberate — a demo silently presenting generated figures as real is the failure worth
guarding against; a redundant banner on your own box is not.

### Nightly refresh

One orchestrator does the whole update in the right order — each Sharadar table in its
correct **incremental** mode, then FRED and FINRA, then every derived table rebuilt once
the inputs are fresh. It exits non-zero if any step fails.

```bash
python -m core.setup.bootstrap
```

**systemd timer** (Linux):

```ini
# /etc/systemd/system/investing-update.service
[Service]
Type=oneshot
WorkingDirectory=/srv/investing
ExecStart=/srv/investing/.venv/bin/python -m core.setup.bootstrap
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

**Or use the app's own scheduler.** The API runs a daemon thread that fires schedules
stored in Postgres, editable at `/setup/schedules`. It needs no root and survives a
restart, but nothing fires while the API is stopped — which is the right trade for a tool
whose only control surface is that same API. Use a systemd timer instead when the ingest
must run on a box where the app itself is not kept up.

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

Back up **Postgres** and **git**. Nothing else.

```bash
pg_dump -Fc investing > investing-$(date +%F).dump
```

A full dump of the Full tier is large and slow. The pragmatic position: the Sharadar data
is **re-downloadable** — your subscription is the backup. What is genuinely irreplaceable is
the small stuff, and it is all in git: `config/screens/`, `docs/`, and your `.env`
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
