# Research and backtests

The screener finds candidates. This is where you judge them: screener results frozen as
snapshots, **reports** — dated analysis runs with an AI due diligence (and red team) per
stock, their own ranking and their own notes — and backtests that say whether a screen
would have worked. Reports are how research is organised: there are no separate groups or
free-standing notes.

## The model

| Thing | What it is | Where | Changes? |
|---|---|---|---|
| **Idea** (saved screen) | settings only — the criteria | `config/screens/<id>.yaml` (repo) | you edit it |
| **Snapshot** | what an idea or filter caught at a moment | `snapshots/<id>.json` | trimmable (undoable) |
| **Report** | an analysis run built at a particular time: a set of stocks (usually a snapshot's), a DD + optional red team per stock *as of that report*, and its own ranking | `reports/<id>/` | expanded and completed over time; never overwritten — re-analysing later is a new report |
| **Notes** | Markdown that belongs to a report: the report's own (`notes/**.md`) or one stock's within it | `reports/<id>/notes/`, `reports/<id>/stocks/<permaticker>/notes.md` | edited freely |

A stock's rating over time is derived, not stored: its research page lists every report that
analysed it, newest first.

---

## Tooling in the repo, research on your machine

Your research is **content**, not code, so it never goes into git. It lives as plain files
in the research folder — `RESEARCH_DIR` in `core/.env`, default `<repo>/research/`, which
`.gitignore` excludes. Only the tooling is versioned:

| In the repo (apparatus) | In the research folder (yours) |
|---|---|
| `core/backend/research/store.py` — reads and writes the folder | `reports/<id>/` — analysis runs: DD + red team per stock, and notes |
| `core/backend/research/guide/` — the DD and red-team standards, and the AI guide (`AGENT_GUIDE.md`, copied in as `CLAUDE.md`) | `snapshots/<id>.json` — frozen screener results |
| `core/api/routers/research/` — the API | |
| `web/src/app/research/`, `web/src/app/backtests/` — the pages | |
| `core/backend/backtest/` — the backtest harness and runner | `backtests/<id>/` — backtest reports |

Plain files mean three things. You can read and edit them with any editor. An AI agent can
work on them directly. And they are as durable as the disk they sit on, so **back the
folder up** — it is not in git and not in Postgres. To keep it somewhere else, or in its own
private repo, point `RESEARCH_DIR` there.

## The folder

```
research/
  CLAUDE.md                the guide an AI agent reads (generated — see below)
  _guide/                  DD_STANDARD.md · REDTEAM.md · dd_template.json (generated)
  reports/<id>/            one analysis run — id YYYYMMDD-HHMM-<slug>
    report.json            name, thesis, created_at, status (open|complete), source, members
    notes/**.md            the report's notes (other files may sit beside them)
    stocks/<permaticker>/
      dd.json              due-diligence report for this run (the DD standard)
      redteam.md           adversarial review of that DD
      notes.md             notes on this stock in this run
  snapshots/<id>.json      a screener result frozen at a moment
  stocks/<permaticker>/    meta.json (ticker, name) left from earlier layouts — nothing new goes here
  backtests/<id>/          report.json + CSVs from the backtest runner
```

Stocks are keyed by **permaticker**, never ticker — tickers get recycled.

`CLAUDE.md` and `_guide/` are copied from `core/backend/research/guide/` every time the API
starts. Edit the standards there, not in the copies.

## In the app

- **Research** (`/research`) — every report, newest first: source (snapshot → idea, or
  hand-picked), status, analysed/total, top names. Start one from a snapshot or empty. A
  report's page is its **ranking** (rating, confidence, base upside, price at analysis →
  now, red team), the members not yet analysed, **Expand** (add the rest of the source
  snapshot's kept members, or any stock by ticker), the report's **Notes** (Markdown, in
  folders; `?note=<path>` links one), and a copyable instruction for Claude to complete it.
  Each member has its own page in the report, `/research/reports/<id>/stocks/<permaticker>`,
  with that run's DD, red team and notes on the stock.
- **A stock's research page** (`/research/stocks/<permaticker>`, also the *Research* tab on
  the company page) — the stock across reports: the latest DD and red team (with the report
  and date they came from), the analysis history (its rating over time), the reports holding
  notes on it, and its snapshots.
