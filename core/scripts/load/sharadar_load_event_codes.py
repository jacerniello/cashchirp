"""Load the EVENTS code legend and build the `events_decoded` view.

    python -m core.scripts.load.sharadar_load_event_codes

Pulls SHARADAR/INDICATORS (table=EVENTCODES) into `event_codes`, then creates the
`events_decoded` view that turns "22|71|91" into readable labels.
"""
from datetime import datetime

from core.backend.ingest.sharadar.sharadar_event_codes import load_event_codes


def main() -> None:
    started = datetime.now()
    print(f"[{started:%H:%M:%S}] loading eventcode legend ...")
    n = load_event_codes()
    print(
        f"[{datetime.now():%H:%M:%S}] done — {n} eventcodes loaded; "
        f"`events_decoded` view ready."
    )


if __name__ == "__main__":
    main()

