# Configuration

Two files hold everything that is *yours*: `core/.env` (secrets and environment) and
`config/screens/*.yaml` (what you're looking for). Nothing else needs editing to make this
project your own.

---

## `core/.env`

Copy from `core/.env.example`. Gitignored — secrets never leave your machine.

| Key | Default | Notes |
|---|---|---|
| `POSTGRES_USER` / `_PASSWORD` / `_DB` | `investing` | Must match `core/docker-compose.yml` if you use it. |
| `POSTGRES_HOST` | `localhost` | Point at another host to use a remote database. |
| `POSTGRES_PORT` | `5432` | Change if 5432 is taken; compose reads this too. |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8001` | Where the FastAPI bridge binds. |
| **`ACTIVE_SCREEN`** | `quality-value` | **The main personalisation knob** — which `config/screens/<id>.yaml` the idea board runs by default. |
| `NASDAQ_DATA_LINK_API_KEY` | — | Required for any Sharadar load. |
| `FRED_API_KEY` | — | Required for the macro layer. Free. |
| `SEC_USER_AGENT` | — | **Required for anything reading filings.** Your real name and e-mail. No default: SEC rate-limits by this identity, so a shared one gets everyone blocked. |

---

## Screen specs — `config/screens/*.yaml`

A screen defines which universe to consider and which gates a company must clear.

Screens are data, not code, for two reasons:

1. You can define your own filter without touching Python.
2. The screener page and the idea board load the same file, so what you see in the browser
   is the filter as written. There is no second definition to drift from it.

Screens are defined in `config/screens/` and run from the UI: `/screener` builds one,
`/screener/ideas` runs every saved screen. There is no command-line runner.

Copy `quality-value.yaml`, change the numbers, point `ACTIVE_SCREEN` at yours. Files
beginning with `_` are ignored, so a half-finished draft can sit in the folder safely.

`quality-value.yaml` is an example, not a recommendation. It exists so the format has a
worked reference and a fresh clone has something to run. Replace it with your own.

### Saving a filter from the UI

The `/screener` page can write one for you: set your filters, open Saved screens, name it,
save. It lands in `config/screens/<id>.yaml` in this format and runs at
`/screener/ideas/<id>`.

Check the "Not captured" list when you save. Some screener controls have no gate
equivalent — the market-cap band buttons are labels (`mid`), not numbers — so they are
reported rather than saved. The screen still saves, and the list tells you which
constraints did not carry over, since a screen that silently dropped one would not be the
filter you were looking at. Re-express those as explicit `marketcap_min` / `marketcap_max`
values.

### Shape

```yaml
id: my-screen                # filename stem; must match
title: Short human name
description: >
  What you are looking for and why. This is the hypothesis the screen encodes —
  write it as one, so it says something specific enough to be wrong.

criteria:                    # human-readable restatement, served verbatim by the API
  - "Quality: ROIC >= 15%"   # so a UI's 'how this was built' list cannot drift from
  - "On sale: P/E <= 18"     # the filter that actually ran

universe:
  exclude_sectors: [Energy, Basic Materials]
  exclude_industries: [Biotechnology]
  exclude_delisted: true     # drop names delisted today
  include_sectors: [Technology]        # positive selection: ONLY these
  include_industries: [Software - Application]
  include_exchanges: [NASDAQ]

gates:
  roic:        {min: 0.15}
  pe:          {min: 0, max: 18}
  fcf:         {gt: 0}
  debt_equity: {max: 1.0, on_null: 0}
  gross_margin: {min: 0.25, on_null: keep}

growth:
  - {level: eps_y, level_5y_ago: eps_y5, cagr: eps_g_5y, min_cagr: 0.03}
```

### `gates`

One entry per snapshot column — the columns of `screener_snapshot`, listed in
[reference/schema.md](reference/schema.md#derived--reference-objects).

| Key | Meaning |
|---|---|
| `min` / `max` | Inclusive bounds (`>=`, `<=`). |
| `gt` / `lt` | Exclusive bounds (`>`, `<`). |
| `on_null` | What a **blank** does. `drop` (default), `keep`, or a number to substitute. |

`on_null` is the setting most likely to produce silent false negatives. A blank is not
automatically a failure; it depends on why the value is blank:

- `on_null: drop` — the blank is a genuine data absence you're happy to skip. A company
  with no reported ROIC is one you can't assess.
- `on_null: keep` — the blank is a **non-disclosure or a calculation artifact**, not a bad
  number. Many industrials don't break out COGS, so their gross margin is null. Dropping
  them means your "quality" screen silently excludes an entire sector for a metric they
  were never required to report.
- `on_null: 0` — a blank genuinely *means* zero. No reported debt is no leverage.

Set this wrong in the `drop` direction and the screen returns a smaller, biased basket
with no indication anything was excluded.

> **YAML numbers:** write large numbers plainly (`300000000`) or with a signed exponent
> (`3.0e+8`). Bare `3.0e8` parses as a string under YAML 1.1. The loader rejects it with an
> explicit error rather than comparing numbers against text.

### `growth`

Multi-year growth gates get their own section because a plain CAGR filter has a specific
bug: a company that went from a loss to a profit has an undefined CAGR (`NaN`), so a bare
`min: 0.03` gate drops every turnaround — the names a value screen is often looking for.

Each rule passes if the CAGR clears `min_cagr` **or** the company recovered from a
non-positive base:

```yaml
growth:
  - {level: eps_y, level_5y_ago: eps_y5, cagr: eps_g_5y, min_cagr: 0.03}
```

### Validation

Specs are validated at load. A misspelled gate, a string where a number belongs, or a
column that doesn't exist raises an error rather than being ignored. A screen that
silently skipped a gate would return a plausible basket that is not the filter you
wrote — which is worth failing loudly over, since the output looks correct either way.

---

## `SETUP_ENABLED` — the build-control surface

Off by default. Leave it off anywhere the app is reachable from the internet.

| | |
|---|---|
| `SETUP_ENABLED` | API. Mounts `/api/v1/setup/*` — status, sources, build log, and the endpoints that **start and stop ingests**. |

```bash
# core/.env      — local development
SETUP_ENABLED=true
```

There is no frontend counterpart. The navbar asks the API at runtime whether the setup
routes are served (`/setup/enabled`) and shows the link only if they are, so one setting
governs both. An earlier `NEXT_PUBLIC_SETUP_ENABLED` duplicated it and could disagree —
a link to a route that 404s, or a working surface with no way in.

Leave it unset in production. The router is gated at mount time, so with the flag off
those paths 404 like any unknown URL: a disabled deployment gives no indication that a
setup surface exists.

The default is `false` so that forgetting the flag exposes nothing rather than everything.
