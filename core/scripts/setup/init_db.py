"""Create all tables. Idempotent (only creates what's missing).

    python -m core.scripts.setup.init_db            # create missing tables
    python -m core.scripts.setup.init_db --reset    # DROP all tables, then recreate

--reset is destructive — fine while the schema is young and data is reloadable
from source. Once data is precious, switch to a real migration tool.
"""
import argparse

from core.backend.db import models  # noqa: F401  (registers tables on Base)
from core.backend.db.base import Base
from core.backend.db.engine import engine


def main() -> None:
    parser = argparse.ArgumentParser(description="Create (or reset) database tables.")
    parser.add_argument(
        "--reset", action="store_true", help="DROP all tables before creating"
    )
    args = parser.parse_args()

    if args.reset:
        Base.metadata.drop_all(engine)
        print("Dropped all tables.")
    Base.metadata.create_all(engine)
    print(f"Tables ready: {', '.join(sorted(Base.metadata.tables))}")


if __name__ == "__main__":
    main()
