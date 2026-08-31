# dd/ — Deep Due-Diligence reports

*Real DD, not vibes.* One self-describing JSON file per company (`<TICKER>.json`), each
carrying its full research write-up **plus** the data series that drive its charts. The web
app (`/dd` and `/dd/<TICKER>`) reads these files directly — same pattern as
`research/experiments/results/`. The UI is built once; each new report is just a new file.

**These are the write-ups for whatever your active screen surfaces** (see
`config/screens/` and [`../../docs/CONFIGURATION.md`](../../docs/CONFIGURATION.md)). The
screen states a thesis — "cheap quality compounders re-rate", "asset plays close their
discount", whatever you have encoded — and **that thesis is the spine of every DD written
against it.** Say what yours is here, in one sentence, before you write the first report:
the checklist and the rating scale below both hang off it.

> This folder ships with only `_template.json` and this README. That is deliberate — see
> [`../README.md`](../README.md).

---

## Non-negotiable evidence standard

> **Every claim must be backed by market research, not assertion.** This is a hard gate.

- **Cite the source inline** for every material claim — a 10-K/10-Q/8-K, an earnings call,
  a press release, an analyst note, or a number from our own Postgres mirror. A claim with
  no `source` is a claim we don't make.
- **Verify the screener numbers** against primary filings before repeating them. The screen
  is a starting point; growth, margins, ROIC, net cash, share count must reconcile to the
  10-K/10-Q. If they don't, that *is* a finding.
- **Tag confidence**: `verified` (tied to a primary doc / our DB), `reported` (third-party
  but credible), `uncertain` (lore / single weak source). Never launder `uncertain` into
  `verified`.
- **Seek disconfirming evidence.** Steelman the bear case. Beware hindsight narratives on
  past price moves — a story that "explains" a move after the fact is cheap.
- **No look-ahead, point-in-time.** Anchor valuation to data knowable as of `asof`.

### Reading SEC filings

SEC EDGAR requires a descriptive `User-Agent` carrying a **real contact** on every request,
or it returns `403`. Set `SEC_USER_AGENT` in `core/.env` (see
[`../../docs/CONFIGURATION.md`](../../docs/CONFIGURATION.md)) and send it as the header —
`research/sec_earnings.py` and `core/scripts/load/load_sec_fund_classes.py` both read it. Do not
borrow someone else's: SEC rate-limits by that identity and blocks both of you.

Full-text search: `https://efts.sec.gov/LATEST/search-index?q=...` /
`https://www.sec.gov/cgi-bin/browse-edgar`. Company facts JSON:
`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` (CIK zero-padded to 10).
Set the header on every request.

---

## The buy rating — 1 to 6 (define "good" before scoring)

A single integer `1–6`. **Anchor the scale on the outcome your screen is hunting, and write
that anchor down before you score anything.** The example below is anchored on *a re-rating
that roughly doubles the stock over a few years* — swap in your own objective (a compounding
rate, an absolute return, a discount closing) and re-word the bands to match.

Whatever the anchor, the scale is **return-oriented**, not a pure quality score: a wonderful
business priced for perfection can still be a `3`. Grade the **opportunity**, risk-adjusted.

Defining this first is the same discipline as pre-registering a falsification. A rating
scale invented while scoring is a scale fitted to the name in front of you.

| Score | Label | Meaning — what earns it |
|------:|-------|--------------------------|
| **6** | **Conviction double** | Multiple *independent, verified* value drivers. A concrete, identifiable mispricing (not just "it's cheap"). Clear path to **~2× in ~2–4y** with a real margin of safety — downside is limited by asset value / net cash / durable FCF. Strong moat, clean balance sheet, a visible catalyst. "Back up the truck." |
| **5** | **Strong double candidate** | Compelling re-rating thesis, most evidence verified. Base-case upside **~70–100%+**. One soft spot — catalyst timing unclear, a single quantifiable risk, or one metric that needs to hold. High quality, high reward, moderate uncertainty. |
| **4** | **Solid long / money-maker** | Good business at a fair-to-cheap price; **likely to make money (~30–60% over a few years)** but a clean 2× needs things to break right. Moat/growth solid, the mispricing is milder or the catalyst softer. A buy, not a table-pounder. |
| **3** | **Fairly valued / hold** | Quality is fine but it's priced about right. Limited edge; expected return ≈ the market. No clear catalyst, or the discount looks justified. Watch, don't buy. |
| **2** | **Value trap / overhang** | Cheapness is *explained* — structural decline, secular disruption, governance/related-party issues, or earnings sitting on a cyclical peak. Downside ≈ upside. Avoid despite the optics. |
| **1** | **Avoid / impaired** | Deteriorating fundamentals or a broken thesis; cheapness masks real risk of **permanent capital loss**. Pass. |

