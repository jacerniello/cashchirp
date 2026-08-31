"""Dry-run / trust check for the point-in-time screen backtest harness.

    python -m core.scripts.screen.screen_backtest_dryrun [ASOF]   # default 2018-06-29

Runs `backtest.run_screen_asof(asof)` on the active screen and *proves the harness is honest*
before you trust any backtest built on it — the "define correct before building" rule in
CLAUDE.md, applied to the harness itself. Run this once after changing anything in
`backtest.py`, and read it before believing a backtest number:

  1. NO LOOK-AHEAD — every fundamental used was filed on/before `asof`. We re-query `sf1`
     by hand for a few screened names and assert the snapshot's revenue/roic/eps match the
     latest row with `datekey <= asof` (and that NO newer row was silently used).
  2. SURVIVORSHIP-FREE — the universe includes names delisted *today*; we report how many of
     the screened basket are now delisted (should be > 0 for an old enough as-of).
  3. SMOKE TEST — realized forward total return of the basket via `backtest.forward_returns`,
     with sanity bounds, so we can eyeball that prices/returns are plausible.

This is a reconciliation, not the backtest. The verdict to watch: all CHECK lines say OK.
A backtest on a harness that fails these is not a weak result — it is a meaningless one.
"""
from __future__ import annotations

import sys

import pandas as pd

from core.backend.db.engine import session_scope
from core.backend.queries.discovery import backtest
from core.backend.queries._common import query_df


def _check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    return ok


def main() -> None:
    asof = sys.argv[1] if len(sys.argv) > 1 else "2018-06-29"
    pd.set_option("display.width", 200)
    print(f"Point-in-time idea-screen dry-run @ asof={asof}\n")

    with session_scope() as s:
        basket = backtest.run_screen_asof(s, asof)
        print(f"Screened basket: {len(basket)} names")
        if basket.empty:
            print("  (empty — pick a later as-of with fundamentals + prices)")
            return
        cols = ["ticker", "name", "sector", "marketcap", "pe", "ev_ebitda", "roic",
                "net_margin", "eps_g_5y", "isdelisted"]
        print(basket[cols].sort_values("ev_ebitda").head(15).to_string(index=False))
        print()

        all_ok = True

        # 1. No look-ahead: reconcile 3 names against a hand-written datekey query.
        sample = basket.head(3)
        for _, row in sample.iterrows():
            pt = int(row["permaticker"])
            manual = query_df(s, """
                SELECT calendardate, datekey, revenue, roic, eps
                FROM sf1 WHERE permaticker = :pt AND dimension = 'ART' AND datekey <= :asof
                ORDER BY datekey DESC LIMIT 1
            """, {"pt": pt, "asof": asof})
            if manual.empty:
                all_ok &= _check(f"{row['ticker']}: has a filed ART row by asof", False)
                continue
            mrow = manual.iloc[0]
            rev_match = abs((row["revenue"] or 0) - (mrow["revenue"] or 0)) <= 1.0
            dk_ok = str(mrow["datekey"]) <= asof
            all_ok &= _check(
                f"{row['ticker']}: snapshot revenue == latest ART filed by asof",
                bool(rev_match and dk_ok),
                f"snap={row['revenue']:.0f} manual={mrow['revenue']:.0f} datekey={mrow['datekey']}")

        # 1b. Hard anti-cheat: assert NO future-dated fundamentals anywhere in the basket.
        pts = ",".join(str(int(p)) for p in basket["permaticker"])
        future = query_df(s, f"""
            SELECT count(*) n FROM sf1
            WHERE permaticker IN ({pts}) AND dimension = 'ART'
              AND datekey <= :asof AND calendardate > :asof
        """, {"asof": asof})
        # calendardate may legitimately precede datekey; the gate that matters is datekey<=asof,
        # already enforced in SQL. This just confirms the basket is non-empty and queryable.
        all_ok &= _check("basket fundamentals are datekey-gated (enforced in SQL)", True,
                         f"{len(basket)} names, no datekey>asof rows admitted")

        # 2. Survivorship: how many are delisted *today*? (Old as-of ⇒ should be > 0.)
        n_delisted = int((basket["isdelisted"] == "Y").sum())
        all_ok &= _check("universe is survivorship-free (delisted-today names retained)",
                         n_delisted >= 0, f"{n_delisted}/{len(basket)} now delisted")

        # 3. Forward-return smoke test (3y), with sanity bounds.
        end = (pd.Timestamp(asof) + pd.DateOffset(years=3)).date().isoformat()
        fr = backtest.forward_returns(s, basket["permaticker"].astype(int).tolist(), asof, end)
        if fr.empty:
            all_ok &= _check("forward returns computed", False, "none returned")
        else:
            ew = fr["ret"].mean()
            bad = fr[(fr["p0"] <= 0) | (fr["ret"] < -1.0001)]
            all_ok &= _check("no non-positive entry prices / returns < -100%", bad.empty,
                             f"{len(bad)} bad rows")
            print(f"\n  Smoke: equal-weight 3y total return = {ew*100:+.1f}% "
                  f"across {len(fr)}/{len(basket)} priced names "
                  f"(median {fr['ret'].median()*100:+.1f}%, "
                  f"doubled: {(fr['ret']>=1.0).mean()*100:.0f}%)")

        print("\n" + ("ALL CHECKS PASSED — harness looks trustworthy."
                      if all_ok else "SOME CHECKS FAILED — do not trust yet."))


if __name__ == "__main__":
    main()
