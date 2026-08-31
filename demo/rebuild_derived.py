from core.backend.db.engine import session_scope
from core.backend.queries.discovery import screener
from core.backend.queries.ownership import insiders, institutional
from core.backend.queries.market import sp500

with session_scope() as s:
    print("screener_snapshot", screener.refresh_snapshot(s))
for n, fn in [("insiders", insiders.refresh),
              ("holder_ts", institutional.refresh_holder_timeseries),
              ("inv_holdings_ts", institutional.refresh_investor_holdings_timeseries),
              ("sp500_concentration", sp500.refresh_concentration)]:
    try:
        with session_scope() as s:
            print(n, fn(s))
    except Exception as e:
        print(n, "FAIL", type(e).__name__, str(e)[:90])
print("DONE")
