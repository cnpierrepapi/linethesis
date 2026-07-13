#!/usr/bin/env python3
# ON-CHAIN BACKFILL — full, uncapped per-match trade history from Polygon logs, then
# align to TxLINE demargined fair to measure the pickoff surface WITH the goals in it.
#
# Path: Polymarket per-match fills settle as OrderFilled events on the NegRisk CTF
# Exchange. Each event is self-contained: [flag, tokenId, amountA, amountB(+fee)].
# price = min(A,B)/max(A,B); size = max(A,B)/1e6; token=data[1] -> P(France)= price if
# YES else 1-price. We LEARN the exact OrderFilled topic0 at runtime from a known trade's
# receipt (no guessing), then eth_getLogs the exchange over the match block range.
import json, subprocess, os, bisect, statistics as st, datetime as dt
RPC  = open(os.path.expanduser("~/.poly_rpc")).read().strip()
SUPA = "https://mohbmvajroqizlfaarjk.supabase.co"
BLOB = f"{SUPA}/storage/v1/object/public/desk-archives/live/18188721.json"   # Paraguay v France
COND = "0xad3441638abca4aa830cb997b7caea5f3c8b84be06b99173781cb9a47c5cbc5a"
EXCH = "0xe2222d279d744050d28e00520010520000310f59"   # NegRisk CTF Exchange
YES  = 113891226639705983282066963484423345278150974279743795316461155085208879415201
NO   = 21768823063425705834344898922772041926865204761442619231134822499901743767561
UA   = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36"

def curl(url, *a):
    return subprocess.run(["curl","-s","--max-time","40",*a,url], capture_output=True, text=True).stdout
