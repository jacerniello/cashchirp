"""Load the SEC mutual-fund ticker map into `sec_fund_class`.

    python -m core.scripts.load.load_sec_fund_classes

A thin driver, like every other entry point here: the loader itself lives in
[`core/backend/ingest/sec_fund_classes.py`](../backend/ingest/sec_fund_classes.py) with
the rest of the write path. It used to fetch and write inline, which made it the one
ingest step invisible to anything reading `core/backend/ingest/`.

`load` is re-exported so `from core.scripts.load.load_sec_fund_classes import load` — used by
`update_all` and `bootstrap` — keeps working.
"""
from core.backend.ingest.sec.sec_fund_classes import fetch, load

if __name__ == "__main__":
    n = load()
    print(f"Loaded {n} fund-class rows into sec_fund_class")
