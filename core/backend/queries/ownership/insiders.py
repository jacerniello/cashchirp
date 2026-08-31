"""Insider transactions (`sf2`) — SEC Form 3/4/5 filings.

One row per insider transaction. Lookups by permaticker for a company, or a global
"recent activity" feed. `transactioncode` (P=buy, S=sell, …) and `transactionvalue`
are the signal-rich fields.
"""
from __future__ import annotations

import hashlib

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.backend.db.engine import engine
from core.backend.queries._common import query_df, rows, scalar
from core.backend.queries._rebuild import LOCK_INSIDERS, NEW, live_count, single_flight, swap_in

_COLS = (
    "filingdate, transactiondate, ownername, officertitle, isdirector, isofficer, "
    "istenpercentowner, transactioncode, securityadcode, transactionshares, "
    "transactionpricepershare, transactionvalue, sharesownedbeforetransaction, "
    "sharesownedfollowingtransaction, securitytitle, directorindirect"
)

# SEC Form 4 `transactioncode` → human label. P/S (open-market buy/sell) are the real
# sentiment signal; M/A/F/G/X etc. are mostly compensation mechanics, not conviction.
TRANSACTION_CODE_LABELS = {
    "P": "Open-market buy", "S": "Open-market sale", "A": "Grant / award",
    "M": "Option exercise", "X": "Option exercise", "C": "Conversion",
    "F": "Tax withholding", "G": "Gift", "D": "Sale to issuer", "W": "Will / inheritance",
    "J": "Other (acquire)", "K": "Other (dispose)", "V": "Voluntary report",
}


def for_security(
    session: Session, permaticker: int | str, limit: int = 500
) -> pd.DataFrame:
    """Insider transactions for one company. LEFT JOINs the daily *raw* close
    (`sep.closeunadj`) on the transaction date so `fill_value` can value grants/option
    exercises (which the filing reports with no price) at the as-traded market price —
    raw, to match the as-filed (unadjusted) share counts."""
    return query_df(
        session,
        f"SELECT {_COLS}, sep.closeunadj AS mkt_close FROM sf2 "
        "LEFT JOIN sep ON sep.permaticker = sf2.permaticker "
        "AND sep.date = sf2.transactiondate "
        "WHERE sf2.permaticker = :pt "
        "ORDER BY sf2.transactiondate DESC NULLS LAST, sf2.filingdate DESC LIMIT :limit",
        {"pt": int(permaticker), "limit": limit},
    )


