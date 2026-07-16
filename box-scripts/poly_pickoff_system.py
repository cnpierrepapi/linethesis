#!/usr/bin/env python3
# PICKOFF BACKFILL SYSTEM — repetitive, resumable, rate-limited on-chain backfill of
# Polymarket per-match fills, aligned to TxLINE demargined fair to score the pickoff
# surface. Designed to run under Alchemy's FREE tier (30M CU/mo, 500 CUPS) without
# timeouts: bounded getLogs chunks + fast per-call timeout + backoff, a token-bucket
# CU limiter (stays under 500 CUPS), EXACT batched block timestamps (no interpolation
# artifact), and per-match checkpoints so any interruption resumes where it left off.
#
#   python3 poly_pickoff_system.py            # process next un-done fixture (cron-safe)
#   python3 poly_pickoff_system.py --all      # loop through every fixture, then stop
#   python3 poly_pickoff_system.py --fid 18188721   # one specific fixture
#
# State in ~/pickoff/: <fid>.fills.jsonl (raw), <fid>.ckpt.json (resume), <fid>.surface.json
# (result), manifest.json (done index). A lock file prevents overlapping cron runs.
import json, subprocess, os, time, bisect, math, datetime as dt
from pathlib import Path
from collections import defaultdict

RPC   = open(os.path.expanduser("~/.poly_rpc")).read().strip()
EXCH  = "0xe2222d279d744050d28e00520010520000310f59"   # NegRisk CTF Exchange
SUPA  = "https://mohbmvajroqizlfaarjk.supabase.co"
GAMMA = "https://gamma-api.polymarket.com"
UA    = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
OUT   = Path(os.environ.get("PICKOFF_DIR", str(Path.home()/"pickoff"))); OUT.mkdir(exist_ok=True)
LOCK  = OUT/".lock"

# ---- CU token-bucket rate limiter: keep well under 500 CUPS (target 400) ----
class Limiter:
    def __init__(self, rate=400.0, cap=400.0):
        self.rate, self.cap, self.tokens, self.t = rate, cap, cap, time.time()
    def take(self, cu):
        while True:
            now = time.time(); self.tokens = min(self.cap, self.tokens + (now-self.t)*self.rate); self.t = now
            if self.tokens >= cu: self.tokens -= cu; return
            time.sleep((cu - self.tokens)/self.rate)
LIM = Limiter()

def curl(url, body=None):
    args = ["curl","-s","--max-time","20","-H","content-type: application/json"]
    if body is not None: args += ["-d", body]
    if url is None: url = RPC
    else: args += ["-H", f"User-Agent: {UA}"]
    return subprocess.run(args + [url], capture_output=True, text=True).stdout

def rpc(method, params, cu, batch=False):
    LIM.take(cu)
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params})
    for k in range(4):
        out = curl(None, body)
        try:
            d = json.loads(out)
            if "result" in d: return d["result"]
            if "error" in d and "limit" in str(d["error"]).lower(): return "TOOBIG"
        except Exception: pass
        time.sleep(0.3)
    return None

# fast, proven getLogs: 10-block fixed chunks, direct curl (bypasses the retry/limiter
# overhead that throttled adaptive chunking). ~2 calls/s ≈ 150 CUPS, safely under 500.
def getlogs10(a, b, topic0):
    LIM.take(75)
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getLogs",
                       "params":[{"address":EXCH,"topics":[topic0],"fromBlock":hex(a),"toBlock":hex(b)}]})
    for _ in range(4):
        out = subprocess.run(["curl","-s","--max-time","15","-H","content-type: application/json","-d",body,RPC],
                             capture_output=True, text=True).stdout
        try:
            d = json.loads(out)
            if isinstance(d.get("result"), list): return d["result"]
        except Exception: pass
    return None

def rpc_batch(calls):   # calls=[(method,params,cu)]; returns list of results (order preserved)
    LIM.take(sum(c[2] for c in calls))
    body = json.dumps([{"jsonrpc":"2.0","id":i,"method":m,"params":p} for i,(m,p,_) in enumerate(calls)])
    for k in range(5):
        out = curl(None, body)
        try:
            arr = json.loads(out)
            if isinstance(arr, list):
                byid = {x["id"]: x.get("result") for x in arr}
                return [byid.get(i) for i in range(len(calls))]
        except Exception: pass
        time.sleep(0.5*(k+1))
    return [None]*len(calls)

