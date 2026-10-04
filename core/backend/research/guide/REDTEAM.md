# The red-team standard — `reports/<id>/stocks/<permaticker>/redteam.md`

A red team is an **adversarial review of an existing DD**, written next to it in the same
report (`reports/<id>/stocks/<permaticker>/`). Your job is to kill the bull
thesis in `dd.json`, and to concede honestly where you cannot. It is the cheapest protection
against the most common failure in this kind of work: a plausible story that nobody tried to
break.

> Generated from the repo (`core/backend/research/guide/`). Edit it there, not here.

## Before you start

- Read `reports/<id>/stocks/<permaticker>/dd.json` in full, and `stocks/<permaticker>/notes.md`
  if present (the owner's own view).
- Note the DD's rating, base-case price target and the 2–3 claims the thesis actually rests
  on. Those are your targets; do not spend the review on side issues.
- Re-pull the numbers yourself (the app API or Postgres — see `CLAUDE.md`) instead of
  trusting the DD's figures. A red team that reuses the bull's data inherits its mistakes.

## Shape of the file

```markdown
# <Company> (<TICKER>, permaticker <n>) — RED-TEAM REVIEW

- **Date:** YYYY-MM-DD · **Price reviewed:** $x (source, date) · mcap / EV / net cash
- **Attacks:** dd.json (rating N, base $X) [+ any snapshot/thesis it was written against]
- **Overall verdict:** CONFIRMED | CONDITIONAL | REFUTED — one paragraph, the honest read.

## The short thesis (what I'm trying to prove)
## Load-bearing facts — verified (each tagged DAMAGING / NEUTRAL / REFUTES-BEAR)
   ### 1. <fact> — **TAG**   (tables of the actual numbers, with where they came from)
## Structural risks, sized
## Inverted DCF — what makes today's price FAIR or RICH?
## Outside view (base rate)            — how often does this kind of setup work?
## Institutional / insider read
## Probability-weighted value — bear reweight of the DD's scenarios
## Where the bear is REFUTED (concede honestly)
## FINAL VERDICT
   ### Recommendation   — what rating the DD should have, and what would change it
   ### Data tags / uncertainty
```

## Rules

- **Every damaging claim needs a number and a source** (filing, our database with the query
  or endpoint, or a cited web source). Tag confidence the same way the DD standard does:
  verified / reported / uncertain.
- **Concede what survives.** A review that finds nothing right with the bull case is as
  untrustworthy as a DD that finds nothing wrong.
- **End with a rating opinion.** If the red team changes your view of the 1–6 score, say what
  it should be. Do not edit `dd.json`'s rating yourself unless the owner asked you to — the
  disagreement is the useful part, and the owner decides.
- Beware hindsight: a story that explains a past price move after the fact is cheap.
