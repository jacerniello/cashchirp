"""Point-in-time backtests of saved screens, written as report folders under research/.

`harness` reconstructs what a screen would have selected on a past date (no look-ahead,
survivorship-free) and measures what happened next; `reports` reads and writes the report
folders; `run` is the command-line entry point the API also spawns.
"""