def dget(url):
    for _ in range(5):
        try:
            d = json.loads(curl(url))
            if isinstance(d, (list, dict)): return d
        except Exception: time.sleep(1)
    return None

# ---- block helpers (EXACT timestamps, batched) ----
def block_ts(bn):
    r = rpc("eth_getBlockByNumber", [hex(bn), False], 16)
    return int(r["timestamp"],16) if r else None
def find_block(target_s, lo, hi):
    while lo < hi:
        mid=(lo+hi)//2; t=block_ts(mid)
        if t is None: return lo
        if t < target_s: lo=mid+1
        else: hi=mid
    return lo
def timestamps_for(blocks):     # exact ts for a set of block numbers, batched 40/req (=640 CU < 500? no)
    blocks = sorted(set(blocks)); out = {}
    B = 25                       # 25*16=400 CU/batch -> one batch/sec stays <=400 CUPS
    for i in range(0, len(blocks), B):
        grp = blocks[i:i+B]
        res = rpc_batch([("eth_getBlockByNumber",[hex(b),False],16) for b in grp])
        for b, r in zip(grp, res):
            out[b] = int(r["timestamp"],16) if r else None
    return out

# ---- OrderFilled decode (self-contained, validated) ----
def learn_topic0(cond, yes, no):
    tr = dget(f"https://data-api.polymarket.com/trades?market={cond}&limit=1&takerOnly=false")
    rc = rpc("eth_getTransactionReceipt", [tr[0]["transactionHash"]], 15)
    for lg in rc["logs"]:
        if lg["address"].lower()==EXCH:
            w=lg["data"][2:]; words=[int(w[i:i+64],16) for i in range(0,len(w),64)]
            if yes in words or no in words: return lg["topics"][0]
    return None
def decode(lg, yes, no):
    w=lg["data"][2:]; d=[int(w[i:i+64],16) for i in range(0,len(w),64)]
    tok = yes if yes in d else (no if no in d else None)
    if tok is None: return None
    amts=[x for x in d if x and x!=tok and x<10**15]
    if len(amts)<2: return None
    a,b=sorted(amts,reverse=True)[:2]
    if a==0: return None
    price=b/a
    if not (0<price<=1): return None
    return {"token":tok,"price":price,"shares":a/1e6}

# ---- TxLINE fair + market resolution ----

# --- local archive cache (egress fix): a FINISHED archive is immutable; cache it and never re-download.
# The cache is trusted ONLY when its stored size matches the CURRENT published blob's Content-Length
# (a cheap HEAD, ~0 egress). A cache written mid-match is a smaller PARTIAL, so its length won't match
# the finished blob -> it self-invalidates and we re-download the complete archive. This is the fix for
# the England v Argentina poisoning, where a kick+1min partial (24s of running-clock) permanently
# shadowed the full 122min archive. captures_live is the LIVE partial and is never a backfill source. ---
_ARC = __import__("pathlib").Path.home() / "archive-cache"
_ARC.mkdir(exist_ok=True)
def _head_len(url):
    try:
        out = subprocess.run(["curl", "-sI", "--max-time", "10", url], capture_output=True, text=True).stdout
        for line in out.splitlines():
            if line.lower().startswith("content-length:"):
                return int(line.split(":", 1)[1].strip())
    except Exception:
        pass
    return None

def _arc_cached(fid, url):
    import json as _json
    cache_p = _ARC/("%s.json" % fid); len_p = _ARC/("%s.len" % fid)
    remote = _head_len(url)
    if cache_p.exists() and len_p.exists() and remote is not None:
        try:
            if int(len_p.read_text().strip()) == remote:
                return _json.loads(cache_p.read_text())
        except Exception:
            pass
    j = dget(url)
    if j and j.get("odds"):
        try:
            cache_p.write_text(_json.dumps(j))
            if remote is not None:
                len_p.write_text(str(remote))
        except Exception:
            pass
    return j

