# watchlist/

*What you think about the names your screen found.*

A screen is mechanical. It can tell you a company is cheap, profitable and compounding —
it cannot tell you **why** the market put it on sale, whether that discount is temporary or
structural, or that one of its hits is a value trap. That judgement is yours, it is
personal, and it is exactly the thing that should not be compiled into the application.

So it lives here, in `annotations.json`, and the API reads it at request time.

## How it is used

`GET /api/v1/screener/ideas/` runs the active screen (`ACTIVE_SCREEN` — see
`config/screens/`) and layers these notes on top:

- a name in **`notes`** gets a `thesis` + `why_unloved` and sorts to the **top** of the board;
- a name in **`cautions`** gets a `caution` string and sinks to the **bottom**;
- everything else comes back unannotated, in cheapest-first order.

The file is optional. Delete it and the idea board still works — you just get the raw
screen. That is the correct empty state: the screen is the product, the notes are your
edge on top of it.

## Schema

Keys are **permatickers** (as JSON strings), *not tickers*. Tickers get recycled and the
same symbol appears across several Sharadar product tables; `permaticker` is the stable
issuer id. Look one up with `GET /api/v1/search/?q=<ticker>`.

```jsonc
{
  "notes": {
    "198989": {
      "why_unloved": "One sentence on the overhang — the specific, quantified reason the "
                     "market is discounting it. Not 'sentiment'.",
      "thesis": "The mechanism by which that discount closes, and what you'd earn if it does."
    }
  },
  "cautions": {
    "199879": "Why you would NOT buy this despite it passing the screen — e.g. cheap only "
              "on cyclical-peak earnings."
  }
}
```

## Conventions

- **`why_unloved` must be falsifiable.** "Regulatory overhang" is a label; "Title-IV
  reauthorisation risk, ~40% of revenue" is a claim you can check.
- **Write the caution the moment you reject a name.** The screen will surface it again next
  quarter, and a rejection you didn't record is a decision you will re-litigate from scratch.
- **Notes are hypotheses, not conclusions.** Before acting on one, write down what would
  prove it wrong in [`../logs/`](../logs/README.md) — a thesis with no stated kill
  criteria is a story, not a position.