def rpc(method, params):
    for _ in range(4):
        out = curl(RPC, "-H","content-type: application/json","-d",
                   json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
        try:
            d = json.loads(out)
            if "result" in d: return d["result"]
            if d.get("error",{}).get("message","").lower().find("limit")>=0: return {"_err":d["error"]}
        except Exception: pass
    return None
def dapi(url):
    for _ in range(5):
        try:
            d = json.loads(curl(url, "-H",f"User-Agent: {UA}"))
            if isinstance(d,list): return d
        except Exception: pass
    return []

# ---- 1) learn OrderFilled topic0 from a known fill's receipt ----
tr = dapi(f"https://data-api.polymarket.com/trades?market={COND}&limit=1&takerOnly=false")
tx = tr[0]["transactionHash"]
rc = rpc("eth_getTransactionReceipt", [tx])
TOPIC0 = None
for lg in rc["logs"]:
    if lg["address"].lower() == EXCH:
        w = lg["data"][2:]; words=[int(w[i:i+64],16) for i in range(0,len(w),64)]
        if len(words) >= 4 and (YES in words or NO in words):
            TOPIC0 = lg["topics"][0]; break
print("learned OrderFilled topic0:", TOPIC0)

def decode(lg):
    w = lg["data"][2:]; d=[int(w[i:i+64],16) for i in range(0,len(w),64)]
    tok = YES if YES in d else (NO if NO in d else None)
    if tok is None: return None
    amts = [x for x in d if x and x != tok and x < 10**15]     # the two 6-dp amounts (+maybe fee)
    if len(amts) < 2: return None
    a, b = sorted(amts, reverse=True)[:2]                       # a=token(shares), b=usdc
    if a == 0: return None
    price = b / a
    if not (0 < price <= 1): return None
    return {"token": tok, "price": price, "shares": a/1e6}

# ---- 2) TxLINE demargined P(France win) time-series ----
print("loading TxLINE fair ...")
j = json.loads(curl(BLOB))
from collections import defaultdict
byp = defaultdict(list)
for o in j["odds"]:
    if o.get("SuperOddsType")=="1X2_PARTICIPANT_RESULT": byp[o.get("MarketPeriod")].append(o)
period = max(byp, key=lambda p: max(x["Ts"] for x in byp[p])-min(x["Ts"] for x in byp[p]))
fair=[]
for o in sorted(byp[period], key=lambda x:x["Ts"]):
    nm,pr=o.get("PriceNames") or [],o.get("Prices") or []
    dd={n:(1.0/(p/1000.0) if p and p>0 else 0) for n,p in zip(nm,pr)}; s=sum(dd.values())
    if s>0 and "part2" in dd: fair.append((o["Ts"], dd["part2"]/s))
fts=[t for t,_ in fair]
run=[s["Ts"] for s in j.get("scores",[]) if (s.get("Clock") or {}).get("Running")]
kick,ftt=(min(run),max(run)) if run else (fts[0],fts[-1])
def fair_at(ms):
    i=bisect.bisect_right(fts,ms)-1;  return fair[i][1] if i>=0 else None
print(f"fair pts {len(fair)}  in-play {dt.datetime.utcfromtimestamp(kick/1000):%H:%M} .. {dt.datetime.utcfromtimestamp(ftt/1000):%H:%M}")

# ---- 3) block range for the match window (binary search by timestamp) ----
def block_ts(bn):
    b = rpc("eth_getBlockByNumber", [hex(bn), False]); return int(b["timestamp"],16) if b else None
latest = int(rpc("eth_blockNumber", []),16)
def find_block(target_s, lo, hi):
    while lo < hi:
        mid=(lo+hi)//2; t=block_ts(mid)
        if t is None: return lo
        if t < target_s: lo=mid+1
        else: hi=mid
    return lo
lo0 = latest - 60000                                    # ~1.5 days back is plenty
b_start = find_block(kick//1000 - 60, lo0, latest)
b_end   = find_block(ftt//1000 + 300, b_start, latest)
ts_s, ts_e = block_ts(b_start), block_ts(b_end)         # endpoint timestamps → interpolate
def ts_of(bn):                                          # linear block→ms (Polygon ~uniform)
    if b_end == b_start: return ts_s*1000
    return int((ts_s + (bn-b_start)*(ts_e-ts_s)/(b_end-b_start))*1000)
print(f"block range {b_start}..{b_end} ({b_end-b_start} blocks)  {ts_e-ts_s}s span", flush=True)

# ---- 4) page getLogs over the range, decode, keep our token (interpolated ts) ----
def getlogs(a, b):   # direct curl (mirrors the proven 10-block diagnostic)
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getLogs",
                       "params":[{"address":EXCH,"topics":[TOPIC0],"fromBlock":hex(a),"toBlock":hex(b)}]})
    for _ in range(4):
        out = subprocess.run(["curl","-s","--max-time","20","-H","content-type: application/json","-d",body,RPC],
                             capture_output=True, text=True).stdout
        try:
            d = json.loads(out)
        except Exception:
            continue
        if isinstance(d.get("result"), list): return d["result"]
    return None

print("paging getLogs (10-block chunks) ...", flush=True)
trades=[]; STEP=10; f=b_start; chunks=0
while f <= b_end:
    t = min(f+STEP-1, b_end)
    res = getlogs(f, t)
    if res is None:
        print(f"  ! chunk block {f}..{t} failed, skipping", flush=True); f=t+1; continue
    for lg in res:
        d = decode(lg)
        if not d: continue
        trades.append({"ts_ms":ts_of(int(lg["blockNumber"],16)), **d, "tx":lg["transactionHash"], "li":int(lg["logIndex"],16)})
    chunks += 1
    if chunks % 25 == 0:
        print(f"  chunk {chunks}: block {t} ({100*(t-b_start)//max(1,b_end-b_start)}%), {len(trades)} raw fills", flush=True)
    f = t+1
# dedup by (tx, logIndex)
seen=set(); uniq=[]
for x in trades:
    k=(x["tx"],x["li"])
    if k in seen: continue
    seen.add(k); uniq.append(x)
uniq.sort(key=lambda x:x["ts_ms"])
print(f"on-chain fills decoded: {len(uniq)}")
if uniq:
    print(f"  span {dt.datetime.utcfromtimestamp(uniq[0]['ts_ms']/1000):%H:%M:%S} .. {dt.datetime.utcfromtimestamp(uniq[-1]['ts_ms']/1000):%H:%M:%S}")

# ---- 5) align + pickoff surface (in-play) ----
rows=[]
for x in uniq:
    f=fair_at(x["ts_ms"])
    if f is None: continue
    imp = x["price"] if x["token"]==YES else 1-x["price"]
    rows.append((x["ts_ms"], imp, f, imp-f, x["shares"], x["price"]))
def surface(rs,label):
    if not rs: print(f"[{label}] none"); return
    g=[abs(r[3]) for r in rs]; notl=sum(r[4]*r[5] for r in rs)
    print(f"\n===== {label}: {len(rs)} fills, ${notl:,.0f} =====")
    print(f"  |gap| mean={st.mean(g)*100:.2f}pp med={st.median(g)*100:.2f}pp p95={sorted(g)[int(len(g)*0.95)]*100:.2f}pp max={max(g)*100:.1f}pp")
    for th in (0.02,0.03,0.05,0.10):
        pk=[r for r in rs if abs(r[3])>=th]; v=sum(r[4]*r[5] for r in pk)
        print(f"  |gap|>={th*100:>2.0f}pp: {len(pk):>5} fills  ${v:>11,.0f} ({100*v/notl:4.1f}%)")
inplay=[r for r in rows if kick<=r[0]<=ftt]
surface(rows,"ALL")
surface(inplay,"IN-PLAY")
top=sorted(inplay,key=lambda r:-abs(r[3]))[:12]
print("\ntop in-play mispriced fills:")
for ms,imp,f,gap,sh,p in top:
    print(f"  {dt.datetime.utcfromtimestamp(ms/1000):%H:%M:%S}  PM={imp:.3f} TxL={f:.3f} gap={gap*100:+.1f}pp  ${sh*p:,.0f}")
# save for reuse
with open("/tmp/france_onchain_fills.json","w") as fh: json.dump(uniq,fh)
print("\nsaved -> /tmp/france_onchain_fills.json")
