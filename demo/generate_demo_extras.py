"""Fill the remaining demo tables: insiders, 13F institutions, actions, events, metrics,
S&P 500 membership, fund prices, FRED macro and FINRA short interest.

    python demo/generate_demo_extras.py --dsn postgresql://…/cashchirp_demo

Run AFTER generate_demo_data.py — it reads the issuers that script created so every row
here refers to a company that exists. As with the base data, nothing is real: investor
names, insider names and macro series are all invented, drawn from a seeded RNG.

The aim is that no page renders an empty state for want of rows. A page that is blank
because a table was never populated looks identical to one that is broken, and on a demo
nobody can tell those apart.
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import date, datetime, timedelta
from datetime import time as dtime

import psycopg

SEED = 20260901

# Invented asset managers — deliberately not the names of real 13F filers.
INVESTORS = [
    "Ashford Rock Capital", "Blue Meridian Advisors", "Cairnwell Asset Management",
    "Dunlin Partners LP", "Eastgate Capital Group", "Fernbank Investment Trust",
    "Glasshouse Capital", "Halyard Global Advisors", "Ironbark Fund Management",
    "Kestrel Point Partners", "Larkspur Capital Management", "Marlowe & Finch",
    "Northgate Securities", "Oakhaven Advisors", "Pemberton Asset Partners",
    "Quillon Capital", "Ridgeline Investment Co", "Stonebridge Wealth",
    "Thornfield Capital", "Vireo Asset Advisors",
]
FIRST = ["Adele", "Bernard", "Clara", "Desmond", "Elena", "Franklin", "Greta", "Hugo",
         "Imani", "Jonas", "Katya", "Louis", "Mira", "Nolan", "Odette", "Rupert",
         "Sabine", "Theo", "Ursula", "Viktor"]
LAST = ["Ashby", "Brennan", "Caldwell", "Danforth", "Ellery", "Fairbairn", "Gallagher",
        "Hollis", "Ingram", "Jarvis", "Keating", "Lindqvist", "Mattingly", "Norwood",
        "Ortega", "Prescott", "Quintero", "Ravenscroft", "Sandoval", "Thackeray"]
# The real Sharadar legend is ~100 codes; these are the ones the demo events emit,
# with Sharadar's own titles so the company events tab reads correctly.
EVENT_CODES = [
    ("11", "Notice of Sale of Securities", "Form D filed — an exempt securities offering."),
    ("13", "Results of Operations and Financial Condition", "Earnings release (8-K Item 2.02)."),
    ("21", "Regulation FD Disclosure", "Material information disclosed under Reg FD."),
    ("31", "Departure/Election of Directors or Officers",
     "A change in the board or in principal officers."),
    ("44", "Entry into a Material Definitive Agreement",
     "A material contract outside the ordinary course of business."),
    ("51", "Other Events", "An event the registrant considers of importance to shareholders."),
]

EDGAR = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=")

NATURES = ["By Trust", "By 401(k)", "By Spouse", "By LLC", "By Family Partnership"]

TITLES = ["Chief Executive Officer", "Chief Financial Officer", "Director",
          "Chief Operating Officer", "EVP & General Counsel", "Chief Technology Officer"]

# Invented macro series. `tcode` mirrors FRED-MD's transform codes so the macro page's
# transform handling has something valid to work with.
SERIES = [
    ("DEMO_GDP", "Demo Real Output Index", 5), ("DEMO_CPI", "Demo Consumer Prices", 5),
    ("DEMO_UNRATE", "Demo Unemployment Rate", 2), ("DEMO_FEDFUNDS", "Demo Policy Rate", 2),
    ("DEMO_10Y", "Demo 10-Year Yield", 2), ("DEMO_PAYROLLS", "Demo Nonfarm Payrolls", 5),
    ("DEMO_HOUSING", "Demo Housing Starts", 4), ("DEMO_OIL", "Demo Crude Spot", 5),
    ("DEMO_GOLD", "Demo Gold Spot", 5), ("DEMO_M2", "Demo Money Supply", 5),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dsn", required=True)
    ap.add_argument("--quarters", type=int, default=12, help="quarters of 13F history")
    args = ap.parse_args()

    rng = random.Random(SEED)
    today = date.today()

    with psycopg.connect(args.dsn, autocommit=False) as conn:
        cur = conn.cursor()
        cur.execute("SELECT permaticker, ticker, name, sector FROM tickers ORDER BY ticker")
        issuers = [{"permaticker": int(p), "ticker": t, "name": n, "sector": s}
                   for p, t, n, s in cur.fetchall()]
        if not issuers:
            print("  no tickers — run generate_demo_data.py first")
            return 1
        cur.execute("SELECT ticker, max(close) FROM sep GROUP BY ticker")
        px = {t: float(c) for t, c in cur.fetchall()}
        print(f"  {len(issuers)} issuers")

        # ---------- sf2: insider transactions --------------------------------
        # `sharesownedfollowingtransaction` is a running balance scoped to one *account*
        # (directorindirect x natureofownership), and the holdings charts read it as such.
        # So each insider gets 1-2 accounts and a balance that is carried forward in date
        # order — random per-row balances would render as noise rather than a holdings line.
        rows = []
        for i in issuers:
            for _ in range(rng.randint(4, 9)):                    # named insiders
                title = rng.choice(TITLES)
                person = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
                accounts = [("D", None)]
                if rng.random() < 0.35:
                    accounts.append(("I", rng.choice(NATURES)))
                for di, nature in accounts:
                    bal = rng.randint(20_000, 900_000)
                    dates = sorted(today - timedelta(days=rng.randint(1, 900))
                                   for _ in range(rng.randint(3, 10)))
                    for d in dates:
                        code = rng.choice(["P", "S", "S", "A", "M"])  # buy/sell/award/exercise
                        shares = rng.randint(500, min(60_000, max(1_000, bal // 4)))
                        signed = shares if code in ("P", "A", "M") else -shares
                        before, bal = bal, max(0, bal + signed)
                        price = px.get(i["ticker"], 50) * rng.uniform(0.7, 1.2)
                        # 'D%' security codes are options/RSUs and carry their own balances;
                        # the holdings query keeps only the 'N%' common-stock pool.
                        adcode = ("D-Stock Option" if code == "M" and rng.random() < 0.4
                                  else "N-Common Stock")
                        rows.append((
                            i["ticker"], d + timedelta(days=2), "4", i["name"], person, title,
                            title == "Director", title != "Director", rng.random() < 0.05,
                            d, code, before, signed, bal, round(price, 2),
                            round(abs(signed) * price, 2), "Common Stock", adcode, di,
                            nature, i["permaticker"]))
        cur.executemany(
            "INSERT INTO sf2 (ticker,filingdate,formtype,issuername,ownername,officertitle,"
            "isdirector,isofficer,istenpercentowner,transactiondate,transactioncode,"
            "sharesownedbeforetransaction,transactionshares,sharesownedfollowingtransaction,"
            "transactionpricepershare,transactionvalue,securitytitle,securityadcode,"
            "directorindirect,natureofownership,permaticker)"
            " VALUES (" + ",".join(["%s"] * 21) + ")" + " ON CONFLICT DO NOTHING", rows)
        print(f"  sf2 (insiders): {len(rows):,}")

        # ---------- sf3 / sf3a / sf3b: 13F holdings --------------------------
        quarters = [date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
                    - timedelta(days=92 * q) for q in range(args.quarters)]
        quarters = [q.replace(day=1) for q in quarters]
        sf3, sf3a, sf3b = [], [], []
        for q in quarters:
            per_investor: dict[str, float] = {inv: 0.0 for inv in INVESTORS}
            for i in issuers:
                holders = rng.sample(INVESTORS, rng.randint(3, 12))
                tot_val = 0.0
                for inv in holders:
                    units = rng.randint(10_000, 3_000_000)
                    price = px.get(i["ticker"], 50) * rng.uniform(0.8, 1.15)
                    val = units * price
                    tot_val += val
                    per_investor[inv] += val
                    sf3.append((i["ticker"], inv, "SHR", q, val, units,
                                round(price, 2), i["permaticker"]))
                sf3a.append((q, i["ticker"], i["name"], len(holders),
                             sum(rng.randint(10_000, 3_000_000) for _ in holders),
                             tot_val, tot_val, i["permaticker"]))
            grand = sum(per_investor.values()) or 1.0
            for inv, v in per_investor.items():
                sf3b.append((q, inv, rng.randint(20, 90), int(v / 40), v, v,
                             100.0 * v / grand))
        cur.executemany(
            "INSERT INTO sf3 (ticker,investorname,securitytype,calendardate,value,units,"
            "price,permaticker) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", sf3)
        cur.executemany(
            "INSERT INTO sf3a (calendardate,ticker,name,shrholders,shrunits,shrvalue,"
            "totalvalue,permaticker) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", sf3a)
        cur.executemany(
            "INSERT INTO sf3b (calendardate,investorname,shrholdings,shrunits,shrvalue,"
            "totalvalue,percentoftotal) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", sf3b)
        print(f"  sf3: {len(sf3):,} | sf3a: {len(sf3a):,} | sf3b: {len(sf3b):,}")

        # ---------- metrics: 52w band, moving averages ------------------------
        met = []
        for i in issuers:
            p = px.get(i["ticker"], 50)
            met.append((i["ticker"], today, p * rng.uniform(1.05, 1.9),
                        p * rng.uniform(0.45, 0.92), p, p * rng.uniform(0.9, 1.1),
                        p * rng.uniform(0.85, 1.15), rng.uniform(0.4, 2.2),
                        rng.uniform(0.0, 0.05), rng.uniform(-0.4, 0.9),
                        int(rng.uniform(1e5, 5e6)), i["permaticker"]))
        cur.executemany(
            "INSERT INTO metrics (ticker,date,high52w,low52w,price,ma50d,ma200d,beta1y,"
            "dividendyieldtrailing,return1y,volumeavg3m,permaticker)"
            " VALUES (" + ",".join(["%s"] * 12) + ")" + " ON CONFLICT DO NOTHING", met)
        print(f"  metrics: {len(met):,}")

        # ---------- actions / events -----------------------------------------
        acts, evs = [], []
        for i in issuers:
            for _ in range(rng.randint(2, 8)):
                d = today - timedelta(days=rng.randint(30, 1500))
                a = rng.choice(["dividend", "split", "dividend", "dividend"])
                acts.append((d, a, i["ticker"], i["name"],
                             round(rng.uniform(0.05, 1.2), 2) if a == "dividend" else 2.0,
                             i["permaticker"]))
            for _ in range(rng.randint(4, 14)):
                evs.append((i["ticker"], today - timedelta(days=rng.randint(1, 1200)),
                            rng.choice(["21", "13", "11", "21|13", "31", "44", "51"]), i["permaticker"]))
        cur.executemany("INSERT INTO actions (date,action,ticker,name,value,permaticker)"
                        " VALUES (%s,%s,%s,%s,%s,%s)" + " ON CONFLICT DO NOTHING", acts)
        cur.executemany("INSERT INTO events (ticker,date,eventcodes,permaticker)"
                        " VALUES (%s,%s,%s,%s)" + " ON CONFLICT DO NOTHING", evs)
        print(f"  actions: {len(acts):,} | events: {len(evs):,}")

        # ---------- sp500 membership -----------------------------------------
        # Sharadar records membership as `historical` snapshots plus a `current` set —
        # NOT "added"/"removed" events. The concentration build filters on exactly those
        # two action values, so any other wording produces an empty frame and the derived
        # rebuild then fails creating an index on a table with no columns.
        members = rng.sample(issuers, min(120, len(issuers)))
        cur.execute("SELECT DISTINCT date FROM daily ORDER BY date")
        daily_dates = [d for (d,) in cur.fetchall()]
        snaps = daily_dates[::3]                     # quarterly-ish, and joinable to daily
        sp = []
        for d in snaps:
            for m in members:
                sp.append((d, "historical", m["ticker"], m["name"], m["permaticker"]))
        for m in members:
            sp.append((daily_dates[-1], "current", m["ticker"], m["name"], m["permaticker"]))
        cur.executemany("INSERT INTO sp500 (date,action,ticker,name,permaticker)"
                        " VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", sp)
        print(f"  sp500: {len(sp):,} ({len(snaps)} snapshots x {len(members)} members)")

        # ---------- sfp: a handful of invented funds --------------------------
        # Every two-letter ticker AA..ZZ exists as a fund as well as a company, so any
        # two-character lookup resolves on the ETF side too. They are spread over eight
        # invented issuers (a shared CIK each) so the fund-family panel has real siblings.
        ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        FAMILIES = ["Demo Broad", "Demo Technology", "Demo Small Cap", "Demo International",
                    "Demo High Yield", "Demo Aggregate", "Demo Commodity", "Demo Gold"]
        funds = []
        for n, (a, b) in enumerate((a, b) for a in ALPHA for b in ALPHA):
            fam = n % len(FAMILIES)
            funds.append((a + b, f"{FAMILIES[fam]} {a}{b} Fund", str(8000001 + fam)))
        cur.executemany(
            'INSERT INTO tickers (permaticker, ticker, "table", name, exchange, isdelisted,'
            ' category, currency, secfilings)'
            " VALUES (%s,%s,'SFP',%s,'NYSEARCA','N','ETF','USD',%s)"
            " ON CONFLICT DO NOTHING",
            [(str(950000 + n), t, nm, f"{EDGAR}{cik}")
             for n, (t, nm, cik) in enumerate(funds)])
        # The family panel reads the SEC series/class map: one series per fund, with an
        # A/I share-class pair.
        classes = []
        for n, (t, _nm, cik) in enumerate(funds):
            for c, suffix in enumerate(("", "I")):
                classes.append((int(cik), f"S{950000 + n:09d}",
                                f"C{950000 + n:06d}{c:03d}", t + suffix))
        cur.executemany(
            "INSERT INTO sec_fund_class (cik,series_id,class_id,symbol)"
            " VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", classes)
        days = [today - timedelta(days=d) for d in range(3 * 365, 0, -1)]
        days = [d for d in days if d.weekday() < 5]
        sfp_sql = ("INSERT INTO sfp (ticker,date,open,high,low,close,volume,closeadj,"
                   "closeunadj,permaticker) VALUES (" + ",".join(["%s"] * 10) + ")"
                   " ON CONFLICT DO NOTHING")
        frows, n_sfp = [], 0
        for n, (t, _nm, _cik) in enumerate(funds):
            p = rng.uniform(25, 180)
            for d in days:
                p = max(1.0, p * (1 + rng.gauss(0.0003, 0.011)))
                frows.append((t, d, round(p, 2), round(p * 1.01, 2), round(p * 0.99, 2),
                              round(p, 2), int(rng.uniform(1e5, 3e6)), round(p, 2),
                              round(p, 2), 950000 + n))
            if len(frows) >= 50_000:
                cur.executemany(sfp_sql, frows); n_sfp += len(frows); frows.clear()
        if frows:
            cur.executemany(sfp_sql, frows); n_sfp += len(frows); frows.clear()
        print(f"  sfp: {n_sfp:,} rows across {len(funds)} funds")

        # ---------- event_codes: the legend the events tab joins against -------
        cur.executemany(
            "INSERT INTO event_codes (code,title,description) VALUES (%s,%s,%s)"
            " ON CONFLICT DO NOTHING", EVENT_CODES)
        print(f"  event_codes: {len(EVENT_CODES)}")

        # ---------- FRED macro -------------------------------------------------
        cur.executemany(
            "INSERT INTO fred_series (series_id,dataset,tcode,title) VALUES (%s,'DEMO-MD',%s,%s)"
            " ON CONFLICT DO NOTHING",
            [(sid, tc, title) for sid, title, tc in SERIES])
        months = [date(today.year, today.month, 1) - timedelta(days=30 * m)
                  for m in range(12 * 25)]
        months = sorted({m.replace(day=1) for m in months})
        obs = []
        for sid, _, _ in SERIES:
            v = rng.uniform(50, 250)
            for m in months:
                v = max(0.1, v * (1 + rng.gauss(0.002, 0.02)))
                obs.append((sid, m, round(v, 4), "current"))
        cur.executemany(
            "INSERT INTO fred_observations (series_id,date,value,vintage)"
            " VALUES (%s,%s,%s,%s)" + " ON CONFLICT DO NOTHING", obs)
        print(f"  fred_series: {len(SERIES)} | fred_observations: {len(obs):,}")

        # ---------- FINRA short interest ---------------------------------------
        settle = [today - timedelta(days=15 * s) for s in range(48)]
        si = []
        for i in issuers:
            prev = rng.randint(50_000, 4_000_000)
            for d in settle:
                cur_s = max(1000, int(prev * rng.uniform(0.85, 1.18)))
                adv = rng.randint(80_000, 3_000_000)
                si.append((i["ticker"], i["name"], d, "NYSE", cur_s, prev,
                           cur_s - prev, 100.0 * (cur_s - prev) / prev,
                           adv, round(cur_s / adv, 2)))
                prev = cur_s
        cur.executemany(
            "INSERT INTO finra_short_interest (symbol,issue_name,settlementdate,market,"
            "current_short,previous_short,change_short,change_pct,avg_daily_vol,days_to_cover)"
            " VALUES (" + ",".join(["%s"] * 10) + ")" + " ON CONFLICT DO NOTHING", si)
        print(f"  finra_short_interest: {len(si):,}")

        # ---------- bookkeeping: what a real ingest would have left behind -----
        # Not user-facing, but the setup page and the incremental loaders read these,
        # and an empty sync_state makes a demo look like a database that never ran.
        # Counted, not assumed: the row totals below feed the setup page.
        stamps = []
        for t in ("tickers", "sep", "sf1", "sf2", "sf3", "sf3a", "sf3b", "daily", "sfp",
                  "metrics", "actions", "events", "sp500", "fred_observations",
                  "finra_short_interest"):
            cur.execute(f"SELECT count(*) FROM {t}")
            stamps.append((t, cur.fetchone()[0]))
        cur.executemany(
            "INSERT INTO sync_state (table_name,last_updated_date,last_run,rows_loaded)"
            " VALUES (%s,%s,%s,%s) ON CONFLICT (table_name) DO UPDATE SET"
            " last_updated_date=EXCLUDED.last_updated_date, last_run=EXCLUDED.last_run,"
            " rows_loaded=EXCLUDED.rows_loaded",
            [(t, today, datetime.combine(today, dtime(6, 15)), n) for t, n in stamps])
        cur.executemany(
            "INSERT INTO load_log (source,dataset,operation,status,rows,requested_at,"
            "completed_at,detail) VALUES (%s,%s,'sync','ok',%s,%s,%s,%s)",
            [("demo", t, n, datetime.combine(today, dtime(6, 0)),
              datetime.combine(today, dtime(6, 15)), "generated demo data")
             for t, n in stamps])
        cur.executemany(
            "INSERT INTO permaticker_lookup (product,ticker,permaticker)"
            " VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            [("SEP", i["ticker"], i["permaticker"]) for i in issuers]
            + [("SFP", t, 950000 + n) for n, (t, _nm, _c) in enumerate(funds)])
        cur.executemany(
            "INSERT INTO fred_files (path,dataset,kind,vintage,source_url,sha256,n_bytes,"
            "requested_at,content_updated_at) VALUES (%s,'DEMO-MD','vintage',%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT DO NOTHING",
            [(f"core/data/fred/demo-md/{v}.csv", v,
              f"https://example.invalid/fred/demo-md/{v}.csv",
              f"{rng.getrandbits(256):064x}", rng.randint(180_000, 260_000),
              datetime.combine(today, dtime(6, 0)), datetime.combine(today, dtime(6, 1)))
             for v in (f"{today.year}-{m:02d}" for m in range(1, 7))])
        cur.execute(
            "INSERT INTO report (name,tool,spec,created_at,updated_at)"
            " VALUES (%s,'screener',%s,%s,%s) ON CONFLICT DO NOTHING",
            ("Demo saved report", json.dumps({"note": "example screener report"}),
             datetime.combine(today, dtime(6, 0)), datetime.combine(today, dtime(6, 0))))
        print("  bookkeeping: sync_state, load_log, permaticker_lookup, fred_files, report")

        conn.commit()
    print("  committed — rebuild derived tables next")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
