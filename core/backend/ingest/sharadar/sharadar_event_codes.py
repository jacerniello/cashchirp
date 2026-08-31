"""EVENTS code legend + the `events_decoded` view.

The EVENTS table itself loads via the generic loader (sharadar_generic). This
module owns the bits the generic loader can't: the eventcode -> label legend
(from SHARADAR/INDICATORS) and the view that decodes "22|71|91" into readable
catalyst labels.
"""
from datetime import datetime

import nasdaqdatalink as ndl
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.backend.db.engine import engine, session_scope
from core.backend.db.models import EventCode
from core.backend.queries.meta.load_log import record_load
from core.config import settings

# Expands events.eventcodes ("22|71|91") into ordered human-readable labels.
_EVENTS_DECODED_VIEW = """
CREATE OR REPLACE VIEW events_decoded AS
SELECT e.ticker,
       e.date,
       e.eventcodes,
       array_agg(ec.title ORDER BY c.ord) AS event_titles
FROM events e
LEFT JOIN LATERAL unnest(string_to_array(e.eventcodes, '|'))
     WITH ORDINALITY AS c(code, ord) ON true
LEFT JOIN event_codes ec ON ec.code = c.code
GROUP BY e.ticker, e.date, e.eventcodes;
"""


def load_event_codes() -> int:
    """Load/refresh the eventcode legend from SHARADAR/INDICATORS, then (re)create
    the `events_decoded` view. Returns the number of codes loaded."""
    requested_at = datetime.now()
    ndl.ApiConfig.api_key = settings.nasdaq_data_link_api_key
    df = ndl.get_table("SHARADAR/INDICATORS", paginate=True)
    codes = df[df["table"].astype(str).str.upper() == "EVENTCODES"]

    with session_scope() as session:
        for row in codes.itertuples():
            stmt = pg_insert(EventCode).values(
                code=str(row.indicator).strip(),
                title=row.title,
                description=row.description,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["code"],
                set_={"title": stmt.excluded.title,
                      "description": stmt.excluded.description},
            )
            session.execute(stmt)

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(_EVENTS_DECODED_VIEW)
        raw.commit()
    finally:
        raw.close()

    n = len(codes)
    record_load(
        source="SHARADAR", dataset="SHARADAR/EVENTCODES", operation="backfill",
        rows=n, requested_at=requested_at, detail="eventcode legend + events_decoded view",
    )
    return n
