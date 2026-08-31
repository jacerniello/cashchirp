# Research workflow

**The instruction set.** How to go from "I wonder if…" to a recorded, checkable finding
using this project. Read this once before your first experiment; it is the discipline the
whole repo is built around.

The tooling exists to serve one thing: **understanding that accumulates instead of
evaporating.** A screen you ran but didn't write down is not a result — it's a number you
will half-remember and misquote in six months.

---

## The loop

```
config/screens/          research/logs/            research/insights/
   define        ──▶      hypothesis, run,   ──▶      promote
  the filter               and verdict              what survives
       │
       └──▶  research/watchlist/   (what you think of each name)
```

Four folders, four states of a finding. Each has a README with its own template.

---

## 1 · Define the filter — `config/screens/`

A screen encodes a hypothesis about what makes a good investment. Write it as one.

```bash
cp config/screens/quality-value.yaml config/screens/my-screen.yaml
$EDITOR config/screens/my-screen.yaml
python -m core.scripts.screen.run_screen my-screen
```

Full reference: [CONFIGURATION.md](CONFIGURATION.md).

**Getting a plausible basket is not evidence of anything.** Any set of gates returns
*something*, and it will always look reasonable — the names are profitable and cheap
because you asked for profitable and cheap. That tells you the filter runs, not that it
works. Steps 2–4 are what separate the two.

## 2 · Pre-register the falsification — `research/logs/`

**Before** you run, write the entry: the hypothesis, and **what result would
prove it wrong**. Template: [`research/logs/README.md`](../research/logs/README.md).

This ordering is the single most important rule here, and it is not bureaucracy. Outliers
are trivially easy to explain after the fact; a story that "explains" a past move is always
available and almost always cheap. Once you have seen the result, you can no longer honestly
decide what would have refuted it — the goalposts move without you noticing them move. So
define "correct" first:

- **The baseline to beat.** Not zero. "Better than nothing" is not a finding — a small-cap
  screen that beats the S&P is usually just measuring small-cap beta. Compare against the
  *eligible universe*: the same size and sector gates with your quality/value gates removed.
  That spread is your filter's actual contribution.
- **The out-of-sample split.** Which period you will not look at while iterating.
- **The sanity bounds.** No negative prices, returns in a plausible range, and a reconcile
  against a source you trust.

## 3 · Run it — `run_screen`

```bash
python -m core.scripts.screen.run_screen my-screen          # who passes right now
python -m core.scripts.screen.run_screen my-screen --csv out.csv
```

**Getting a plausible basket is not evidence.** Any set of gates returns *something*, and
it always looks reasonable — the names are profitable and cheap because you asked for
profitable and cheap. That tells you the filter runs, not that it works.

> **There is no built-in historical validation.** The point-in-time backtest harness that
> used to answer "did this ever work?" has been removed. Nothing in this repo currently
> measures a screen's forward returns, so the honest status of any screen here is
> *untested* — treat a basket as a list of candidates to research, never as evidence the
> filter has an edge. If you add validation back, the two properties that make it worth
> trusting are no look-ahead (gate fundamentals by filing date, not period) and no
> survivorship bias (keep the companies that later delisted, carrying their loss).

## 4 · Record the verdict — `research/logs/`

Back in the same entry you pre-registered: parameters, what the screen returned, whether
each stated check held, and the verdict — **confirmed / rejected / inconclusive**.

**Log the dead ends.** A falsified hypothesis is a result, and it is the one you are most
likely to waste a week rediscovering. The logs are the audit trail that makes an insight
trustworthy later; an insight with no run behind it is an opinion.

## 5 · Promote what survives — `research/insights/`

When something holds up across runs, distil it into `research/insights/`. Conventions:
lead with a TL;DR, separate reusable **method** from illustrative **example**, tag the
catalyst/reasoning group, cite sources inline, flag *verified* vs *commonly-repeated*, and
cross-link with `[[name]]`.

Capture the **method** at least as carefully as the outcome. "Quality-value worked
2011–2016" ages badly. "Comparing against the eligible universe rather than the index
removed most of the apparent edge" is true for as long as you do this.

## 6 · Note the names — `research/watchlist/`

A screen finds candidates; it cannot tell you *why* one is cheap or that another is a
trap. Record that judgement in `research/watchlist/annotations.json` and it surfaces on the
idea board. **Write the caution the moment you reject a name** — the screen will surface it
again next quarter, and an unrecorded rejection is a decision you re-litigate from scratch.

---

## The operating principles

Two failure modes rot this kind of project. Everything above is designed against them.

**Building models nobody understands.** Write the hypothesis before the model. Build in
increments you can read and explain — if a change is too big to review, it's too big to
trust. A screen with no stated question is a black box that returns numbers.

**Trusting results nobody validated.** State the validation up front. *If a result can't be
independently checked, treat it as unknown, not done.* Numbers in finance look entirely
plausible while being wrong, which is why `verify_sharadar` exists and why you should run
it.

And the one that catches everyone: **beware overfitting and hindsight.** If you tune gates
until the output looks good, you have fitted the past, not found an edge. Prefer
pre-registered hypotheses and base rates over narratives — and treat a screen you had to
tune into looking right as a screen that doesn't work.