def fill_value(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Best-effort transaction $ value, returned as (value, estimated_mask).

    Form 4 leaves `transactionvalue` blank for grants, option exercises and gifts (no
    cash at market), which otherwise makes 'acquired' read as a pile of zeros. We fall
    back to |shares| × (reported price, else market close on the trade date). The mask
    flags rows whose value is imputed, so the UI can label them rather than imply the
    filing reported a dollar figure."""
    reported = pd.to_numeric(df["transactionvalue"], errors="coerce")
    shares = pd.to_numeric(df["transactionshares"], errors="coerce").abs()
    price = pd.to_numeric(df["transactionpricepershare"], errors="coerce")
    if "mkt_close" in df.columns:
        price = price.where(price.notna(), pd.to_numeric(df["mkt_close"], errors="coerce"))
    use_est = reported.isna() | (reported == 0)
    value = reported.where(~use_est, shares * price)
    return value, (use_est & value.notna())


def company_monthly_flow(session: Session, permaticker: int | str,
                         limit: int = 5000) -> list[dict]:
    """Monthly net insider $ flow for a company (acquired − disposed), valued at market
    where the filing reports no price (so RSU vesting / option exercises aren't counted as
    $0). Sign from the last char of `securityadcode` (A/D) — the same signal the rollup
    uses. Powers the "Net insider flow (monthly)" bar chart. Returns [{month, net}]."""
    df = for_security(session, permaticker, limit=limit)
    if df.empty:
        return []
    value, _ = fill_value(df)
    adc = df["securityadcode"].astype("string").str.strip().str.upper()
    sign = pd.Series(0.0, index=df.index)
    sign[adc.str.endswith("A").fillna(False)] = 1.0
    sign[adc.str.endswith("D").fillna(False)] = -1.0
    d = pd.DataFrame({
        "date": pd.to_datetime(df["transactiondate"], errors="coerce"),
        "signed": value.fillna(0.0) * sign,
    }).dropna(subset=["date"])
    if d.empty:
        return []
    g = d.assign(month=d["date"].dt.to_period("M").dt.to_timestamp()).groupby("month")["signed"].sum()
    return [{"month": m.strftime("%Y-%m"), "net": float(v)} for m, v in g.items()]


def _split_factors(session: Session, permaticker: int | str,
                   dates: "pd.Series") -> "pd.Series":
    """Per-date split factor (× product of split ratios *after* that date) for a security."""
    splits = query_df(
        session,
        "SELECT date, value FROM actions "
        "WHERE permaticker = :pt AND action ILIKE '%split%' AND value > 0",
        {"pt": int(permaticker)},
    )
    if splits.empty:
        return pd.Series(1.0, index=dates.index)
    sdate = pd.to_datetime(splits["date"])
    sval = splits["value"].astype(float)
    return pd.Series(
        [float(sval[sdate > q].prod()) if (sdate > q).any() else 1.0 for q in dates],
        index=dates.index,
    )


_POOL_LABEL = {"D": "Direct", "I": "Indirect"}

# Non-derivative common-stock EOD balance per *account* (directorindirect +
# natureofownership) per date. Each named trust/partnership/LLC is a SEPARATE running
# balance — an insider can hold a name through a dozen of them (e.g. Jensen Huang's NVDA
# stake spans many trusts + partnerships). Keying the pivot on the account (not just D/I)
# is what stops the summed line from dropping when one account reports and the others hold.
_HOLDINGS_SQL = """
    SELECT DISTINCT ON ({distinct} directorindirect, natureofownership, transactiondate)
        {extra} directorindirect AS di,
        coalesce(natureofownership, '') AS nature,
        transactiondate, sharesownedfollowingtransaction AS shares
    FROM sf2
    WHERE {where}
      AND securityadcode LIKE 'N%'
      AND transactiondate IS NOT NULL
      AND sharesownedfollowingtransaction IS NOT NULL
    ORDER BY {order} directorindirect, natureofownership, transactiondate, id DESC
"""


def _pts(series: "pd.Series") -> list[dict]:
    return [{"date": d.strftime("%Y-%m-%d"), "shares": float(v)}
            for d, v in series.items() if pd.notna(v)]


def _prep_accounts(df: pd.DataFrame, session: Session, permaticker: int | str) -> pd.DataFrame:
    """Normalise a holdings query: parse dates, split-adjust each balance, and stamp each
    row with its `account` (di+nature, a distinct running balance) and display `pool`."""
    df = df.copy()
    df["transactiondate"] = pd.to_datetime(df["transactiondate"], errors="coerce")
    df["shares"] = pd.to_numeric(df["shares"], errors="coerce")
    df = df.dropna(subset=["transactiondate", "shares"])
    if df.empty:
        return df
    df["shares"] = df["shares"] * _split_factors(session, permaticker, df["transactiondate"])
    df["account"] = df["di"].astype(str) + "|" + df["nature"].astype(str)
    df["pool"] = df["di"].map(lambda x: _POOL_LABEL.get(str(x), "Indirect"))
    return df


def _account_pivot(df: pd.DataFrame) -> pd.DataFrame:
    """One carried-forward column per account, over the union of dates."""
    return (df.pivot_table(index="transactiondate", columns="account", values="shares",
                           aggfunc="last").sort_index().ffill())


def _total_points(df: pd.DataFrame) -> list[dict]:
    """Total holdings = every account carried forward and summed, as [{date, shares}]."""
    if df.empty:
        return []
    return _pts(_account_pivot(df).sum(axis=1, min_count=1).dropna())


def _pool_series(df: pd.DataFrame) -> list[dict]:
    """Labelled `Direct` / `Indirect` series (each = the sum of that pool's accounts
    carried forward), plus a `Total` line when both pools are present."""
    if df.empty:
        return []
    piv = _account_pivot(df)
    acct_pool = dict(zip(df["account"], df["pool"]))
    sums: dict[str, "pd.Series"] = {}
    for label in ("Direct", "Indirect"):
        cols = [c for c in piv.columns if acct_pool.get(c) == label]
        if cols:
            s = piv[cols].sum(axis=1, min_count=1).dropna()
            if not s.empty:
                sums[label] = s
    series: list[dict] = []
    if len(sums) > 1:
        series.append({"pool": "Total", "points": _pts(piv.sum(axis=1, min_count=1).dropna())})
    for label in ("Direct", "Indirect"):
        if label in sums:
            series.append({"pool": label, "points": _pts(sums[label])})
    return series


def owner_company_holdings(session: Session, owner_id: str,
                          permaticker: int | str) -> list[dict]:
    """Split-adjusted common-stock holdings for ONE insider in ONE company, broken out by
    ownership pool (the per-company chart on the insider page). Non-derivative common stock
    only, end-of-day balance per *account* (directorindirect + natureofownership) per date.

    Returns labelled series: `Direct` and/or `Indirect` (each = that pool's accounts
    carried forward and summed), plus `Total` when both exist. Building on accounts (not a
    single D/I bucket) keeps multi-trust indirect holdings continuous instead of dropping
    when one trust reports while the others hold."""
    owner = resolve_owner(session, owner_id)
    if not owner:
        return []
    df = query_df(
        session,
        _HOLDINGS_SQL.format(
            distinct="", extra="", where="permaticker = :pt AND ownername = :name", order=""),
        {"pt": int(permaticker), "name": owner["ownername"]},
    )
    return _pool_series(_prep_accounts(df, session, permaticker))


def company_insider_holdings(
    session: Session, permaticker: int | str, top_n: int = 12,
) -> list[dict]:
    """One split-adjusted **total common-stock** holdings curve per insider, for a
    company's `top_n` insiders (by net activity). Powers the Company → Insiders
    "holdings over time, line per insider" chart.

    `sharesownedfollowingtransaction` is a running balance scoped to a single *account*
    (securityadcode pool × directorindirect × natureofownership), so the curve is built
    per account or it's nonsense:
      • non-derivative common stock only — `securityadcode LIKE 'N%'` (the `D%` rows are
        options/RSUs with their own balances that would crash the line to ~0 and back);
      • the **end-of-day** balance per (account, date) — multiple trades share a date, so we
        take the chronologically-last row (`ORDER BY id DESC`);
      • every account carried forward and summed — direct + each named indirect trust /
        partnership / LLC are *separate* balances (a founder can hold a name through a dozen
        of them), so summing per-account stops the line dropping when one account reports.
    The insiders shown are the company's top `top_n` by net activity (same ranking as the
    Insiders-tab top table). Split-adjusted per report date. Names carry `owner_id` to
    deep-link to the people page; `ownership` ∈ {direct, indirect, both}."""
    top = company_top_insiders(session, permaticker, basis="all", limit=top_n)
    if top.empty:
        return []
    order = {n: i for i, n in enumerate(top["ownername"].tolist())}
    df = query_df(
        session,
        _HOLDINGS_SQL.format(
            distinct="ownername,", extra="ownername,",
            where="permaticker = :pt AND ownername = ANY(:names)", order="ownername,"),
        {"pt": int(permaticker), "names": list(order)},
    )
    df = _prep_accounts(df, session, permaticker)
    if df.empty:
        return []
    out: list[dict] = []
    for name, g in df.groupby("ownername", sort=False):
        points = _total_points(g)
        if not points:
            continue
        pools = set(g["pool"].unique())
        ownership = ("both" if {"Direct", "Indirect"} <= pools
                     else "indirect" if "Indirect" in pools else "direct")
        out.append({"owner_id": owner_id_for(name), "ownername": name,
                    "ownership": ownership, "points": points})
    out.sort(key=lambda s: order.get(s["ownername"], 1e9))
    return out


def recent(session: Session, limit: int = 300, code: str | None = None) -> pd.DataFrame:
    """Global recent insider transactions (bounded to a recent window for speed)."""
    where = ["transactionvalue IS NOT NULL"]
    params: dict = {"limit": limit}
    if code:
        where.append("transactioncode = :code"); params["code"] = code
    return query_df(
        session,
        f"""
        SELECT ticker, issuername AS name, {_COLS}
        FROM sf2
        WHERE filingdate >= (SELECT max(filingdate) FROM sf2) - INTERVAL '30 days'
          AND {' AND '.join(where)}
        ORDER BY transactionvalue DESC NULLS LAST
        LIMIT :limit
        """,
        params,
    )


# --- people (insiders as entities), precomputed in the `derived` schema ----------
# SF2 has no owner CIK — the only identifier is `ownername`. So people pages can't key
# on a vendor-stable id; instead each distinct name gets an opaque surrogate
# `owner_id` = md5(upper(name))[:12]: deterministic (stable across rebuilds, so URLs
# don't rot) and keeps the raw name out of the URL — but it inherits the name's
# ambiguity (two people sharing a name collapse to one id). Two derived tables, both
# built by `core.scripts.build.build_insiders` and documented in docs/reference/schema.md:
#
#   derived.insider          one row per insider — id, name, role flags, activity span.
#   derived.insider_company  one row per (insider, company) — transaction $ valued at
#                            market where the filing reports no price (so grants/option
#                            exercises aren't zeros), netted acquired−disposed, plus
#                            shares and the latest reported holding. This is the heavy
#                            lifting (the sep join + the netting) done once, so the
#                            company tab's stat cards / top-insiders and the people
#                            page read instantly instead of recomputing per request.
_INSIDER_TABLE = "derived.insider"
_INSIDER_CO_TABLE = "derived.insider_company"

# Best-effort $ value of a transaction, valued at market where the filing has no price.
# `right(securityadcode,1)` is 'A' (acquired) / 'D' (disposed); the leading char is
# ownership type. Mirrors `fill_value()` for the live (non-precomputed) paths.
# NB: the price fallback uses `sep.closeunadj` (raw, as-traded close) — NOT the
# split-adjusted `sep.close` — because `transactionshares`/`transactionpricepershare`
# are as-filed (raw); multiplying raw shares by a split-adjusted close mis-values every
# pre-split grant/exercise by the cumulative split factor.
_VALUE_SQL = (
    "COALESCE(NULLIF(sf2.transactionvalue, 0), "
    "abs(sf2.transactionshares) * COALESCE(sf2.transactionpricepershare, sep.closeunadj))"
)
_DIR_SQL = ("CASE WHEN right(sf2.securityadcode, 1) = 'A' THEN 1 "
            "WHEN right(sf2.securityadcode, 1) = 'D' THEN -1 ELSE 0 END")


def owner_id_for(ownername: str) -> str:
    """The surrogate id for a name — mirrors `substr(md5(upper(name)),1,12)` in SQL, so
    links can be built without a round-trip to `derived.insider`."""
    return hashlib.md5(ownername.upper().encode("utf-8")).hexdigest()[:12]


def refresh(session: Session) -> dict:
    """(Re)build both derived insider tables. Idempotent; stamped with `asof` = max SF2
    filing date. Returns row counts. See the module note above for the schema.

    Single-flight + atomic swap: one builder at a time (others skip and serve the live
    tables); each table is built into `…__new` off the live table and swapped in with a
    brief metadata lock — no DROP-convoy with concurrent app warmers."""
    asof = scalar(session, "SELECT max(filingdate) FROM sf2")
    with single_flight(LOCK_INSIDERS) as mine:
        if not mine:  # another worker is rebuilding — don't stampede
            return {"insider": live_count(_INSIDER_TABLE),
                    "insider_company": live_count(_INSIDER_CO_TABLE)}
        _build_insider_tables(asof)
    return {"insider": live_count(_INSIDER_TABLE),
            "insider_company": live_count(_INSIDER_CO_TABLE)}


def _build_insider_tables(asof) -> None:
    """Build both derived.insider(_company) tables off the live ones (into `…__new`), then
    swap them in atomically. Single-flight is the caller's responsibility."""
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS derived"))

        conn.execute(text(f"DROP TABLE IF EXISTS {_INSIDER_TABLE}{NEW}"))
        conn.execute(text(
            f"""
            CREATE TABLE {_INSIDER_TABLE}{NEW} AS
            SELECT substr(md5(upper(ownername)), 1, 12) AS owner_id,
                   ownername,
                   count(*) AS txns,
                   count(DISTINCT permaticker) AS companies,
                   min(transactiondate) AS first_trade,
                   max(transactiondate) AS last_trade,
                   bool_or(isdirector = 'Y') AS ever_director,
                   bool_or(isofficer = 'Y') AS ever_officer,
                   bool_or(istenpercentowner = 'Y') AS ever_tenpct,
                   CAST(:asof AS date) AS asof
            FROM sf2
            WHERE ownername IS NOT NULL AND ownername <> ''
            GROUP BY ownername
            """), {"asof": asof})
        conn.execute(text(f"CREATE UNIQUE INDEX ix_insider_owner_id{NEW} "
                          f"ON {_INSIDER_TABLE}{NEW} (owner_id)"))
        conn.execute(text(f"CREATE INDEX ix_insider_name{NEW} ON {_INSIDER_TABLE}{NEW} (ownername)"))

        conn.execute(text(f"DROP TABLE IF EXISTS {_INSIDER_CO_TABLE}{NEW}"))
        conn.execute(text(
            f"""
            CREATE TABLE {_INSIDER_CO_TABLE}{NEW} AS
            WITH valued AS (
                SELECT substr(md5(upper(sf2.ownername)), 1, 12) AS owner_id,
                       sf2.ownername, sf2.permaticker, sf2.ticker, sf2.issuername,
                       sf2.transactiondate, sf2.filingdate,
                       sf2.transactioncode AS code,
                       abs(sf2.transactionshares) AS shares,
                       sf2.sharesownedfollowingtransaction AS owned,
                       {_VALUE_SQL} AS value, {_DIR_SQL} AS dir
                FROM sf2
                LEFT JOIN sep ON sep.permaticker = sf2.permaticker
                            AND sep.date = sf2.transactiondate
                WHERE sf2.ownername IS NOT NULL AND sf2.ownername <> ''
                  AND sf2.permaticker IS NOT NULL
            )
            SELECT owner_id, ownername, permaticker,
                   max(ticker) AS ticker, max(issuername) AS issuername,
                   count(*) AS txns,
                   -- all-codes basis: acquired (A) vs disposed (D), every form code
                   sum(CASE WHEN dir = 1 THEN value ELSE 0 END) AS acquired_value,
                   sum(CASE WHEN dir = -1 THEN value ELSE 0 END) AS disposed_value,
                   sum(dir * value) AS net_value,
                   sum(CASE WHEN dir = 1 THEN shares ELSE 0 END) AS acquired_shares,
                   sum(CASE WHEN dir = -1 THEN shares ELSE 0 END) AS disposed_shares,
                   -- open-market basis: discretionary buys (P) vs sells (S) only
                   sum(CASE WHEN code = 'P' THEN value ELSE 0 END) AS om_buy_value,
                   sum(CASE WHEN code = 'S' THEN value ELSE 0 END) AS om_sell_value,
                   sum(CASE WHEN code = 'P' THEN value
                            WHEN code = 'S' THEN -value ELSE 0 END) AS om_net_value,
                   sum(CASE WHEN code = 'P' THEN shares ELSE 0 END) AS om_buy_shares,
                   sum(CASE WHEN code = 'S' THEN shares ELSE 0 END) AS om_sell_shares,
                   sum(CASE WHEN code IN ('P', 'S') THEN 1 ELSE 0 END) AS om_txns,
                   min(transactiondate) AS first_trade,
                   max(transactiondate) AS last_trade,
                   (array_agg(owned ORDER BY transactiondate DESC NULLS LAST,
                              filingdate DESC NULLS LAST))[1] AS latest_shares,
                   CAST(:asof AS date) AS asof
            FROM valued
            GROUP BY owner_id, ownername, permaticker
            """), {"asof": asof})
        conn.execute(text(f"CREATE INDEX ix_insider_co_permaticker{NEW} "
                          f"ON {_INSIDER_CO_TABLE}{NEW} (permaticker)"))
        conn.execute(text(f"CREATE INDEX ix_insider_co_owner{NEW} "
                          f"ON {_INSIDER_CO_TABLE}{NEW} (owner_id)"))

    # Swap both new tables into place atomically (fast, metadata-only).
    with engine.begin() as conn:
        swap_in(conn, _INSIDER_TABLE,
                ((f"ix_insider_owner_id{NEW}", "ix_insider_owner_id"),
                 (f"ix_insider_name{NEW}", "ix_insider_name")))
        swap_in(conn, _INSIDER_CO_TABLE,
                ((f"ix_insider_co_permaticker{NEW}", "ix_insider_co_permaticker"),
                 (f"ix_insider_co_owner{NEW}", "ix_insider_co_owner")))


