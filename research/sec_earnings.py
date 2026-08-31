#!/usr/bin/env python3
"""Fetch a company's 6-K earnings exhibit from SEC EDGAR, given a CIK and a date.

Navigates: submissions JSON -> the 6-K filed on <date> -> its filing folder ->
the earnings exhibit (99.1) -> downloads it and strips to plain text.

Usage:
    python sec_earnings.py <CIK> <YYYY-MM-DD|latest> [--form 6-K]
    python sec_earnings.py 0001003935 2026-05-05
    python sec_earnings.py 0001003935 latest

Writes the raw .htm and a stripped .txt into ./_sec/<CIK>/ and prints the paths.

SEC requires a descriptive User-Agent carrying a real contact on every request, or it
returns 403. Set SEC_USER_AGENT in core/.env (or the environment) to your own name and
e-mail — there is no shared default, because SEC rate-limits and blocks by that identity
and borrowing someone else's gets you both blocked.
"""
import sys, os, json, re, html, time, urllib.request

UA = os.environ.get("SEC_USER_AGENT", "").strip()
if not UA:
    try:                                     # core/.env, when run from inside the project
        from core.config import settings
        UA = settings.sec_user_agent.strip()
    except Exception:
        UA = ""
if not UA:
    sys.exit("SEC_USER_AGENT is not set. SEC EDGAR rejects requests without a descriptive\n"
             "User-Agent containing a real contact. Set it in core/.env, e.g.\n"
             '  SEC_USER_AGENT="Jane Doe jane@example.com"')
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate", "Host": None}

def get(url, host=None):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    if host:
        req.add_header("Host", host)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                # handle gzip if server used it
                if r.headers.get("Content-Encoding") == "gzip":
                    import gzip
                    data = gzip.decompress(data)
                return data
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))

def strip_html(raw: bytes) -> str:
    txt = raw.decode("utf-8", "ignore")
    txt = re.sub(r"(?is)<(script|style).*?</\1>", " ", txt)
    txt = re.sub(r"(?i)<br\s*/?>", "\n", txt)
    txt = re.sub(r"(?i)</(p|div|tr|h[1-6]|li|table)>", "\n", txt)
    txt = re.sub(r"(?i)</td>", "\t", txt)
    txt = re.sub(r"(?s)<[^>]+>", " ", txt)
    txt = html.unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n\s*\n+", "\n\n", txt)
    return "\n".join(line.strip() for line in txt.splitlines()).strip()

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    cik = sys.argv[1].lstrip("cikCIK").zfill(10)
    want_date = sys.argv[2]
    form = "6-K"
    if "--form" in sys.argv:
        form = sys.argv[sys.argv.index("--form") + 1]

    sub = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik}.json"))
    name = sub.get("name", "?")
    rec = sub["filings"]["recent"]
    rows = list(zip(rec["form"], rec["filingDate"], rec["accessionNumber"],
                    rec["primaryDocument"], rec.get("items", [""]*len(rec["form"]))))
    six = [r for r in rows if r[0] == form]

    print(f"# {name}  (CIK {cik})  —  {len(six)} {form} filings in recent set")
    print(f"# Most recent {form}: {six[0][1]}  acc={six[0][2]}")
    print("# Latest 6 6-Ks:")
    for f_, d_, a_, doc_, it_ in six[:6]:
        print(f"    {d_}  {a_}  items={it_}  {doc_}")

    if want_date == "latest":
        target = six[0]
    else:
        match = [r for r in six if r[1] == want_date]
        if not match:
            print(f"\n!! No {form} filed on {want_date}. "
                  f"Closest: {[r[1] for r in six[:8]]}")
            sys.exit(2)
        target = match[0]

    _, fdate, acc, primary, items = target
    acc_nodash = acc.replace("-", "")
    folder = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}"
    print(f"\n# Chosen filing: {fdate}  acc={acc}\n# Folder: {folder}")

    idx = json.loads(get(f"{folder}/index.json"))
    docs = [d["name"] for d in idx["directory"]["item"] if d["name"].endswith((".htm", ".html"))]
    print(f"# Documents: {docs}")

    # earnings press release is almost always exhibit 99.1
    def score(n):
        s = 0
        if re.search(r"99[-_.]?1", n): s += 100
        if "ex" in n.lower(): s += 5
        if n == primary: s -= 50            # the bare 6-K cover, not the release
        return s
    exhibit = sorted(docs, key=score, reverse=True)[0]
    print(f"# Earnings exhibit picked: {exhibit}")

    raw = get(f"{folder}/{exhibit}")
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_sec", cik)
    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, f"{fdate}_{exhibit.replace('/', '_')}")
    htm_path = base
    txt_path = base.rsplit(".", 1)[0] + ".txt"
    with open(htm_path, "wb") as fh:
        fh.write(raw)
    text = strip_html(raw)
    with open(txt_path, "w") as fh:
        fh.write(text)
    print(f"\n# SAVED raw: {htm_path}")
    print(f"# SAVED txt: {txt_path}  ({len(text):,} chars)")
    print(f"# URL: {folder}/{exhibit}")

if __name__ == "__main__":
    main()
