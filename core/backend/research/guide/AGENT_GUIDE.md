# Research folder — guide for AI agents

You are in the **research folder** of cashchirp, a screening tool over a local mirror of US
equity fundamentals, prices and filings (Sharadar) plus FRED macro data. This folder holds
the owner's research: their notes, AI due-diligence, red-team reviews, groups of stocks,
frozen screener results, and backtest reports. The cashchirp web app reads these same files
live, so whatever you write here shows up on the site immediately.

> Generated from the repo (`core/backend/research/guide/AGENT_GUIDE.md`) and refreshed when the
> app starts. Do not edit this copy; it will be overwritten.

## Layout

```
stocks/<permaticker>/      one folder per stock — keyed by permaticker, NEVER ticker
  meta.json                {permaticker, ticker, name, created_at, updated_at}
  notes.md                 the OWNER's notes — read them, do not rewrite them
  dd.json                  due-diligence report (format: _guide/DD_STANDARD.md)
  redteam.md               adversarial review of dd.json (format: _guide/REDTEAM.md)
groups/<id>.json           named, editable sets of stocks — categories
snapshots/<id>.json        a screener result frozen at a moment, trimmable
notes/**.md                free-form notes not tied to one stock (insights, experiments, logs)
backtests/<id>/            backtest reports (report.json + CSVs) — written by the runner, read-only
_guide/                    DD_STANDARD.md, REDTEAM.md, dd_template.json — the standards
```

Tickers get recycled across companies, so a stock is always identified by its
**permaticker** (an integer). If you only have a ticker, look the permaticker up (see
"Getting data") before creating anything.

## What the owner will ask you to do

- **"Do DD on <stock | snapshot | group>"** — for each stock, follow `_guide/DD_STANDARD.md`
  and write `stocks/<permaticker>/dd.json` (create the folder and a `meta.json` if missing).
  For a snapshot or group, work through its members; skip members a snapshot marks
  `"removed": true`. A DD that already exists is updated, not replaced from scratch, unless
  asked — see "Keeping a DD current" in the standard.
- **"Red-team <stock | the 5–6s in X>"** — follow `_guide/REDTEAM.md`, write `redteam.md`.
- **"Group these" / "categorise snapshot X"** — create or edit `groups/<id>.json`. Groups are
  the owner's main way of organising research (catalyst type, sector theme, thesis family,
  watch vs. buy…). Prefer adding to an existing group over creating a near-duplicate; read
  `groups/` first. Mark everything you add with `"added_by": "ai"` and give each member a
  one-line `note` saying why it belongs.
- **"Trim snapshot X"** — set `"removed": true` on members that fail the criterion you were
  given, and add `"removed_reason"`. Never delete members: trimming must be undoable.
- **Notes** — write general findings to `notes/<topic>/<name>.md`. Only touch a stock's
  `notes.md` if the owner explicitly asks; if you do, append a dated `## AI notes (YYYY-MM-DD)`
  section rather than editing their text.

## File formats

`groups/<id>.json` (the id is the file name; lowercase, hyphens):
```json
{
  "name": "Asset plays", "description": "Trading below net cash or liquidation value",
  "created_by": "human", "created_at": "2026-11-04T18:00:00+00:00", "updated_at": "...",
  "members": [
    {"permaticker": "199021", "ticker": "UHS", "name": "Universal Health Services",
     "note": "why it belongs", "added_by": "ai", "added_at": "2026-11-04T18:05:00+00:00"}
  ]
}
```

`snapshots/<id>.json`: `{name, note, source: {kind: "grid", params} | {kind: "screen",
screen_id, title, spec}, asof, created_at, created_by, members: [{permaticker, ticker, name,
sector, industry, market_cap, pe, ps, pb, ev_ebitda, roe, roic, ... , removed}]}` — metric
values are as of `asof`; percent metrics are decimals (0.12 = 12%). Edit only `note`,
`removed`, `removed_reason` unless asked.

Rules for every file you write:
- Write the **whole file** as valid JSON (or Markdown), then check it parses:
  `python3 -m json.tool <file> > /dev/null`. A broken file shows as an error on the site.
- Keep `permaticker` values as strings of digits in groups/snapshots, and as an int in
  `dd.json` (the DD format's convention).
- Do not touch `_guide/` or `backtests/`.

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
| Research itself | `GET /research/`, `/research/snapshots/{id}`, `/research/groups/{id}` |

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