def resolve_owner(session: Session, owner_id: str) -> dict | None:
    """Look up one insider by surrogate id (name + role flags + activity span)."""
    res = rows(session, f"SELECT * FROM {_INSIDER_TABLE} WHERE owner_id = :oid",
               {"oid": owner_id})
    return res[0] if res else None


def owner_companies(session: Session, owner_id: str) -> pd.DataFrame:
    """The companies one insider has traded, with the precomputed valued rollup, ranked
    by the size of their net position change."""
    return query_df(
        session,
        f"SELECT ic.permaticker, ic.ticker, ic.issuername, ic.txns, ic.acquired_value, "
        f"ic.disposed_value, ic.net_value, ic.acquired_shares, ic.disposed_shares, "
        f"ic.latest_shares, ic.last_trade, "
        # current/last market value of the latest reported position: latest_shares × the
        # security's last raw close (NULL for private filers with no price, e.g. SpaceX).
        f"ic.latest_shares * (SELECT closeunadj FROM sep WHERE permaticker = ic.permaticker "
        f"ORDER BY date DESC LIMIT 1) AS latest_value "
        f"FROM {_INSIDER_CO_TABLE} ic WHERE ic.owner_id = :oid "
        f"ORDER BY abs(ic.net_value) DESC NULLS LAST",
        {"oid": owner_id},
    )


