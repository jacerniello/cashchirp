"""Generate a small, entirely fake dataset into an empty demo database.

    python demo/generate_demo_data.py --dsn postgresql://user:pw@host/demo [--tickers 300]

The point is to demo the app without exposing licensed or real data. **Nothing here comes
from Sharadar or FRED** — every ticker, price and financial is drawn from a seeded RNG, so
the output is reproducible, obviously synthetic, and safe to publish.

It writes only the tables the UI actually reads. The rest of the schema stays empty, which
the app handles: pages whose data is absent degrade rather than hang.

Scale is deliberate. The droplet this runs on has 1 vCPU and ~1 GB of RAM, so the target is
a few hundred MB, not the ~47 GB the real mirror occupies: ~300 issuers, 5 years of daily
bars, 8 years of quarterly fundamentals.
"""
from __future__ import annotations

import argparse
import random
from datetime import date, timedelta

import psycopg

SEED = 20260831           # reproducible: the same demo every rebuild
QUALITY_SHARE = 0.10      # fraction shaped to pass the example screen

SECTORS = {
    "Technology": ["Software - Application", "Semiconductors", "Information Technology Services"],
    "Healthcare": ["Medical Devices", "Diagnostics & Research", "Healthcare Plans"],
    "Financial Services": ["Banks - Regional", "Asset Management", "Insurance - Property & Casualty"],
    "Consumer Cyclical": ["Specialty Retail", "Restaurants", "Auto Parts"],
    "Consumer Defensive": ["Packaged Foods", "Household & Personal Products", "Grocery Stores"],
    "Industrials": ["Specialty Industrial Machinery", "Building Products & Equipment", "Trucking"],
    "Energy": ["Oil & Gas E&P", "Oil & Gas Midstream"],
    "Basic Materials": ["Specialty Chemicals", "Steel"],
    "Utilities": ["Utilities - Regulated Electric"],
    "Real Estate": ["REIT - Industrial", "REIT - Retail"],
    "Communication Services": ["Telecom Services", "Entertainment"],
}
# Obviously-fake names: nobody should mistake a demo row for a real company.
PREFIX = ["Aurora", "Bastion", "Cobalt", "Dovetail", "Ember", "Fathom", "Granite", "Harbor",
          "Ironwood", "Juniper", "Kestrel", "Lantern", "Meridian", "Northwind", "Obsidian",
          "Pinnacle", "Quarry", "Redwood", "Summit", "Tidewater", "Umbra", "Vantage",
          "Wayfarer", "Yardarm", "Zephyr"]
SUFFIX = ["Systems", "Holdings", "Industries", "Labs", "Works", "Group", "Partners",
          "Dynamics", "Technologies", "Materials", "Networks", "Brands"]


ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
TWO_LETTER = [a + b for a in ALPHA for b in ALPHA]   # AA..ZZ, all 676