def txline_fair(fid):
    j = _arc_cached(fid, f"{SUPA}/storage/v1/object/public/desk-archives/live/{fid}.json")
    byp = defaultdict(list)
    for o in j["odds"]:
        if o.get("SuperOddsType")=="1X2_PARTICIPANT_RESULT": byp[o.get("MarketPeriod")].append(o)
    if not byp: return None
    period = max(byp, key=lambda p: max(x["Ts"] for x in byp[p])-min(x["Ts"] for x in byp[p]))
    fair=[]
    for o in sorted(byp[period], key=lambda x:x["Ts"]):
        nm,pr=o.get("PriceNames") or [],o.get("Prices") or []
        dd={n:(1.0/(p/1000.0) if p and p>0 else 0) for n,p in zip(nm,pr)}; s=sum(dd.values())
        if s>0 and "part2" in dd: fair.append((o["Ts"], dd["part2"]/s))
    # The live archive starts capturing at/near kickoff, so the fair span is a RELIABLE match window.
    # Trust the running-clock to trim pre/post-match drift ONLY when it plainly covers the match
    # (spans >=60min AND ends within 15min of the fair end) — else a flaky clock (England: 24s) or one
    # that died early would truncate the in-play window. Default to the fair span.
    run=[s["Ts"] for s in j.get("scores",[]) if (s.get("Clock") or {}).get("Running")]
    kick,ft=fair[0][0],fair[-1][0]
    if run:
        rk,rf=min(run),max(run)
        if (rf-rk)>=60*60*1000 and (fair[-1][0]-rf)<=15*60*1000:
            kick,ft=rk,rf
    return {"fair":fair, "fts":[t for t,_ in fair], "kick":kick, "ft":ft, "p1":j.get("p1"), "p2":j.get("p2")}

def resolve_market(p2, when_ms):
    # Polymarket slugs are dated in US Eastern; our when_ms is UTC. A late-ET kickoff lands on the
    # NEXT UTC day, so a single UTC "day" misses the slug. Try a small set of candidate days (UTC,
    # ET-shifted by 4/5h, and the prior day) in both the search query and the slug-day filter.
    base = dt.datetime.utcfromtimestamp(when_ms/1000)
    days = sorted({(base - dt.timedelta(hours=h)).strftime("%Y-%m-%d") for h in (0, 4, 5, 24)})
    want = f"will {p2.lower()} win"
    for day in days:
        d = dget(f"{GAMMA}/public-search?q=Will%20{p2.replace(' ','%20')}%20win%20on%20{day}&limit_per_type=20") or {}
        for ev in (d.get("events") or []):
            for m in (ev.get("markets") or []):
                slug = m.get("slug",""); q = (m.get("question") or "").lower().strip()
                # the P2-win market ONLY: "Will <P2> win on <day>?"; exclude the -draw / -<other> sides
                if slug.startswith("fifwc-") and any(dd in slug for dd in days) and not slug.endswith("-draw") and q.startswith(want):
                    toks = json.loads(m["clobTokenIds"]) if isinstance(m.get("clobTokenIds"),str) else m.get("clobTokenIds")
                    return {"cond":m["conditionId"], "yes":int(toks[0]), "no":int(toks[1]), "slug":m["slug"]}
    return None

