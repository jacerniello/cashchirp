# research/

The master folder for the research program (see the top-level `CLAUDE.md` for the mission
and the general → narrow → catalogued arc; see
[`../docs/RESEARCH_WORKFLOW.md`](../docs/RESEARCH_WORKFLOW.md) for the workflow with
commands).

**It ships empty on purpose.** Every folder here holds a README and a template and nothing
else — the content is *yours*. A research catalogue full of someone else's conclusions is
worse than an empty one: you would inherit their theses without their reasoning, and the
whole point is that the understanding is cumulative *for the person building it*.

## The folders

- **`logs/`** — *what actually happened.* The chronological record of experiment **runs**:
  what was executed, when, parameters, results, and the verdict (confirmed / rejected /
  inconclusive). Dead ends are recorded too — a falsified hypothesis is a result. Logs
  point back to the experiment they ran and forward to any insight they produced.

- **`insights/`** — *what we believe.* Distilled, durable notes on investors, theses,
  catalyst/reasoning groups, and market mechanics. The accumulated understanding. Each
  insight tags its catalyst group and separates reusable method from illustrative example.
  Organise into sub-topics as it grows (e.g. `insights/success_stories/`).

- **`watchlist/`** — *what you think of the names your screen found.* Per-name judgement —
  why the market dislikes it, why you think that's wrong, which hits are traps you've
  already rejected. Read live by the idea-board API.


- **`sources/`** — *where data comes from.* `sources.md` registers every data source and
  reference: what it covers, how we access it, where it lands. API keys stay in `core/.env`,
  never here.

## Flow

```
config/screens/  ──▶  logs/  ──▶  insights/
  (the filter)      (hypothesis,   (durable
                     run, verdict)  understanding)
       │
       └──▶  watchlist/ (what you think of each name)
```

A run that confirms something durable graduates into an insight. The logs are the audit
trail that makes the insight trustworthy — an insight with no run behind it is an opinion.

## Also here

`sec_earnings.py` — fetch a company's earnings exhibit from SEC EDGAR by CIK and date.
Requires `SEC_USER_AGENT` in `core/.env` (SEC returns 403 without a real contact).

> Planned additions as the project grows (create when needed, don't pre-build empty dirs):
> `data/` (raw + cached datasets), `models/` (hypothesis-testing models + their specs),
> `validation/` (shared test harness, golden-number checks).
