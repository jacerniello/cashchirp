# experiments/results/

*Machine-written, not hand-written.* One self-describing `<id>.json` per experiment run —
its own metadata (title, hypothesis, method, columns, `generated_at`) **plus** the result
rows — with a matching `<id>.csv` alongside for analysis outside the app.

Because each file carries its own schema, the Experiments page renders any experiment with
no bespoke code: add a run, get a page.

Written by the backtest harness (`core.scripts.screen.screen_portfolio_backtest`,
`screen_cohort_study`). Files are named after the screen that produced them, and the
Experiments page reads this directory directly through `web/src/app/api/experiments/`.

**This is the output, not the record.** The design belongs in `../` (written *before* the
run) and the verdict in `../../logs/`. A JSON here with no experiment file behind it is a
number nobody pre-registered a meaning for.
