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
| **`ACTIVE_SCREEN`** | `quality-value` | **The main personalisation knob** — which `config/screens/<id>.yaml` the idea board and the CLI run by default. |
| `NASDAQ_DATA_LINK_API_KEY` | — | Required for any Sharadar load. |
| `FRED_API_KEY` | — | Required for the macro layer. Free. |
| `SEC_USER_AGENT` | — | **Required for anything reading filings.** Your real name and e-mail. No default: SEC rate-limits by this identity, so a shared one gets everyone blocked. |

---

## Screen specs — `config/screens/*.yaml`

A **screen** is the project's unit of personalisation: which universe to consider, and
which gates a company must clear to be worth your attention.

It is deliberately **data, not code**. Two reasons, and the second matters more than it
looks:

1. You can define your own filter without touching Python.
2. The live idea board and the CLI load the **same file**, so what you look at in the
   browser is exactly what `run_screen` returns — no second definition to drift.

```bash
python -m core.scripts.screen.run_screen --list       # what's defined
python -m core.scripts.screen.run_screen --columns    # what you can gate on
python -m core.scripts.screen.run_screen my-screen    # run it
```

Copy `quality-value.yaml`, change the numbers, point `ACTIVE_SCREEN` at yours. Files
beginning with `_` are ignored, so a half-finished draft can sit in the folder safely.

`quality-value.yaml` is **an example, not a recommendation** — it is there so the format
has a worked reference and a fresh clone has something to run. Replace it with your own.

### Saving a filter from the UI

The `/screener` page can write one for you: set your filters, open **Saved screens**, name
it, save. It lands in `config/screens/<id>.yaml` in exactly this format — so a filter you
built by dragging sliders is immediately runnable, not trapped in a URL:

```bash
python -m core.scripts.screen.run_screen my-filter
```

**Watch the "Not captured" list.** Some screener controls have no gate equivalent — the
market-cap *band* buttons are labels (`mid`), not numbers, so they are reported rather
than saved. The screen still saves; the point is that you find out, because a filter that
silently dropped a constraint would not be the screen you were looking at. Re-express those as explicit `marketcap_min` / `marketcap_max` values.

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

One entry per snapshot column. Run `run_screen --columns` for the full list of what's
available.

| Key | Meaning |
|---|---|
| `min` / `max` | Inclusive bounds (`>=`, `<=`). |
| `gt` / `lt` | Exclusive bounds (`>`, `<`). |
| `on_null` | What a **blank** does. `drop` (default), `keep`, or a number to substitute. |

**`on_null` is the setting people get wrong, and it produces silent false negatives.**
A blank is not automatically a failure — it depends on *why* it's blank:

- `on_null: drop` — the blank is a genuine data absence you're happy to skip. A company
  with no reported ROIC is one you can't assess.
- `on_null: keep` — the blank is a **non-disclosure or a calculation artifact**, not a bad
  number. Many industrials don't break out COGS, so their gross margin is null. Dropping
  them means your "quality" screen silently excludes an entire sector for a metric they
  were never required to report.
- `on_null: 0` — a blank genuinely *means* zero. No reported debt is no leverage.

Get this wrong in the `drop` direction and your screen quietly returns a smaller, biased
basket while looking like it worked perfectly.

> **YAML number gotcha:** write large numbers plainly (`300000000`) or with a **signed**
> exponent (`3.0e+8`). Bare `3.0e8` parses as a *string* in YAML 1.1. The loader rejects
> it with an explicit error rather than comparing numbers against text.

### `growth`

Multi-year growth gates get their own section because a naive CAGR filter has a specific,
expensive bug: a company that went from a **loss** to a profit has a mathematically
undefined CAGR (`NaN`), so a plain `min: 0.03` gate **drops every turnaround** — exactly
the names a value screen exists to find.

Each rule passes if the CAGR clears `min_cagr` **or** the company recovered from a
non-positive base:

```yaml
growth:
  - {level: eps_y, level_5y_ago: eps_y5, cagr: eps_g_5y, min_cagr: 0.03}
```

### Validation

Specs are validated at load. A misspelled gate, a string where a number belongs, or a
column that doesn't exist **fails loudly** rather than being ignored — a screen that
silently skips a gate returns a plausible basket that isn't the filter you wrote, which is
the worst possible failure mode for research you intend to act on.

---

## Watchlist annotations — `research/watchlist/annotations.json`

Your judgement on the names a screen surfaces: why the market dislikes each one, why you
think it's wrong, and which hits are traps you've already rejected. Optional — with no
file the idea board returns the raw screen.

Keyed by **permaticker**, not ticker. Schema and conventions:
[`research/watchlist/README.md`](../research/watchlist/README.md).