# ---- adaptive paged getLogs with checkpoint ----
def backfill(fid):
    tx = txline_fair(fid)
    if not tx: return {"fid":fid, "error":"no txline 1X2"}
    mk = resolve_market(tx["p2"], tx["kick"])
    if not mk: return {"fid":fid, "error":"no polymarket market"}
    yes,no,cond = mk["yes"], mk["no"], mk["cond"]
    topic0 = learn_topic0(cond, yes, no)
    if not topic0: return {"fid":fid, "error":"no topic0"}

    latest = int(rpc("eth_blockNumber",[],10),16)
    b_start = find_block(tx["kick"]//1000 - 60, latest-250000, latest)   # ~6 days back covers the tournament
    b_end   = find_block(tx["ft"]//1000 + 300, b_start, latest)

    ckpt_p = OUT/f"{fid}.ckpt.json"; fills_p = OUT/f"{fid}.fills.jsonl"
    ckpt = json.loads(ckpt_p.read_text()) if ckpt_p.exists() else {"next":b_start,"n":0}
    fh = fills_p.open("a", encoding="utf-8")
    f = ckpt["next"]; STEP = 10; n = ckpt["n"]; chunks = 0
    t0 = time.time()
    while f <= b_end:
        t = min(f+STEP-1, b_end)
        res = getlogs10(f, t, topic0)
        if res is None:                     # rare transient; skip the 10-block window, keep going
            f = t+1; continue
        for lg in res:
            d = decode(lg, yes, no)
            if not d: continue
            fh.write(json.dumps({"blk":int(lg["blockNumber"],16), **d,
                                 "tx":lg["transactionHash"], "li":int(lg["logIndex"],16)})+"\n")
            n += 1
        f = t+1; chunks += 1
        if chunks % 50 == 0:
            ckpt_p.write_text(json.dumps({"next":f,"n":n}))
            print(f"  [{fid}] {100*(f-b_start)//max(1,b_end-b_start)}%  {n} fills", flush=True)
    ckpt_p.write_text(json.dumps({"next":f,"n":n}))
    fh.close()
    print(f"  [{fid}] {n} fills in {time.time()-t0:.0f}s (blocks {b_start}..{b_end})", flush=True)

    # exact timestamps for the blocks we saw, then align
    rows = [json.loads(l) for l in fills_p.read_text().splitlines() if l.strip()]
    # dedup (tx,li)
    seen=set(); uniq=[]
    for r in rows:
        k=(r["tx"],r["li"])
        if k in seen: continue
        seen.add(k); uniq.append(r)
    tsmap = timestamps_for([r["blk"] for r in uniq])
    fair, fts = tx["fair"], tx["fts"]
    def fair_at(ms):
        i=bisect.bisect_right(fts,ms)-1; return fair[i][1] if i>=0 else None
    surf=[]
    for r in uniq:
        bt = tsmap.get(r["blk"])
        if bt is None: continue
        ms = bt*1000
        imp = r["price"] if r["token"]==yes else 1-r["price"]
        fv = fair_at(ms)
        if fv is None: continue
        surf.append((ms, imp, fv, imp-fv, r["shares"], r["price"], r["tx"]))
    return summarize(fid, mk, tx, surf)

def summarize(fid, mk, tx, surf):
    inplay=[r for r in surf if tx["kick"]<=r[0]<=tx["ft"]]
    def stats(rs):
        if not rs: return {"fills":0}
        g=[abs(r[3]) for r in rs]; notl=sum(r[4]*r[5] for r in rs)
        d={"fills":len(rs),"usd":round(notl),"mean_pp":round(sum(g)/len(g)*100,2),
           "median_pp":round(sorted(g)[len(g)//2]*100,2)}
        for th in (0.02,0.05,0.10):
            pk=[r for r in rs if abs(r[3])>=th]
            d[f"ge{int(th*100)}pp_usd"]=round(sum(r[4]*r[5] for r in pk)); d[f"ge{int(th*100)}pp_fills"]=len(pk)
        return d
    # top verifiable pickoffs (biggest in-play gaps), each with its Polygon tx hash.
    # De-dup near-identical rows (same second + same gap) so the ledger shows variety.
    top=[]; seen_key=set()
    for r in sorted(inplay, key=lambda r:-abs(r[3])):
        key=(r[0]//1000, round(r[3],3))
        if key in seen_key: continue
        seen_key.add(key)
        top.append({"t":r[0]//1000,"pm":round(r[1],4),"fair":round(r[2],4),
                    "gap_pp":round(r[3]*100,1),"usd":round(r[4]*r[5]),"tx":r[6]})
        if len(top)>=25: break
    # downsampled REPLAY SERIES for the sandbox animation + PDF: [secFromKick, fair, book]
    # fair = TxLINE demargined P(win); book = median implied of the fills in each ~15s bucket
    # (carried forward when a bucket is empty) = the market's shown price lagging the fair.
    kick, ftt = tx["kick"], tx["ft"]; fpts, fts = tx["fair"], tx["fts"]
    STEP_MS = 15000
    fa = lambda ms: (fpts[bisect.bisect_right(fts, ms) - 1][1] if bisect.bisect_right(fts, ms) else None)
    bucket = defaultdict(list)
    for r in inplay: bucket[(r[0] - kick) // STEP_MS].append(r[1])
    series = []; last_book = None
    for k in range(int((ftt - kick) // STEP_MS) + 1):
        t_ms = kick + k * STEP_MS; fv = fa(t_ms); b = bucket.get(k)
        if b: last_book = sorted(b)[len(b) // 2]
        if fv is not None:
            series.append([round((t_ms - kick) / 1000), round(fv, 4),
                           (round(last_book, 4) if last_book is not None else None)])
    out={"fid":fid,"slug":mk["slug"],"teams":f'{tx["p1"]} v {tx["p2"]}',
         "kick":tx["kick"],"ft":tx["ft"],"all":stats(surf),"inplay":stats(inplay),
         "top_pickoffs":top,"series":series}
    # never overwrite a populated surface with an empty align, and don't mark a 0-fill match
    # "done" (so it retries next run). A transient timestamp/range failure can't destroy data.
    if not inplay:
        print(f"  [{fid}] empty align — NOT written (preserving any prior surface)", flush=True)
        return {"fid":fid,"error":"empty align","teams":out["teams"]}
    (OUT/f"{fid}.surface.json").write_text(json.dumps(out,indent=1))
    man = json.loads((OUT/"manifest.json").read_text()) if (OUT/"manifest.json").exists() else {}
    man[str(fid)] = {"done":True, "at":dt.datetime.utcnow().isoformat(), **out["inplay"]}
    (OUT/"manifest.json").write_text(json.dumps(man,indent=1))
    return out

def fixtures():
    # TxLINE fixtures we have archived (source of truth for what to backfill)
    KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SB_KEY","")
    url=f"{SUPA}/rest/v1/desk_archived?select=fixture_id,p1,p2&order=first_ts.desc"
    d=dget_auth(url, KEY) or []
    return [str(x["fixture_id"]) for x in d]
def dget_auth(url, key):
    out=curl_auth(url, key)
    try: return json.loads(out)
    except Exception: return None
def curl_auth(url, key):
    return subprocess.run(["curl","-s","--max-time","20","-H",f"apikey: {key}","-H",f"Authorization: Bearer {key}",url],
                          capture_output=True, text=True).stdout

# Combine every per-match surface into one public blob the site reads at runtime.
def publish():
    import glob
    KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY","")
    if not KEY:
        print("publish skipped: no SUPABASE_SERVICE_ROLE_KEY (source worker/.env)"); return
    matches=[]
    for f in sorted(glob.glob(str(OUT/"*.surface.json"))):
        try: matches.append(json.loads(open(f).read()))
        except Exception: continue
    matches=[m for m in matches if (m.get("inplay") or {}).get("fills")]
    matches.sort(key=lambda m: -(m.get("inplay",{}).get("usd") or 0))
    blob={"generatedAt":int(time.time()*1000),
          "matchCount":len(matches),
          "totals":{"usd":sum(m["inplay"]["usd"] for m in matches),
                    "ge5pp_usd":sum(m["inplay"].get("ge5pp_usd",0) for m in matches),
                    "ge10pp_usd":sum(m["inplay"].get("ge10pp_usd",0) for m in matches),
                    "fills":sum(m["inplay"]["fills"] for m in matches)},
          "matches":matches}
    body=json.dumps(blob)
    tmp="/tmp/pickoffs.json"; open(tmp,"w").write(body)
    url=f"{SUPA}/storage/v1/object/desk-archives/pickoffs.json"
    out=subprocess.run(["curl","-s","-o","/dev/null","-w","%{http_code}","-X","POST",url,
        "-H",f"Authorization: Bearer {KEY}","-H",f"apikey: {KEY}",
        "-H","Content-Type: application/json","-H","x-upsert: true",
        "--data-binary",f"@{tmp}"],capture_output=True,text=True).stdout
    print(f"published {len(matches)} matches ({len(body)//1024}KB) -> desk-archives/pickoffs.json  HTTP {out}")

def main():
    import sys
    if "--publish" in sys.argv and "--fid" not in sys.argv and "--all" not in sys.argv:
        publish(); return
    if LOCK.exists() and time.time()-LOCK.stat().st_mtime < 3600:
        print("another run in progress (lock)"); return
    LOCK.write_text(str(os.getpid()))
    try:
        args=sys.argv[1:]
        man = json.loads((OUT/"manifest.json").read_text()) if (OUT/"manifest.json").exists() else {}
        if "--fid" in args:
            todo=[args[args.index("--fid")+1]]
        else:
            todo=[f for f in fixtures() if not man.get(f,{}).get("done")]
            if "--all" not in args: todo=todo[:1]
        print(f"to process: {todo}", flush=True)
        for fid in todo:
            LOCK.write_text(str(os.getpid()))   # refresh lock mtime per match
            r=backfill(fid)
            print(json.dumps(r.get("inplay",r), indent=1), flush=True)
        if "--all" in args or "--publish" in args:
            publish()
    finally:
        LOCK.unlink(missing_ok=True)

if __name__=="__main__":
    main()
