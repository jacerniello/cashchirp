# experiments/

*What we're testing.* One file (or subfolder) per experiment, written **before** running it.
This is the design/spec/protocol — `logs/` records what happens when you actually run it.

## Naming

`NNN-short-slug.md` (zero-padded sequence), e.g. `001-sector-relative-baseline.md`.

## Template

```markdown
# 001 — <title>

- **Status:** draft | running | done
- **Catalyst/reasoning group:** <tag, if applicable — e.g. short-squeeze, asset-play>
- **Created:** YYYY-MM-DD

## Hypothesis
<One sentence. What do we expect, and why?>

## Falsification
<What result would prove this WRONG? State it before running — no moving goalposts.>

## Data
<Universe, date range, source(s), known caveats/biases (survivorship, look-ahead, etc.).>

## Method
<Model / test / metric. Keep it small enough to review and explain.>

## Validation (define "correct" up front)
- Baseline to beat: <e.g. market/sector-relative naive model>
- Out-of-sample / holdout: <how>
- Sanity bounds: <e.g. no negative prices, returns within plausible range>

## Runs
<Link to the relevant entries in ../logs/. Each run gets logged there, not here.>

## Outcome
<Filled in after: confirmed / rejected / inconclusive, and what it means.
 If it produced durable understanding, link the insight in ../insights/.>
```
