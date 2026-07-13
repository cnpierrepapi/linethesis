#!/usr/bin/env python3
# FORWARD COLLECTOR (b) — capture Polymarket per-match fills for LIVE World Cup matches,
# at second resolution, independent of the archive RPC. Recent fills are under the Data
# API's 3,000-offset cap, so a frequent poll never loses data. Idempotent per market via a
# last-seen timestamp cursor. Runs on a short cron during match hours; the on-chain
# backfiller is the source of truth for anything this misses.
#
#   env: POLY_LIVE_DIR (default ~/poly-live)
#   discovers today's fifwc-* markets from Gamma, tails /trades for each, appends JSONL.
import json, subprocess, os, time, datetime as dt
from pathlib import Path
OUT = Path(os.environ.get("POLY_LIVE_DIR", str(Path.home()/"poly-live"))); OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT/"cursors.json"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
GAMMA = "https://gamma-api.polymarket.com"
DATA  = "https://data-api.polymarket.com/trades"

def curl(url, *a):
    return subprocess.run(["curl","-s","--max-time","30",*a,url], capture_output=True, text=True).stdout
def getj(url):
    for _ in range(4):
        try: return json.loads(curl(url, "-H", f"User-Agent: {UA}"))
        except Exception: time.sleep(1)
    return None

def today_matches():
    # per-match markets: slug fifwc-{a}-{b}-{YYYY-MM-DD}-{side}; discover via public-search on today
    day = dt.datetime.utcnow().strftime("%Y-%m-%d")
    found = {}
    d = getj(f"{GAMMA}/public-search?q=win%20on%20{day}&limit_per_type=60") or {}
    for ev in (d.get("events") or []):
        for m in (ev.get("markets") or []):
            slug = m.get("slug","")
            if slug.startswith("fifwc-") and day in slug and m.get("conditionId"):
                found[m["conditionId"]] = {"slug": slug, "q": m.get("question"),
                                           "closed": m.get("closed"), "tokens": m.get("clobTokenIds")}
    return found

def load_state():
    try: return json.loads(STATE.read_text())
    except Exception: return {}

def main():
    cur = load_state()
    matches = today_matches()
    print(f"{dt.datetime.utcnow():%H:%M:%S} — {len(matches)} fifwc market(s) today")
    total_new = 0
    for cond, meta in matches.items():
        last = float(cur.get(cond, 0))
        newest = last
        fh = (OUT/f"{cond}.jsonl").open("a", encoding="utf-8")
        off = 0
        while off < 3000:                                   # Data API historical cap
            page = getj(f"{DATA}?market={cond}&limit=500&offset={off}&takerOnly=false")
            if not isinstance(page, list) or not page: break
            stop = False
            for t in page:
                ts = float(t.get("timestamp", 0))
                if ts <= last: stop = True; continue
                fh.write(json.dumps({k: t.get(k) for k in
                    ("timestamp","side","price","size","outcome","conditionId","asset","transactionHash")})+"\n")
                total_new += 1
                if ts > newest: newest = ts
            off += 500
            if stop or len(page) < 500: break
            time.sleep(0.2)
        fh.close()
        cur[cond] = newest
        print(f"  {meta['slug']}: up to {dt.datetime.utcfromtimestamp(newest):%H:%M:%S}"
              f"{'  [closed]' if meta.get('closed') else ''}")
    STATE.write_text(json.dumps(cur))
    print(f"done: {total_new} new fills across {len(matches)} markets")

if __name__ == "__main__":
    main()