def owner_totals(session: Session, owner_id: str) -> dict | None:
    """Cross-company totals for an insider's header cards (from the precomputed rollup)."""
    res = rows(
        session,
        f"SELECT count(*) AS companies, sum(txns) AS txns, "
        f"sum(acquired_value) AS acquired, sum(disposed_value) AS disposed, "
        f"sum(net_value) AS net FROM {_INSIDER_CO_TABLE} WHERE owner_id = :oid",
        {"oid": owner_id},
    )
    return res[0] if res else None


def company_top_insiders(session: Session, permaticker: int | str,
                         basis: str = "om", limit: int = 15) -> pd.DataFrame:
    """Top insiders of one company (from the precomputed rollup), ranked by the size of
    their net under `basis`: 'om' = open-market buys/sells only (conviction), 'all' =
    every transaction code (total net position change). Returns both nets so the UI can
    relabel without a re-query."""
    net_col = "om_net_value" if basis == "om" else "net_value"
    return query_df(
        session,
        f"SELECT owner_id, ownername, txns, om_txns, net_value, om_net_value, "
        f"acquired_value, disposed_value, om_buy_value, om_sell_value, "
        f"latest_shares, last_trade FROM {_INSIDER_CO_TABLE} WHERE permaticker = :pt "
        f"ORDER BY abs({net_col}) DESC NULLS LAST LIMIT :limit",
        {"pt": int(permaticker), "limit": limit},
    )


