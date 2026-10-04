# Research folder — guide for AI agents

You are in the **research folder** of cashchirp, a screening tool over a local mirror of US
equity fundamentals, prices and filings (Sharadar) plus FRED macro data. This folder holds
the owner's research: reports (dated analysis runs holding AI due-diligence, red-team
reviews and notes), frozen screener results, and backtest reports. Reports are how stocks —
and notes — are organised. The cashchirp web app reads these same files live, so whatever you write here
shows up on the site immediately.

> Generated from the repo (`core/backend/research/guide/AGENT_GUIDE.md`) and refreshed when the
> app starts. Do not edit this copy; it will be overwritten.

## Delegation rule

**Only the top-level session may spawn subagents. A subagent must never spawn its own
subagents** — no nested delegation, at any depth. If you were launched as a subagent (you
were given a delegated task by another agent rather than by the owner), do the work
yourself; if it is too large, finish what you can and report back what is left so the
top-level session can delegate the rest. When you are the top-level session and delegate,
include this rule in every subagent's instructions.

## Layout

```
reports/<id>/              one analysis RUN, built at a particular time
  report.json              name, thesis, source, status, members, a short `notes` summary
  notes/**.md              the report's notes — thesis work, findings, experiments, logs
                           (data files and scripts may sit beside them)
  stocks/<permaticker>/    one stock in this run — keyed by permaticker, NEVER ticker
    dd.json                the DD for this run (format: _guide/DD_STANDARD.md)
    redteam.md             adversarial review of that dd.json (format: _guide/REDTEAM.md)
    notes.md               notes on this stock in this run — the OWNER's unless you were asked
snapshots/<id>.json        a screener result frozen at a moment, trimmable
stocks/<permaticker>/      meta.json only (ticker/name) — left from earlier layouts; write nothing here
backtests/<id>/            backtest reports (report.json + CSVs) — written by the runner, read-only
_guide/                    DD_STANDARD.md, REDTEAM.md, dd_template.json — the standards
```

Tickers get recycled across companies, so a stock is always identified by its
**permaticker** (an integer). If you only have a ticker, look the permaticker up (see
"Getting data") before creating anything.

### The model

| Thing | What it is | Changes? |
|---|---|---|
| Idea (saved screen) | settings only — `config/screens/<id>.yaml` in the app repo | edited by the owner |
| Snapshot | what an idea/filter caught at a moment | trimmed (members marked `removed`) |
| **Report** | an analysis run: a set of stocks, a DD (+ optional red team) per stock done *as of that report*, and its own ranking | expanded and completed over time; **its analyses are never rewritten by later work** |
| Notes | Markdown in a report: report-level (`notes/**.md`) or per stock (`stocks/<pt>/notes.md`) | edited freely; the owner's notes are theirs |

**Reports are how stocks are organised** — there is no separate category file and no notes
folder outside reports. A report is a named set of stocks with its own ranking and notes; a
stock's page on the site lists every report that analysed it (newest first) and every report
with notes on it, so a fresh view of a stock is simply a newer report, and the old one stays
as the record of what was thought then. Earlier free-standing notes were moved into the
"Recovered research" report (`reports/*-recovered-research/`).

## The report workflow

1. **Every analysis lives in a report.** When asked to do DD on a snapshot or some stocks,
   first find or create the report for that run:
   - If the owner names a report (`Complete report <id>`), work in it.
   - Otherwise create one — `POST /research/reports` with `{name, thesis?, snapshot_id? |
     members?}` (members default to the snapshot's kept members), or write `reports/<id>/report.json` yourself (format below). Ids are
     `YYYYMMDD-HHMM-<slug>`.
2. **Write each analysis inside it:** `reports/<id>/stocks/<permaticker>/dd.json`, then
   `redteam.md` where asked. Add the stock to `members` if it is not there already.
3. **Never rewrite another report's analyses**, except to fix a factual error in them (say so
   in the file). The point of a report is a record of what was known and concluded *then*.
4. **Refreshing = a new report.** "Update the DD on X" means a new report (or the open one the
   owner names) with a new DD — carry forward what still holds from the previous analysis,
   but write it fresh, with today's `asof` and price. Read the previous DD and red team first
   (the latest is the one with the newest `asof` across `reports/*/stocks/<pt>/dd.json`).
5. When every member has a DD (and the red teams asked for are done), set `"status":
   "complete"`. A complete report can still be expanded later.

## What the owner will ask you to do

- **"Complete report <id>"** — write a DD for every member of `reports/<id>/report.json` that
  has no `reports/<id>/stocks/<pt>/dd.json`, then red-team the ones the owner asks for
  (usually those rated 5–6).
- **"Do DD on <stock | snapshot>"** — start a report for the run (see the workflow
  above) and follow `_guide/DD_STANDARD.md` for each member. For a snapshot skip members it
  marks `"removed": true`.
- **"Red-team <stock | the 5–6s in X>"** — follow `_guide/REDTEAM.md`, writing `redteam.md`
  next to the `dd.json` it attacks, in the same report.
