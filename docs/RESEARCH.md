# Research and backtests

The screener finds candidates. This is where you judge them: screener results frozen as
snapshots, **reports** — dated analysis runs with an AI due diligence (and red team) per
stock — notes, groups you define, a ranking of the latest view of everything you have
analysed, and backtests that say whether a screen would have worked.

## The model

| Thing | What it is | Where | Changes? |
|---|---|---|---|
| **Idea** (saved screen) | settings only — the criteria | `config/screens/<id>.yaml` (repo) | you edit it |
| **Snapshot** | what an idea or filter caught at a moment | `snapshots/<id>.json` | trimmable (undoable) |
| **Report** | an analysis run built at a particular time: a set of stocks (usually a snapshot's), a DD + optional red team per stock *as of that report*, and its own ranking | `reports/<id>/` | expanded and completed over time; never overwritten — re-analysing later is a new report |
| **Stock notes** | your living notes on a stock | `stocks/<permaticker>/notes.md` | edited freely |
| **Group** | a living category of stocks | `groups/<id>.json` | edited; every change kept in a change log |

**Rankings** is derived, not stored: each stock's *latest* analysis across all reports.

---

## Tooling in the repo, research on your machine

Your research is **content**, not code, so it never goes into git. It lives as plain files
in the research folder — `RESEARCH_DIR` in `core/.env`, default `<repo>/research/`, which
`.gitignore` excludes. Only the tooling is versioned:

| In the repo (apparatus) | In the research folder (yours) |
|---|---|
| `core/backend/research/store.py` — reads and writes the folder | `stocks/<permaticker>/` — your notes |
| | `reports/<id>/` — analysis runs: DD + red team per stock |
| `core/backend/research/guide/` — the DD and red-team standards, and the AI guide (`AGENT_GUIDE.md`, copied in as `CLAUDE.md`) | `groups/<id>.json` — your categories |
| `core/api/routers/research/` — the API | `snapshots/<id>.json` — frozen screener results |
| `web/src/app/research/`, `web/src/app/backtests/` — the pages | `notes/**.md` — free-form notes |
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
  stocks/<permaticker>/
    meta.json              ticker, name, timestamps
    notes.md               your notes (living)
  reports/<id>/            one analysis run — id YYYYMMDD-HHMM-<slug>
    report.json            name, thesis, created_at, status (open|complete), source, members
    stocks/<permaticker>/
      dd.json              due-diligence report for this run (the DD standard)
      redteam.md           adversarial review of that DD
  groups/<id>.json         a named set of stocks, each with a note and who added it, + history
  snapshots/<id>.json      a screener result frozen at a moment
  notes/**.md              anything not tied to one stock
  backtests/<id>/          report.json + CSVs from the backtest runner
```

Stocks are keyed by **permaticker**, never ticker — tickers get recycled.

`CLAUDE.md` and `_guide/` are copied from `core/backend/research/guide/` every time the API
starts. Edit the standards there, not in the copies.

## In the app

- **Research → Reports** (`/research/reports`) — every analysis run, newest first: source
  (snapshot → idea, or group), status, analysed/total, top names. Start one from a snapshot,
  a group, or empty. A report's page is its **ranking** (rating, confidence, base upside,
  price at analysis → now, red team, groups), the members not yet analysed, **Expand** (add
  the rest of the source snapshot's kept members, or any stock by ticker), and a copyable
  instruction for Claude to complete it. Each member's analysis has its own page,
  `/research/reports/<id>/stocks/<permaticker>`.
- **Research → Rankings** (`/research`) — the **latest** analysis of every stock across all
  reports (by the DD's `asof`): rating, the change from the previous analysis (↑/↓), the
  report and date it came from, price then → now, and a *stale* badge when the analysis is
  over 90 days old or the price has moved more than 20% since. Stocks with only notes are
  listed unrated.
- **A stock's research page** (`/research/stocks/<permaticker>`, also the *Research* tab on
  the company page) — your notes (Markdown), the latest DD and red team (with the report and
  date they came from), the analysis history, its groups and snapshots.
- **Screener → Snapshots** (`/screener/snapshots`) — made from the Filter tab (*Snapshot*)
  or a saved screen (*Take snapshot now*). A snapshot keeps every matching stock with its
  metrics as of that day. Trim it (removed members are marked, not deleted, so a trim can be
  undone), add members to groups, download it as CSV, and **start a report** on all kept
  members or the selected rows.
- **Screener → Saved screens** (`/screener/ideas`) — a saved screen is settings, not
  results: its page shows the definition (criteria, gates, today's match count) and the
  snapshots, reports and backtests made from it, with actions to take a snapshot, backtest it, or
  load it into the filter grid.
- **Research → Groups** — create as many as you like (a catalyst type, a thesis family, "watch",
  "bought"…), add stocks from a snapshot, a stock page or by ticker, and give each a note.
  You and the AI both edit them; each member records who added it, and the group page shows
  the change log (adds, removes, renames).
- **Research → Notes** — free-form Markdown, organised in folders.
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

> Group the members of that snapshot by why they are cheap. Reuse existing groups where they fit.

> Trim snapshot X to companies with net cash and positive FCF in each of the last 3 years.

The folder's `CLAUDE.md` tells the agent the layout, the file formats, the DD standard
(`_guide/DD_STANDARD.md`: a 24-item checklist, a 1–6 rating, every claim sourced), the
red-team standard, and where to get data — the app's API, Postgres, SEC EDGAR, the web.
Every analysis goes in a report and is never rewritten by later work — refreshing a view of
a stock means a new report. What it writes shows up on the site immediately; the research
pages show a ready-to-paste instruction for each report, stock, group and snapshot.

DDs written before reports existed (in `stocks/<permaticker>/`) are moved, once, into a
report called *Recovered research* when the API starts; a file that would overwrite one
already there is left in place and logged.

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
are understated, and there is no out-of-sample split yet — fit a screen on one period and
judge it on another by running the two ranges separately.