- **Screener → Snapshots** (`/screener/snapshots`) — made from the Filter tab (*Snapshot*)
  or a saved screen (*Take snapshot now*). A snapshot keeps every matching stock with its
  metrics as of that day. Trim it (removed members are marked, not deleted, so a trim can be
  undone), download it as CSV, and **start a report** on all kept
  members or the selected rows.
- **Screener → Saved screens** (`/screener/ideas`) — a saved screen is settings, not
  results: its page shows the definition (criteria, gates, today's match count) and the
  snapshots, reports and backtests made from it, with actions to take a snapshot, backtest it, or
  load it into the filter grid.
- **Backtests** (`/backtests`) — run a saved screen through history and keep the report.

## Pointing Claude at it

There is no AI button in the app on purpose. Open Claude Code in the research folder and
say what you want:

```bash
cd ~/projects/cashchirp/research    # on the homelab; or wherever RESEARCH_DIR points
claude
```

> Complete report `20261104-1310-mid-cheap`: write a DD for every member without one, then
> red-team the ones rated 5–6.

> Start a report on snapshot `20261104-1305-mid-cheap` and do a full DD on every kept member.

> Sort the members of report `20261104-1310-mid-cheap` by why they are cheap, and write it up in
> that report's `notes/why-cheap.md`.

> Trim snapshot X to companies with net cash and positive FCF in each of the last 3 years.

The folder's `CLAUDE.md` tells the agent the layout, the file formats, the DD standard
(`_guide/DD_STANDARD.md`: a 24-item checklist, a 1–6 rating, every claim sourced), the
red-team standard, and where to get data — the app's API, Postgres, SEC EDGAR, the web.
Every analysis goes in a report and is never rewritten by later work — refreshing a view of
a stock means a new report. What it writes shows up on the site immediately; the research
pages show a ready-to-paste instruction for each report, stock and snapshot.

Research written before reports held everything — DDs, red teams and notes in
`stocks/<permaticker>/`, and the old free-standing `notes/` folder (Markdown and any other
files in it, subfolders kept) — is moved into a report called *Recovered research* when the
API starts; a file that would overwrite one already there is left in place and logged. An
old `groups/` folder is left untouched on disk; the app no longer reads it.

The agent runs on your own Claude subscription, wherever you start it. On the homelab,
Claude Code is already installed and logged in.

## Backtests

A backtest re-runs a saved screen at past dates using **only what was knowable then**, and
measures what happened next. Run one from the Backtests page, or from a shell:

```bash
.venv/bin/python -m core.backend.backtest.run --screen quality-value --kind portfolio \
  --start 2015-01-01 --end 2024-12-31 --rebalance 12 [--hold-months 24] [--benchmark SPY] \
  [--cost-bps 30] [--min-price 3] [--min-adv 1e6] [--min-names 5] [--name "..."]
```

- **portfolio** — at each rebalance, buy every name that passes, equal weight, hold to the
  next rebalance (marked monthly). Compared against the benchmark (SPY, total return) and an
  equal-weight **universe**: the screen's sector/size rules without its quality/value gates,
  which is the fairer baseline — it separates "the gates added something" from "small caps
  did well".
- **cohort** — each passing name's own forward return over `--hold-months`, with the share
  that doubled or halved.

How it stays honest (`core/backend/backtest/harness.py`):
- **No look-ahead** — fundamentals are the latest filing on or before the date (`datekey`,
  at most 18 months old); valuation comes from `daily` within 21 days of it.
- **No survivorship bias** — the universe ignores today's delisted flag, and a name that
  stops trading is valued at its last trade.
- **Sanity bounds** — implausible returns, empty periods and thin baskets go into the
  report's `warnings` (shown at the top of the report), never silently through.

Each run writes `backtests/<id>/report.json` plus `periods.csv` and `holdings.csv` to the
research folder, appears in **Setup → Runs**, and is listed on the Backtests page with the
equity curve, per-period returns and holdings.

Known limits: drawdown and volatility are measured on month-end marks, so intra-month drops
are understated. For an out-of-sample test, use the screen studies below, which fix a
discovery and a holdout period.

## Screen studies — does a screen remove losers and keep winners?

A backtest says whether a screen's basket made money. A **screen study** asks the sharper
question, gate by gate: of the stocks that went on to be winners and losers, how many does
each gate keep and how many does it throw away?

```bash
# the cached point-in-time panel is built on first use (a few minutes), then reused
.venv/bin/python -m core.backend.backtest.run --kind gate-audit   --screen quality-value [--periods discovery,holdout]
.venv/bin/python -m core.backend.backtest.run --kind signal-study --screen quality-value [--periods discovery]
.venv/bin/python -m core.backend.backtest.run --kind compare \
    --screens quality-value,quality-value-v2 [--with-backtests]
# add --rebuild-panel after new data is loaded or the panel code changes
```

**The objective**, stated at the top of every study report. At each 1 January from 2003
to 2022, within the screen's universe (its sector/industry exclusions and market-cap band,
the backtest's tradability floor):

| Labels | Winner | Loser |
|---|---|---|
| **Primary** (gates are chosen on these) | top 20% of forward 24-month total return *among that date's universe* | bottom 20%, or stopped trading at a loss within the window |
| Secondary (checked, not optimised) | forward 24m ≥ +50% (≈ 22%/yr) | ≤ −30%, or stopped trading at a loss |
| 12-month | top 20% of forward 12m | bottom 20% of forward 12m |
| Tails (reported only) | doubled (≥ +100%) | busted (≤ −50%) |

The primary labels are relative so they mean the same thing in 2003 (median name +59% over
24 months) and in 2007 (median −35%).

**The protocol.** *Discovery* = rebalance dates 2003–2012 (forward windows end by 2014);
*holdout* = 2015–2022 (windows to 2024); 2013–14 is a gap so the two never share a month.
Choose signals, thresholds and gates on discovery only; look at the holdout **once**, for
the final screens, and keep the result whatever it is. Thresholds come from a small grid
declared in code before any result is seen (`SWEEPS` in `study/analysis.py`), not from optimisation.

**Reading the numbers** — each report has a *Labels* switch (primary / absolute / 12-month):

- **Winner retention** — share of the universe's winners the screen (or gate) keeps.
- **Loser removal** — share of the universe's losers it removes.
- **Edge** = winner retention − loser retention. A gate that keeps a random 30% keeps 30% of
  winners and 30% of losers: edge 0, whatever its size. Positive = it keeps winners
  preferentially. Edge rewards breadth, so compare a narrow screen on the next two lines.
- **Winners / losers among kept** vs the universe's rate (≈ 20% / 20% under primary labels).
- **Excess (by date)** — mean over dates of the kept set's median forward 24m return minus
  the universe's. Pooled medians overweight the years with many passers; this does not.
  *Years beating* is how often that difference was positive.

**gate-audit** — for every gate (market cap excepted: it defines the universe) and every
growth rule: **alone** (the gate by itself on the universe), **let back in** (what the full
screen minus this gate admits that the full screen does not — mostly winners means the gate
hurts; mostly losers means it earns its place), and a **threshold sweep** on the declared
grid, alone and inside the screen. Discovery and holdout side by side; the holdout column
is descriptive — never use it to pick.

**signal-study** — every candidate signal in quintiles formed within each date: median and
mean forward return, winner / loser / doubled / busted rates per quintile, the null bucket,
coverage, the Spearman correlation of (winner − loser rate) with the quintile (±1 =
monotonic), and how many years the good extreme beat the bad one. Prefer signals that are
monotonic, agree with their economic prior and hold most years. Coverage limits of the
data itself: insider trades (`sf2`) start in 2008, so insider signals cover only the
2009–2012 discovery dates; 13F holders (`sf3a`, from mid-2013) and FINRA short interest
(from end-2017) do not exist in the discovery period and are not studied.

**compare** — the selection metrics per screen and period, plus (`--with-backtests`) the
ordinary portfolio and cohort backtests of each screen over the holdout (2015–2024) and
the full range (2003–2024), each saved as its own report and linked.

The panel (`core/backend/backtest/study/panel.py`) is cached at
`core/data/panels/panel-v<N>-….parquet` (gitignored): `harness.build_panel` at each date —
so every gate sees exactly the value the backtest saw — plus the extra signals and forward
12/24-month returns from the backtest's own entry/exit logic (one ticker series per name;
names that stop trading valued at their last print). Studies over it take seconds. Reports
land in `backtests/<id>/` like any backtest, with `report.json` and CSVs (`gates.csv`,
`sensitivity.csv`, `signals.csv`, `quintiles.csv`, `comparison.csv`), and render on
`/backtests/<id>`.

Caveat: yearly dates with 24-month windows overlap, so the observations are not
independent — read differences as sizes, not as significance.