**Grouping:** `5–6` = top buys · `4` = buy · `3` = watchlist · `1–2` = pass / trap. Every
DD states the score **and** the one or two things that would move it up or down.

`confidence` (`high|medium|low`) is separate from the score: how sure we are *of* the score
given evidence quality and data gaps.

---

## The DD checklist (every report covers all of it)

Each item resolves to a `status` — `pass` (thesis-supportive / verified), `warn` (mixed or
needs watching), `fail` (thesis-damaging), `na` (not applicable) — with a one-to-three
sentence `finding` and its `sources`. **No item may be skipped silently**; if it can't be
researched, mark it `na`/`warn` and say so in `data_gaps`.

**A · Business & moat**
1. Revenue model and segment/geography mix — *quantified* (% of revenue, growth by segment).
2. Moat source named and evidenced (switching costs, scale, IP/patents, brand, network) **and** a durability test (what erodes it, how fast).
3. Market share and TAM with direction — gaining or losing share? Is the market growing?
4. Pricing power / customer retention / unit economics — concrete evidence (net retention, churn, price increases stuck).

**B · Financial quality (reconcile to filings — don't trust the screen)**
5. Revenue & EPS growth (5y and TTM) verified to filings; split **organic vs acquired**.
6. Margin trend (gross/operating/net), direction and vs peers; reconcile to the income statement.
7. ROIC/ROE quality — is the return real, or inflated by leverage / buybacks / one-offs?
8. FCF conversion — FCF vs net income, capex intensity, and **honest SBC treatment** (don't add back stock comp as if free).
9. Balance sheet — net cash/debt, debt maturities, Altman-Z, leases/pension/contingencies.
10. Share count trend — buybacks **net of SBC dilution**; is the count actually falling?

**C · Valuation & expectations**
11. Current multiples (P/E, EV/EBITDA, P/FCF, EV/Sales) vs the company's **own 5–10y history** and vs peers.
12. **Reverse-DCF / implied expectations** — what growth & margins does today's price bake in? (This is the "priced-in expectations" chart.)
13. **Scenario fair value** — bear/base/bull price targets with *explicit* assumptions → upside/downside and a probability weight.
14. Analyst consensus — price target, estimate-revision trend, and **where we differ and why** (the "deviation from reality").

**D · Catalysts & price history**
15. *Why it's cheap now* — the specific overhang, quantified (not "sentiment").
16. Historical price reactions to catalysts (earnings, guidance, M&A, buybacks, regulatory) — what actually moved it, with dates and % moves.
17. Identifiable **forward catalyst(s)** that could trigger the re-rating, with rough timing.
18. Ownership signals — insider buying/selling, institutional flow, activists, 13D/13F.

**E · Risks & disconfirmation**
19. Bear case steelmanned — the 2–3 things that would break the thesis.
20. Key risks quantified — customer concentration, regulation, cyclicality, FX, leverage.
21. Disconfirming evidence actively sought and reported (what argues *against* us).

**F · Verdict**
22. Rating `1–6` with a one-line justification grounded in the above.
23. What would move the rating up, and what would move it down.
24. Data gaps — what could not be verified, and how much it matters.

---

## JSON contract (`<TICKER>.json`)

See `_template.json` for a fully-populated example (files starting with `_` are ignored by
the index). Shape:

```jsonc
{
  "id": "TMPL",                      // == ticker, filename stem
  "ticker": "TMPL",
  "permaticker": 100001,             // int; links to /company/<permaticker>. null if unknown
  "company": "Example Corp",
  "sector": "Technology",
  "industry": "Software - Application",
  "group": 2,                        // which subagent batch (1..5)
  "asof": "2026-06-17",              // point-in-time anchor for all valuation
  "generated_at": "2026-06-19T12:00:00Z",

  "rating": { "score": 5, "label": "Strong double candidate",
              "confidence": "high|medium|low",
              "one_liner": "One sentence on why this score." },

  "price": { "current": 280.0, "currency": "USD", "market_cap": 5.02e9,
             "fair_value_bear": 240, "fair_value_base": 480, "fair_value_bull": 650,
             "upside_base_pct": 0.71 },        // (base/current - 1)

  "tldr": "2–4 sentence plain-English verdict.",
  "bull_case": "markdown",
  "bear_case": "markdown",
  "verdict": "Synthesis + what would change my mind.",

  "thesis_points": [
    { "claim": "...", "evidence": "...", "confidence": "verified|reported|uncertain",
      "source": { "label": "FY24 10-K p.42", "url": "https://..." } }
  ],

  "checklist": [
    { "section": "A · Business & moat", "item": "Revenue model & segment mix quantified",
      "status": "pass|warn|fail|na", "finding": "...",
      "sources": [ { "label": "...", "url": "..." } ] }
    // ... all 24 items, in order
  ],

  "expectations": {                  // checklist #12 — priced-in vs reality
    "summary": "Reverse-DCF: price implies ~3% FCF growth; consensus & history say ~8%.",
    "implied_growth_pct": 0.03, "reference_growth_pct": 0.08,
    "method": "10y reverse DCF, WACC 9%, terminal 3%"
  },

  "analyst_estimates": {             // checklist #14 — look these up
    "consensus_pt": 360, "n_analysts": 18, "rating_dist": "12 Buy / 5 Hold / 1 Sell",
    "source": { "label": "...", "url": "..." },
    "note": "PT trend rising over last 2 quarters; we sit above consensus on margins."
  },

  "scenarios": [                     // checklist #13 — drives the scenario chart
    { "name": "Bear", "prob": 0.25, "price_target": 240, "return_pct": -0.14,
      "assumptions": "..." },
    { "name": "Base", "prob": 0.50, "price_target": 480, "return_pct": 0.71, "assumptions": "..." },
    { "name": "Bull", "prob": 0.25, "price_target": 650, "return_pct": 1.32, "assumptions": "..." }
  ],

  "catalysts": [                     // checklist #16/#17 — past + forward
    { "date": "2025-02-13", "title": "Q4 guide light on cloud", "kind": "guidance",
      "direction": "past", "price_reaction_pct": -0.18,
      "note": "...", "source": { "label": "...", "url": "..." } },
    { "date": "2026-Q3", "title": "Agentic-AI product GA", "kind": "product",
      "direction": "forward", "note": "Potential re-rating trigger.", "source": {...} }
  ],

  "charts": [                        // data-driven; renderer supports these `type`s
    { "id": "price", "type": "price_catalysts", "title": "5y price & catalysts",
      "yFormat": "currency",
      "series": [ { "label": "Price", "points": [ { "date": "2021-06-01", "value": 290 } ] } ],
      "markers": [ { "date": "2025-02-13", "label": "Q4 guide", "tone": "neg" } ] },
    { "id": "exp", "type": "multiline", "title": "Implied vs consensus revenue growth",
      "yFormat": "percent",
      "series": [ { "label": "Priced-in", "points": [...] }, { "label": "Consensus", "points": [...] } ] },
    { "id": "val", "type": "multiline", "title": "EV/EBITDA vs 5y median", "yFormat": "ratio",
      "series": [ { "label": "EV/EBITDA", "points": [...] }, { "label": "5y median", "points": [...] } ] },
    { "id": "est", "type": "bars", "title": "Revenue: actual vs estimate",
      "yFormat": "currency",
      "categories": ["FY23","FY24","FY25E","FY26E"],
      "series": [ { "label": "Actual", "values": [.. , null, null] },
                  { "label": "Estimate", "values": [null, null, .., ..] } ] }
  ],

  "risks": [ "Customer-concentration: ...", "Regulatory: ..." ],
  "sources": [ { "label": "FY24 20-F", "url": "https://...", "accessed": "2026-06-19" } ],
  "data_gaps": [ "Could not get segment-level margins — only consolidated disclosed." ]
}
```

**Chart types the renderer supports** (keep to these so every DD renders):
- `price_catalysts` — price line with dated catalyst markers (vertical rules, colored by `tone`: `pos|neg|neutral`).
- `multiline` — N labelled series sharing a date axis (implied-vs-consensus, multiple vs history).
- `bars` — grouped bars over `categories` (actual vs estimate by year). Use `null` to skip a series in a category.

`yFormat` ∈ `currency | percent | ratio | number`. Dates are `YYYY-MM-DD` (or `YYYY-MM`).
Use `null` for genuinely missing values — never invent points to fill a line.

---

## Round-2 deep DD (`tier` + `deep` block)

After the first pass, names are triaged with a `tier` and the **finalists** get a second,
quantitative pass. Two optional fields carry this:

```jsonc
"tier": "finalist" | "bench" | "cut",   // shown as the top-level grouping on /dd

"deep": {
  "reverse_dcf": {                       // computed, not narrative
    "summary": "...",
    "assumptions": { "wacc": 0.09, "terminal_growth": 0.03, "years": 10,
                     "start_fcf": 520000000, "shares": 62000000 },
    "implied_growth_pct": 0.03,          // growth the CURRENT price requires
    "fair_value": 480,
    "sensitivity": {                     // fair value per WACC × terminal-growth cell
      "rows": ["WACC 8%", "WACC 9%", "WACC 10%"],
      "cols": ["g 2%", "g 3%", "g 4%"],
      "values": [[..],[..],[..]]
    }
  },
  "expected_return": {                   // probability-weight the bear/base/bull scenarios
    "ev_price_target": 470, "ev_return_pct": 0.68, "irr_pct": 0.19, "horizon_years": 3,
    "breakeven": "Price implies ~3% growth; you make money unless growth falls below ~1%.",
    "note": "..."
  },
  "kpi_trace": {                         // the ONE leading indicator for this thesis
    "name": "Cloud revenue growth (YoY)",
    "thesis_signal": "Must hold >12% for the re-rate; <8% breaks it.",
    "yFormat": "percent",
    "points": [ { "date": "2024-03-31", "value": 0.24 }, ... ],
    "verdict": "Decelerating but still double-digit — watch the consumption transition.",
    "source": { "label": "...", "url": "..." }
  },
  "peer_comps": {                        // cheap vs PEERS, not just own history
    "note": "EV/EBITDA (FY1), rev growth, op margin",
    "columns": [ { "id": "name", "label": "Company", "kind": "text" },
                 { "id": "evebitda", "label": "EV/EBITDA", "kind": "ratio" },
                 { "id": "growth", "label": "Rev gr", "kind": "pct" },
                 { "id": "opm", "label": "Op margin", "kind": "pct" } ],
    "rows": [ { "name": "Example Corp", "evebitda": 5.8, "growth": 0.08, "opm": 0.21, "self": true },
              { "name": "Peer A",       "evebitda": 8.1, "growth": 0.03, "opm": 0.18 } ]
  },
  "insider_signal": {                    // pull from OUR DB (insiders + 13F)
    "summary": "...", "insider_net_value": 3200000, "window": "trailing 6m",
    "institutional_trend": "13F holders accumulating into the de-rate",
    "source": { "label": "derived.insider_company / institutional", "url": "" }
  },
  "falsification": {                     // pre-register the kill-switch; also write the experiment
    "hypothesis": "Re-rating from multiple-compression unwind as the AI fear fades.",
    "kill_criteria": "If cloud growth prints <8% for two straight quarters, thesis is wrong.",
    "check_by": "2026-Q4",
    "experiment_file": "research/experiments/001-tmpl-rerating-thesis.md"
  }
}
```

A deep pass must: compute the reverse-DCF from our DB fundamentals (FCF, share count)
— don't eyeball it; probability-weight the existing `scenarios` into `expected_return`; pick
and trace the single most diagnostic KPI; build a named-peer comp table; pull insider/13F
signal from the local Postgres (`derived.insider_company`, institutional tables); and write a
pre-registered falsification **both** into `deep.falsification` **and** as a real experiment
file under `research/experiments/` (follow that folder's template). The kill-criteria are
the point: a DD without one is a story, not a position.

## Writing a report

Per company: run the full checklist,
reconcile screener numbers to filings, look up analyst estimates and consensus PT, pull
enough price history to annotate catalysts, build the reverse-DCF/expectations view, write
bull/bear/verdict, assign the `1–6` rating, and emit `research/dd/<TICKER>.json` exactly to
the contract above.

- **Reconcile to your own DB where possible** (prices and fundamentals live in Postgres —
  see `docs/reference/schema.md`); use SEC filings and the open web for estimates, consensus,
  catalysts, and qualitative moat evidence.
- Validate the JSON parses and every `charts[].series` has real points before finishing.
- If you are delegating this to agents, one agent per **batch of ~3** companies works well —
  the checklist is long enough that a larger batch degrades into summary.

## Keeping a DD current

The `/dd/<TICKER>` page reads the JSON **live**, so refreshing a name means editing its
file — there is nothing to rebuild. To bring one up to date:

1. Bump `price.current` (and `market_cap`) and re-check `upside_base_pct`.
2. Append new **`past` catalysts** to the `catalysts` array, each with its `source` and the
   actual `price_reaction_pct`. The news panel renders these in date order.
3. Move any **`forward`** catalyst that has now happened to `direction: "past"`, and record
   what the reaction actually was. This is the cheapest feedback loop in the whole project:
   it tells you whether your catalyst calls land, and it is the first thing to go stale if
   you skip it.
4. Re-check `deep.falsification.kill_criteria`. If it has been met, **say so in `verdict`
   and change the rating.** A DD that never gets downgraded is not being used.

Keep `permaticker` an **int** (it links to `/company/<permaticker>`); look it up if unknown.
