#!/usr/bin/env python3
# PoC: measure the "pickoff surface" — how much Polymarket money executed at prices
# materially off TxLINE's demargined fair, on Paraguay v France (2026-07-04).
#   TxLINE 18188721 1X2 part2 = P(France win)   vs   Polymarket fifwc-par-fra-...-fra fills
import json, urllib.request, bisect, statistics as st

SUPA = "https://mohbmvajroqizlfaarjk.supabase.co"
BLOB = f"{SUPA}/storage/v1/object/public/desk-archives/live/18188721.json"
COND = "0xad3441638abca4aa830cb997b7caea5f3c8b84be06b99173781cb9a47c5cbc5a"
DATA_API = "https://data-api.polymarket.com/trades"

import time, subprocess
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
def get(url):
    # curl (works where urllib 400s behind Cloudflare); retry on empty/failure
    for attempt in range(6):
        p = subprocess.run(["curl", "-s", "--max-time", "60", "-H", f"User-Agent: {UA}", url],
                           capture_output=True, text=True)
        try:
            d = json.loads(p.stdout)
        except Exception:
            time.sleep(1.5*(attempt+1)); continue
        # error/rate-limit wrapper (dict with error) → retry
        if isinstance(d, dict) and (d.get("error") or d.get("message")):
            time.sleep(1.5*(attempt+1)); continue
        return d
    raise RuntimeError(f"get failed: {url[:80]} :: {p.stdout[:120]}")

print("downloading TxLINE blob ...")
j = get(BLOB)
odds, scores = j["odds"], j.get("scores", [])

# --- TxLINE fair P(France win) from 1X2, full-match period (widest ts span) ---
from collections import defaultdict
byperiod = defaultdict(list)
for o in odds:
    if o.get("SuperOddsType") == "1X2_PARTICIPANT_RESULT":
        byperiod[o.get("MarketPeriod")].append(o)
print("1X2 periods:")
for p, fr in byperiod.items():
    ts = [x["Ts"] for x in fr]
    print(f"  period={p!r}  frames={len(fr)}  span={ (max(ts)-min(ts))/60000:.0f}min")
period = max(byperiod, key=lambda p: max(x["Ts"] for x in byperiod[p]) - min(x["Ts"] for x in byperiod[p]))
print("chosen full-match period:", repr(period))

fair = []  # (ts_ms, p_france)
for o in sorted(byperiod[period], key=lambda x: x["Ts"]):
    names, prices = o.get("PriceNames") or [], o.get("Prices") or []
    d = {n: (1.0/(pr/1000.0) if pr and pr > 0 else 0.0) for n, pr in zip(names, prices)}
    s = sum(d.values())
    if s <= 0 or "part2" not in d:
        continue
    fair.append((o["Ts"], d["part2"]/s))   # normalized P(France win)
fair_ts = [t for t, _ in fair]
print(f"fair points: {len(fair)}  P(France) start={fair[0][1]:.3f} end={fair[-1][1]:.3f}")

# --- in-play window from scores clock ---
run_ts = [s["Ts"] for s in scores if (s.get("Clock") or {}).get("Running")]
kick, ft = (min(run_ts), max(run_ts)) if run_ts else (fair_ts[0], fair_ts[-1])
print(f"in-play window: {kick} .. {ft}  ({(ft-kick)/60000:.0f} min)")

def fair_at(ts_ms):
    i = bisect.bisect_right(fair_ts, ts_ms) - 1
    return fair[i][1] if i >= 0 else None

# --- pull ALL Polymarket fills for the market (paginate) ---
print("pulling Polymarket trades ...")
seen, trades = set(), []
for off in range(0, 3000, 500):  # Data API caps historical offset at 3000
    page = get(f"{DATA_API}?market={COND}&limit=500&offset={off}&takerOnly=false")
    if isinstance(page, dict):
        page = page.get("data") or page.get("trades") or []
    if not isinstance(page, list) or not page:
        break
    added = 0
    for t in page:
        if not isinstance(t, dict):
            continue
        key = (t.get("transactionHash"), t.get("price"), t.get("size"), t.get("outcome"))
        if key in seen:
            continue
        seen.add(key); trades.append(t); added += 1
    time.sleep(0.25)
    if len(page) < 500 or added == 0:
        break
ts_all = sorted(int(float(t["timestamp"])*1000) for t in trades)
import datetime as _dt
_f = lambda ms: _dt.datetime.utcfromtimestamp(ms/1000).strftime('%H:%M:%S')
print(f"unique fills: {len(trades)}  (newest {len(trades)} available; API offset cap 3000)")
print(f"trade time span: {_f(ts_all[0])} .. {_f(ts_all[-1])}")
inw = [t for t in ts_all if kick <= t <= ft]
print(f"fills inside 120-min in-play window: {len(inw)}  ({_f(kick)} .. {_f(ft)})")

# --- align each fill to fair, normalise to implied P(France win) ---
rows = []
for t in trades:
    ts_s = float(t.get("timestamp", 0)); ts_ms = int(ts_s*1000)
    p = float(t.get("price", 0)); size = float(t.get("size", 0))
    outcome = (t.get("outcome") or "").lower()
    imp = p if outcome == "yes" else (1.0 - p)   # implied P(France win)
    f = fair_at(ts_ms)
    if f is None:
        continue
    gap = imp - f                                  # +ve: Polymarket too high vs fair
    inplay = kick <= ts_ms <= ft
    rows.append((ts_ms, imp, f, gap, size, p, inplay))

def surface(rs, label):
    if not rs:
        print(f"\n[{label}] no fills"); return
    gaps = [abs(r[3]) for r in rs]
    notional = sum(r[4]*r[5] for r in rs)          # USDC = shares*price
    print(f"\n===== {label}: {len(rs)} fills, ${notional:,.0f} traded =====")
    print(f"  |gap| mean={st.mean(gaps)*100:.2f}pp  median={st.median(gaps)*100:.2f}pp  p90={sorted(gaps)[int(len(gaps)*0.9)]*100:.2f}pp  max={max(gaps)*100:.1f}pp")
    for th in (0.02, 0.03, 0.05, 0.10):
        picked = [r for r in rs if abs(r[3]) >= th]
        vol = sum(r[4]*r[5] for r in picked)
        print(f"  |gap|>={th*100:>2.0f}pp : {len(picked):>5} fills  ${vol:>12,.0f}  ({100*vol/notional:4.1f}% of $)")
    # signed taker edge: a taker BUY of an underpriced YES (imp<fair via price) captures fair-price
    edge = 0.0
    for ts_ms, imp, f, gap, size, p, ip in rs:
        side = None
        # taker perspective unknown per-row; use magnitude as modeled adverse selection
        edge += abs(gap) * size
    print(f"  modeled adverse-selection (Σ|gap|*shares): {edge:,.0f} prob-shares  (~${edge:,.0f} at $1 payoff)")

surface(rows, "ALL (pre-match + in-play)")
surface([r for r in rows if r[6]], "IN-PLAY only")

# --- time-clustering: do big gaps follow TxLINE moves? biggest in-play gaps ---
ip = sorted([r for r in rows if r[6]], key=lambda r: -abs(r[3]))[:12]
print("\ntop 12 in-play mispriced fills (ts, PM implied P(Fra), TxLINE fair, gap pp, $):")
import datetime as dt
for ts_ms, imp, f, gap, size, p, _ in ip:
    print(f"  {dt.datetime.utcfromtimestamp(ts_ms/1000).strftime('%H:%M:%S')}  PM={imp:.3f}  TxL={f:.3f}  gap={gap*100:+.1f}pp  ${size*p:,.0f}")