def make_issuers(n: int, rng: random.Random) -> list[dict]:
    """`n` issuers, the first 676 of which carry every two-letter ticker AA..ZZ.

    Exhausting the two-letter space means any two-character search or deep link in the
    demo resolves to a company instead of a dead end; the remainder get random 3-4
    letter symbols so the universe still looks like a real one."""
    seen: set[str] = set(TWO_LETTER[:n])
    out = []
    for i in range(n):
        if i < len(TWO_LETTER):
            t = TWO_LETTER[i]
        else:
            while True:
                t = "".join(rng.choices(ALPHA, k=rng.choice([3, 4])))
                if t not in seen:
                    seen.add(t)
                    break
        # A deliberate minority are drawn to SATISFY the example quality-value screen.
        # Twelve independent random gates essentially never align, so without this the
        # demo's idea board is empty — which reads as broken rather than as fake data.
        quality = rng.random() < QUALITY_SHARE
        sector = rng.choice([x for x in SECTORS if x not in ("Energy", "Basic Materials")]
                            if quality else list(SECTORS))
        # A wide market-cap spread, log-uniform, so the screener's size gates have
        # something to bite on rather than one clump.
        cap = (10 ** rng.uniform(8.6, 9.9)) if quality else (10 ** rng.uniform(8.0, 11.5))
        out.append({
            "permaticker": 900000 + i,
            "ticker": t,
            "name": f"{rng.choice(PREFIX)} {rng.choice(SUFFIX)}",
            "sector": sector,
            "industry": rng.choice(SECTORS[sector]),
            "exchange": rng.choice(["NASDAQ", "NYSE"]),
            "cap": cap,
            # Per-issuer economics, so the same company stays coherent across tables.
            "quality": quality,
            "margin": rng.uniform(0.08, 0.24) if quality else rng.uniform(-0.10, 0.30),
            "growth": rng.uniform(0.05, 0.18) if quality else rng.uniform(-0.10, 0.35),
            "roic": rng.uniform(0.15, 0.40) if quality else rng.uniform(-0.05, 0.45),
            "vol": rng.uniform(0.15, 0.65),
            "drift": rng.uniform(-0.15, 0.25),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dsn", required=True, help="postgresql://… of the EMPTY demo database")
    ap.add_argument("--tickers", type=int, default=976)   # 676 two-letter + 300
    ap.add_argument("--years-prices", type=int, default=5)
    ap.add_argument("--years-fundamentals", type=int, default=8)
    args = ap.parse_args()

    rng = random.Random(SEED)
    issuers = make_issuers(args.tickers, rng)
    today = date.today()

    with psycopg.connect(args.dsn, autocommit=False) as conn:
        cur = conn.cursor()

        # -- tickers -------------------------------------------------------
        cur.executemany(
            'INSERT INTO tickers (permaticker, ticker, "table", name, exchange, isdelisted, '
            "sector, industry, category, currency, location, firstpricedate, lastpricedate) "
            "VALUES (%s,%s,'SEP',%s,%s,'N',%s,%s,'Domestic Common Stock','USD','United States',%s,%s)",
            [(str(i["permaticker"]), i["ticker"], i["name"], i["exchange"], i["sector"],
              i["industry"], today - timedelta(days=365 * 12), today) for i in issuers])

        # -- sep: a geometric random walk per issuer -----------------------
        days = [today - timedelta(days=d) for d in range(args.years_prices * 365, 0, -1)]
        days = [d for d in days if d.weekday() < 5]
        # Flushed in chunks rather than accumulated: ~1.3M bar tuples held at once is
        # over a gigabyte of Python objects, and the droplet this runs on has ~1 GB.
        sep_sql = ("INSERT INTO sep (ticker,date,open,high,low,close,volume,closeadj,"
                   "closeunadj,permaticker) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                   " ON CONFLICT DO NOTHING")
        rows, n_sep = [], 0
        for i in issuers:
            px = 10 ** rng.uniform(0.7, 2.4)
            dd, dv = i["drift"] / 252, i["vol"] / (252 ** 0.5)
            for d in days:
                px = max(0.5, px * (1 + rng.gauss(dd, dv)))
                o, c = px * rng.uniform(0.99, 1.01), px
                rows.append((i["ticker"], d, round(o, 2), round(max(o, c) * 1.01, 2),
                             round(min(o, c) * 0.99, 2), round(c, 2),
                             int(rng.uniform(1e5, 8e6)), round(c, 2), round(c, 2),
                             i["permaticker"]))
            i["px"] = px
            if len(rows) >= 50_000:
                cur.executemany(sep_sql, rows); n_sep += len(rows); rows.clear()
        if rows:
            cur.executemany(sep_sql, rows); n_sep += len(rows); rows.clear()
        print(f"  sep: {n_sep:,} rows")

        # -- daily: valuation, one row per issuer per month ----------------
        months = sorted({d.replace(day=1) for d in days})
        drows = []
        for i in issuers:
            for m in months:
                cap = i["cap"] * rng.uniform(0.85, 1.15)
                if i["quality"]:
                    pe, evebitda = rng.uniform(9, 18), rng.uniform(5, 12)
                    ev = cap * rng.uniform(0.9, 1.15)      # little net debt
                else:
                    pe = rng.uniform(5, 45) if i["margin"] > 0 else rng.uniform(-40, -5)
                    evebitda, ev = rng.uniform(4, 30), cap * rng.uniform(1.0, 1.4)
                # Sharadar reports marketcap/ev in MILLIONS and the snapshot scales by
                # 1e6 — writing dollars here makes every size gate fail by a factor of a
                # million, which looks like "nothing passes the screen" rather than a
                # units bug.
                drows.append((i["ticker"], m, cap / 1e6, ev / 1e6, pe, evebitda,
                              rng.uniform(0.5, 8), rng.uniform(0.8, 12),
                              rng.uniform(5, 35), i["permaticker"]))
        cur.executemany(
            "INSERT INTO daily (ticker,date,marketcap,ev,pe,evebitda,ps,pb,evebit,permaticker)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)" + " ON CONFLICT DO NOTHING", drows)
        print(f"  daily: {len(drows):,} rows")

        # -- sf1: the three dimensions the snapshot reads ------------------
        # ARQ (as-reported quarterly), ART (trailing twelve months) and ARY (annual) are
        # all consumed by screener._snapshot_sql. Omitting ARQ leaves the quarter-over-
        # quarter growth columns entirely NULL, which the derivation then trips over —
        # so a demo dataset has to cover every dimension the real one does.
        frows = []
        for i in issuers:
            rev = i["cap"] * rng.uniform(0.2, 1.5)
            for q in range(args.years_fundamentals * 4):
                cd = today - timedelta(days=90 * q)
                rev_q = rev * (1 + i["growth"]) ** (-q / 4) / 4
                ni = rev_q * i["margin"]
                eq = max(1e6, rev_q * rng.uniform(1.0, 4.0))
                assets = eq * (rng.uniform(1.15, 1.5) if i["quality"] else rng.uniform(1.4, 3.0))
                # Quality names shrink their share count (buybacks) going forward, so the
                # no-dilution gate passes; q counts BACKWARDS from today.
                shares = max(1e5, i["cap"] / 40) * ((1 + 0.02 * q) if i["quality"] else 1.0)
                liabilities = assets - eq
                debt = liabilities * (rng.uniform(0.05, 0.3) if i["quality"]
                                      else rng.uniform(0.1, 0.7))
                for dim in ("ARQ", "ART", "ARY"):
                    mult = {"ARQ": 1, "ART": 4, "ARY": 4}[dim]
                    frows.append((
                        i["ticker"], dim, cd, cd + timedelta(days=45), cd,
                        f"{cd.year}-Q{((cd.month - 1)//3)+1}",
                        rev_q * mult, ni * mult, ni * mult / max(1e5, i["cap"] / 40),
                        eq, assets, debt,
                        ni * mult * (rng.uniform(1.0, 1.5) if i["quality"]
                                     else rng.uniform(0.6, 1.6)),
                        i["roic"], i["margin"],
                        rng.uniform(0.30, 0.70) if i["quality"] else rng.uniform(0.15, 0.75),
                        debt / eq,                       # de -> debt_equity
                        eq * rng.uniform(0.05, 0.35),    # cashneq -> net cash / p_cash
                        # Share count drifts DOWN for quality names (buybacks) so the
                        # no-dilution gate passes; the lag is what the 5y test compares.
                        shares, shares,                  # shareswa, shareswadil
                        # Altman-Z inputs. Without these the screener's survivability gate
                        # is NULL for every row and nothing can ever pass it — the demo
                        # would show an empty idea board and look broken rather than fake.
                        assets - liabilities * rng.uniform(0.3, 0.8),   # workingcapital
                        eq * rng.uniform(0.2, 0.9),                     # retearn
                        ni * mult * rng.uniform(1.1, 2.0),              # ebit
                        liabilities,
                        i["permaticker"]))
        cur.executemany(
            "INSERT INTO sf1 (ticker,dimension,calendardate,datekey,reportperiod,fiscalperiod,"
            "revenue,netinc,eps,equity,assets,debt,fcf,roic,netmargin,grossmargin,de,cashneq,"
            "shareswa,shareswadil,workingcapital,retearn,ebit,liabilities,permaticker)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)" + " ON CONFLICT DO NOTHING",
            frows)
        print(f"  sf1: {len(frows):,} rows")

        conn.commit()
    print("  committed — now rebuild derived tables:")
    print("    python -m core.scripts.setup.bootstrap --only-phase derived --force")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
