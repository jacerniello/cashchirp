"""Verify each loaded table against the file it was downloaded from.

    python -m core.scripts.ops.verify_sharadar

For each table: compares Postgres against its downloaded zip — row count and
per-column non-null counts. Any line that isn't "OK" means the load lost rows or
silently nulled values. No network/API calls.
"""
from datetime import datetime

from core.backend.verify import verify_all


def main() -> None:
    print(f"[{datetime.now():%H:%M:%S}] verifying loaded tables vs downloaded files ...\n")
    verify_all()
    print(f"\n[{datetime.now():%H:%M:%S}] done. Any non-OK line warrants a look.")


if __name__ == "__main__":
    main()
