"""Show what's been loaded and when — latest run per dataset from load_log.

    python -m core.scripts.ops.load_status
"""
from core.backend.queries.meta.load_log import latest_by_dataset


def _fmt(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else "-"


def main() -> None:
    rows = latest_by_dataset()
    if not rows:
        print("No loads recorded yet.")
        return

    print(
        f"{'dataset':<22} {'op':<10} {'status':<7} {'rows':>10}  "
        f"{'requested':<16} {'completed':<16}  detail"
    )
    print("-" * 110)
    for r in sorted(rows, key=lambda x: x.dataset):
        rows_str = f"{r.rows:,}" if r.rows is not None else "-"
        print(
            f"{r.dataset:<22} {r.operation:<10} {r.status:<7} {rows_str:>10}  "
            f"{_fmt(r.requested_at):<16} {_fmt(r.completed_at):<16}  {r.detail or ''}"
        )


if __name__ == "__main__":
    main()
