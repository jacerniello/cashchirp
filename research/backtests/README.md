# backtests/

*What the harness measured.* One CSV per run, named after the screen that produced it:

- `<screen>-portfolio-backtest.csv` — quarterly equal-weight portfolio vs the eligible
  universe (`core.scripts.screen.screen_portfolio_backtest`)
- `<screen>-cohort-study.csv` — pooled forward-return base rates per name
  (`core.scripts.screen.screen_cohort_study`)

These are **outputs, not records.** A CSV here says what happened; it can't say what you
expected, so on its own it is a number you can rationalise after the fact. Write the
hypothesis and what would falsify it in [`../logs/`](../logs/README.md) *before* you run,
and record the verdict there afterwards — that ordering is the whole point, because once
you have seen the result you can no longer honestly decide what would have refuted it.

Both runs are point-in-time and survivorship-free. Prove the harness itself is honest
first:

```bash
python -m core.scripts.screen.screen_backtest_dryrun
```
