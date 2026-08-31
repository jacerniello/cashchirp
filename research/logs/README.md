# logs/

*What actually happened.* The chronological audit trail of experiment **runs** — the
record that makes an insight trustworthy. Every run goes here, including the ones that
failed or went nowhere; a falsified hypothesis is a result.

## Naming

`YYYY-MM-DD-experiment-slug.md` (or append entries to a per-experiment log file).
Write the hypothesis and its falsification here BEFORE the run, then fill in the
verdict after — the ordering is what makes the verdict trustworthy.

## Per-run entry template

```markdown
# YYYY-MM-DD — run of <experiment NNN-slug>

- **Screen:** `config/screens/<id>.yaml`
- **Hypothesis:** <what you expect, and why>
- **Falsification:** <what result would prove this wrong — state it before running>
- **Verdict:** confirmed | rejected | inconclusive

## What was run
<Command / script / notebook + key parameters. Enough to reproduce.>

## Data snapshot
<Exact universe + date range used this run; data version/source. Note anything off.>

## Results
<Numbers, tables, charts. The actual output — not a summary of vibes.>

## Validation checks
<Did it pass the pre-stated baseline / holdout / sanity bounds? Show it.>

## Read
<What this run tells us. Caveats, suspected overfitting, next step.
 If durable, note the insight it should feed in ../insights/.>
```