- **"Categorise these" / "sort snapshot X by theme"** — do it inside reports, not in a new
  kind of file. Either write the categorisation into the report itself (its `notes` summary,
  or a note under `reports/<id>/notes/`), or, when the owner wants each
  theme tracked on its own, create one report per theme (catalyst type, sector theme, thesis
  family…) with the matching members and a `thesis` that says what binds them. Read
  `reports/` first and reuse an open report rather than creating a near-duplicate.
- **"Trim snapshot X"** — set `"removed": true` on members that fail the criterion you were
  given, and add `"removed_reason"`. Never delete members: trimming must be undoable.
- **Notes** — write findings into the report they belong to:
  `reports/<id>/notes/<topic>/<name>.md` for the run as a whole (insights, experiments,
  logs), `reports/<id>/stocks/<pt>/notes.md` for one stock in it. A finding that spans
  reports goes in the report you are working in (or a new report for that question). Only
  touch an existing per-stock `notes.md` if the owner explicitly asks; if you do, append a
  dated `## AI notes (YYYY-MM-DD)` section rather than editing their text.

## File formats

`reports/<id>/report.json` (the id is the folder name):
```json
{
  "id": "20261104-1305-mid-cheap", "name": "Mid-cap cheap — Nov",
  "thesis": "what this run is testing (often the snapshot's note)",
  "created_at": "2026-11-04T13:05:00+00:00", "created_by": "ai", "status": "open",
  "source": {"kind": "snapshot", "snapshot_id": "20261104-1300-mid-cheap",
             "screen_id": "quality-value", "screen_title": "Quality value"},
  "members": [
    {"permaticker": "199021", "ticker": "UHS", "name": "Universal Health Services",
     "added_at": "2026-11-04T13:05:00+00:00", "added_by": "ai"}
  ],
  "notes": ""
}
```
`source` is `{"kind": "snapshot", ...}` or `{"kind": "manual"}`; `status` is `"open"` or
`"complete"`.

`snapshots/<id>.json`: `{name, note, source: {kind: "grid", params} | {kind: "screen",
screen_id, title, spec}, asof, created_at, created_by, members: [{permaticker, ticker, name,
sector, industry, market_cap, pe, ps, pb, ev_ebitda, roe, roic, ... , removed}]}` — metric
values are as of `asof`; percent metrics are decimals (0.12 = 12%). Edit only `note`,
`removed`, `removed_reason` unless asked.

Rules for every file you write:
- Write the **whole file** as valid JSON (or Markdown), then check it parses:
  `python3 -m json.tool <file> > /dev/null`. A broken file shows as an error on the site.
- Keep `permaticker` values as strings of digits in reports/snapshots, and as an int
  in `dd.json` (the DD format's convention).
- Do not touch `_guide/` or `backtests/`, and never put `dd.json`/`redteam.md`/`notes.md`
  directly in `stocks/<pt>/` — analyses and notes belong to a report.

## Getting data

The app's API is the easiest source. On the homelab it is at `http://127.0.0.1:8001/api/v1`
(from elsewhere on the tailnet: `<your web URL>/api/v1`):

| Need | Endpoint |
|---|---|
| Ticker → permaticker | `GET /search/?q=<ticker or name>` |
| Profile + headline metrics | `GET /company/{permaticker}` |
| Fundamentals history (SF1) | `GET /company/{permaticker}/fundamentals` |
| Valuation history | `GET /company/{permaticker}/valuation` |
| Events (8-K codes) | `GET /company/{permaticker}/events` |
| Prices | `GET /prices/?perma_ticker=…` |
| Insiders | `GET /insiders?perma_ticker=…` |
| Institutional (13F) | `GET /institutional/top-holders?perma_ticker=…`, `/institutional/timeseries?perma_ticker=…` |
| Short interest | `GET /short-interest?perma_ticker=…` |
| Macro (FRED) | `GET /macro/series`, `GET /macro/observations?series_id=…` |
| A saved screen | `GET /screener/screens/{id}` |
| Research itself | `GET /research/` (latest analysis per stock), `/research/reports`, `/research/reports/{id}`, `/research/reports/{id}/notes`, `/research/stocks/{pt}`, `/research/snapshots/{id}` |
| Start / expand a report | `POST /research/reports`, `PATCH /research/reports/{id}` (`add`, `add_from_source`, `status`) |

The full list with parameters is at `/openapi.json`. For anything the API does not expose,
query Postgres directly (read-only): credentials are in the app's `core/.env`; schema in the
repo's `docs/reference/schema.md`. Big tables (`sep`, `daily`, `sf3`) must be filtered by
`ticker` or `permaticker` — never scan them unfiltered. `permaticker` is TEXT in `tickers`
and bigint elsewhere; quote the `"table"` column in `tickers`.

For filings use SEC EDGAR with a descriptive `User-Agent` header (the owner's is
`SEC_USER_AGENT` in `core/.env`); for estimates, news and qualitative evidence use the web,
and cite every source.

## Standards

The point of this folder is understanding that compounds, so:
- **Cite everything.** A claim with no source is a claim we do not make.
- **Verify the screener's numbers** against filings before repeating them; a mismatch is a
  finding.
- **Seek disconfirming evidence** and state what would change the rating.
- **No hindsight, no look-ahead.** Anchor valuation to what was knowable as of `asof`.
- Say what you could not verify (`data_gaps`) instead of smoothing over it.
