"""Screen studies — does a screen remove losers and keep winners?

Separate from backtesting proper (`core.backend.backtest.harness`/`run`), which answers
"what would holding this screen have returned?". A study instead labels every stock in a
screen's universe, at each past rebalance date, as a winner or loser by what it went on to
do, and measures each gate and candidate signal against those labels:

    panel.py     the point-in-time panel: universe snapshot per date + forward returns,
                 cached under core/data/panels/
    analysis.py  labels, selection metrics, gate audit, signal study, screen comparison
    run.py       writes the study reports (kinds gate-audit, signal-study, screen-comparison)

Run through the normal runner: `python -m core.backend.backtest.run --kind gate-audit
--screen <id>` (also `signal-study`, `compare`). See docs/RESEARCH.md → "Screen studies".
Nothing outside this folder depends on it except that one dispatch in backtest/run.py and
the report viewer in web/src/components/backtests/study/, so it can be removed as a unit.
"""
