# Research and backtests

The screener finds candidates. This is where you judge them: notes and AI due diligence on
any stock, groups you define, screener results frozen as snapshots, a ranking of everything
you have rated, and backtests that say whether a screen would have worked.

---

## Tooling in the repo, research on your machine

Your research is **content**, not code, so it never goes into git. It lives as plain files
in the research folder — `RESEARCH_DIR` in `core/.env`, default `<repo>/research/`, which
`.gitignore` excludes. Only the tooling is versioned:

| In the repo (apparatus) | In the research folder (yours) |
|---|---|
| `core/backend/research/store.py` — reads and writes the folder | `stocks/<permaticker>/` — notes, DD, red team |
| `core/backend/research/guide/` — the DD and red-team standards, and the AI guide | `groups/<id>.json` — your categories |
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
    notes.md               your notes
    dd.json                due-diligence report (the DD standard)
    redteam.md             adversarial review of the DD
  groups/<id>.json         a named set of stocks, each with a note and who added it
  snapshots/<id>.json      a screener result frozen at a moment
  notes/**.md              anything not tied to one stock
  backtests/<id>/          report.json + CSVs from the backtest runner
```

Stocks are keyed by **permaticker**, never ticker — tickers get recycled.

`CLAUDE.md` and `_guide/` are copied from `core/backend/research/guide/` every time the API
starts. Edit the standards there, not in the copies.

## In the app

- **Research → Rankings** (`/research`) — every stock you have researched, ranked by its DD
  rating (1–6), with confidence, base-case upside, and which groups it is in.
- **A stock's research page** (`/research/stocks/<permaticker>`, also the *Research* tab on
  the company page) — your notes (Markdown), the DD report, the red team, and its groups.
- **Snapshots** — from the screener (*Snapshot results*) or a saved screen (*Snapshot this
  screen*). A snapshot keeps every matching stock with its metrics as of that day. Trim it
  (removed members are marked, not deleted, so a trim can be undone), add members to groups,
  download it as CSV.
- **Groups** — create as many as you like (a catalyst type, a thesis family, "watch",
  "bought"…), add stocks from a snapshot, a stock page or by ticker, and give each a note.
  You and the AI both edit them; each member records who added it.
- **Notes** — free-form Markdown, organised in folders.
- **Backtests** (`/backtests`) — run a saved screen through history and keep the report.

## Pointing Claude at it

There is no AI button in the app on purpose. Open Claude Code in the research folder and
say what you want:

```bash
cd ~/projects/cashchirp/research    # on the homelab; or wherever RESEARCH_DIR points
claude
```

> Do a full DD on every stock in snapshot `20261104-1305-mid-cheap`, then red-team the ones
> you rate 5 or 6.

> Group the members of that snapshot by why they are cheap. Reuse existing groups where they fit.

> Trim snapshot X to companies with net cash and positive FCF in each of the last 3 years.

The folder's `CLAUDE.md` tells the agent the layout, the file formats, the DD standard
(`_guide/DD_STANDARD.md`: a 24-item checklist, a 1–6 rating, every claim sourced), the
red-team standard, and where to get data — the app's API, Postgres, SEC EDGAR, the web.
What it writes shows up on the site immediately; the research pages show a ready-to-paste
instruction for each stock, group and snapshot.

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