def company_insider_totals(session: Session, permaticker: int | str) -> dict | None:
    """Full-history insider totals for a company's stat cards — both bases (all-codes
    acquired/disposed/net and open-market bought/sold/net), so the UI can switch."""
    res = rows(
        session,
        f"SELECT count(DISTINCT owner_id) AS insiders, sum(txns) AS txns, "
        f"sum(acquired_value) AS acquired, sum(disposed_value) AS disposed, "
        f"sum(net_value) AS net, sum(acquired_shares) AS acquired_sh, "
        f"sum(disposed_shares) AS disposed_sh, "
        f"sum(om_buy_value) AS om_buy, sum(om_sell_value) AS om_sell, "
        f"sum(om_net_value) AS om_net, sum(om_buy_shares) AS om_buy_sh, "
        f"sum(om_sell_shares) AS om_sell_sh, sum(om_txns) AS om_txns "
        f"FROM {_INSIDER_CO_TABLE} WHERE permaticker = :pt",
        {"pt": int(permaticker)},
    )
    return res[0] if res and res[0]["txns"] is not None else None


def owner_transactions(session: Session, owner_id: str, limit: int = 8000) -> pd.DataFrame:
    """Every transaction for one insider across all companies, with the issuer ticker,
    permaticker and the market close on the trade date (for `fill_value`). Live (raw
    rows) — the transaction table and holdings chart need per-row detail. Resolves the id
    to a name first so the SF2 query has no `ownername` join ambiguity."""
    who = resolve_owner(session, owner_id)
    if not who:
        return pd.DataFrame()
    return query_df(
        session,
        f"SELECT sf2.ticker, sf2.issuername, sf2.permaticker, {_COLS}, "
        f"sep.closeunadj AS mkt_close "
        f"FROM sf2 LEFT JOIN sep ON sep.permaticker = sf2.permaticker "
        f"AND sep.date = sf2.transactiondate "
        f"WHERE sf2.ownername = :name "
        f"ORDER BY sf2.transactiondate DESC NULLS LAST, sf2.filingdate DESC LIMIT :limit",
        {"name": who["ownername"], "limit": limit},
    )
