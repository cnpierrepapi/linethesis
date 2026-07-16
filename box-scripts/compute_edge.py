# FULL-RES divergence entries + two-test edge, per-entry available SIZE (task 7: show the $ that
# sat at the stale price, consumer decides how much to take) + POOLED headline with MATCH-LEVEL
# bootstrap CI (task 13: significance, match-level to respect outcome clustering). Injects
# divergences/edge into surface.json + publishes a blob with top-level pooled. Grades the SIGNAL.
import json, bisect, os, time, glob, random, subprocess
from collections import defaultdict
import poly_pickoff_system as P
OUT=P.OUT; SUPA=P.SUPA; THETAS=[0.05,0.10]; STEP=2000
# $ floor for a fill to count as REAL exit liquidity. Below this is a dust print — not evidence you
# could have exited there. `reached` and the exit fills BOTH derive from fills above this floor, so the
# reach rate (/edge) and the on-chain proofs (/proof) can never disagree (they used to: reach came from a
# 2s grid of the carried-forward price, the fills from the raw prints, and sparse crosses slipped through).
SIZE_FLOOR=50
# Matches dropped from the entire product (too few / too stale signals): Brazil v Japan (18172469),
# Colombia v Ghana (18179549). Excluded from the pooled stats AND the published matches list, so they
# vanish from /proof, /edge, the headline numbers and every API surface. Raw data stays on disk.
EXCLUDE_FIDS={"18172469","18179549"}

def enrich_ts(fid, fills):
    cache=OUT/f"{fid}.blockts.json"
    tsmap=json.loads(cache.read_text()) if cache.exists() else {}
    need=sorted({r["blk"] for r in fills if str(r["blk"]) not in tsmap})
    if need:
        for i in range(0,len(need),200):
            for b,t in P.timestamps_for(need[i:i+200]).items(): tsmap[str(b)]=t
            cache.write_text(json.dumps(tsmap))
    return tsmap


# --- local archive cache: trust the on-disk copy ONLY when its size matches the CURRENT published
# blob (cheap HEAD via P._head_len); a mid-match partial is smaller and self-invalidates. Same fix as
# poly_pickoff_system._arc_cached (the England poisoning); captures_live (live partial) is never used. ---
_ARC = __import__("pathlib").Path.home() / "archive-cache"
_ARC.mkdir(exist_ok=True)
def _arc_cached(fid, url):
    import json as _json
    cache_p = _ARC/("%s.json" % fid); len_p = _ARC/("%s.len" % fid)
    remote = P._head_len(url)
    if cache_p.exists() and len_p.exists() and remote is not None:
        try:
            if int(len_p.read_text().strip()) == remote:
                return _json.loads(cache_p.read_text())
        except Exception:
            pass
    j = P.dget(url)
    if j and j.get("odds"):
        try:
            cache_p.write_text(_json.dumps(j))
            if remote is not None:
                len_p.write_text(str(remote))
        except Exception:
            pass
    return j

def load_match(fid):
    j=_arc_cached(fid, f"{SUPA}/storage/v1/object/public/desk-archives/live/{fid}.json")
    if not j or "odds" not in j: return None
    byp=defaultdict(list)
    for o in j["odds"]:
        if o.get("SuperOddsType")=="1X2_PARTICIPANT_RESULT": byp[o.get("MarketPeriod")].append(o)
    if not byp: return None
    period=max(byp,key=lambda p:max(x["Ts"] for x in byp[p])-min(x["Ts"] for x in byp[p]))
    fair=[]
    for o in sorted(byp[period],key=lambda x:x["Ts"]):
        nm,pr=o.get("PriceNames") or [],o.get("Prices") or []
        dd={n:(1/(p/1000) if p and p>0 else 0) for n,p in zip(nm,pr)}; s=sum(dd.values())
        if s>0 and "part2" in dd: fair.append((o["Ts"],dd["part2"]/s))
    # fair span is the reliable window; trust the running-clock only when it clearly covers the match
    # (>=60min span AND ends within 15min of the fair end), else a flaky/early-dying clock truncates it.
    run=[x["Ts"] for x in j.get("scores",[]) if (x.get("Clock") or {}).get("Running")]
    kick,ft=fair[0][0],fair[-1][0]
    if run:
        rk,rf=min(run),max(run)
        if (rf-rk)>=60*60*1000 and (fair[-1][0]-rf)<=15*60*1000:
            kick,ft=rk,rf
    g1=g2=0
    for x in j.get("scores",[]):
        sc=x.get("Score") or {}
        a=((sc.get("Participant1") or {}).get("Total") or {}).get("Goals")
        b=((sc.get("Participant2") or {}).get("Total") or {}).get("Goals")
        if a is not None: g1=max(g1,a)
        if b is not None: g2=max(g2,b)
    return {"fair":fair,"fts":[t for t,_ in fair],"kick":kick,"ft":ft,"win2":1 if g2>g1 else 0,"g1":g1,"g2":g2}

def pm_series(fid, mm):
    fp=OUT/f"{fid}.fills.jsonl"
    if not fp.exists(): return None
    rows=[json.loads(l) for l in fp.read_text().splitlines() if l.strip()]
    seen=set(); u=[]
    for r in rows:
        k=(r["tx"],r["li"])
        if k in seen: continue
        seen.add(k); u.append(r)
    tsmap=enrich_ts(fid,u); fair,fts=mm["fair"],mm["fts"]
    fair_at=lambda ms: fair[bisect.bisect_right(fts,ms)-1][1] if bisect.bisect_right(fts,ms) else None
    toks=list({r["token"] for r in u}); best=None
    for yes in toks:
        tr=[]
        for r in u:
            bt=tsmap.get(str(r["blk"]))
            if bt is None: continue
            ms=bt*1000
            if not(mm["kick"]<=ms<=mm["ft"]): continue
            imp=r["price"] if r["token"]==yes else 1-r["price"]
            fv=fair_at(ms)
            if fv is None or not(0.02<=imp<=0.98): continue
            tr.append((ms,imp,r["shares"]*r["price"],r["tx"]))
        if not tr: continue
        err=sum(abs(i-fair_at(m)) for m,i,_,_ in tr)/len(tr)
        if best is None or err<best[0]: best=(err,sorted(tr))
    return best[1] if best else None

def compute(fid):
    mm=load_match(fid)
    if not mm: return None
    trades=pm_series(fid,mm)
    if not trades: return None
    fair,fts=mm["fair"],mm["fts"]
    fair_at=lambda ms: fair[bisect.bisect_right(fts,ms)-1][1] if bisect.bisect_right(fts,ms) else None
    tt=[t for t,_,_,_ in trades]; ii=[i for _,i,_,_ in trades]
    pm_at=lambda ms: ii[bisect.bisect_right(tt,ms)-1] if bisect.bisect_right(tt,ms) else None
    pmClose=ii[-1] if ii else None   # the market's last real fill = the closing line for CLV
    out_ent={}; out_edge={}
    for theta in THETAS:
        armed={1:True,-1:True}; ms=mm["kick"]; ents=[]
        while ms<=mm["ft"]:
            fv=fair_at(ms); pm=pm_at(ms)
            if fv is not None and pm is not None and 0.02<=fv<=0.98 and 0.02<=pm<=0.98:
                gap=fv-pm
                for sgn in (1,-1):
                    if gap*sgn>=theta and armed[sgn]:
                        armed[sgn]=False
                        # ENTRY FILL: the real on-chain fill that SET the entry price (last fill at/before
                        # the entry moment), shown in the side's own frame. Proves the cheap side really
                        # traded at `entry`, with its own Polygon tx.
                        ei=bisect.bisect_right(tt,ms)-1
                        entry_fill=None
                        if ei>=0:
                            et,ep,eu,etx=trades[ei]
                            entry_fill={"t":et//1000,"price":round(ep if sgn>0 else 1-ep,4),"tx":etx}
                        # EXIT FILLS = every REAL fill that traded AT or through the entry-fair target
                        # (side frame) from entry -> FT, above the dust floor. `reached` is DEFINED by this
                        # set being non-empty — one truth source for both the reach rate and the proofs, so
                        # a sparse cross the old 2s grid slipped over is now caught. gapPp = how far past
                        # fair the fill printed (>=0). t = unix seconds of the fill (for the replay clock).
                        lo=bisect.bisect_left(tt,ms); hi=bisect.bisect_right(tt,mm["ft"])
                        allx=[]
                        for k in range(lo,hi):
                            price=trades[k][1]; u=trades[k][2]
                            if u<SIZE_FLOOR: continue
                            if (sgn>0 and price>=fv) or (sgn<0 and price<=fv):
                                allx.append({"t":trades[k][0]//1000,"tx":trades[k][3],
                                             "price":round(price if sgn>0 else 1-price,4),
                                             "usd":round(u),"gapPp":round(sgn*(price-fv)*100,1)})
                        reached=len(allx)>0
                        usd=sum(x["usd"] for x in allx)                  # total exitable size at/through fair
                        # canonical exit proof = the fill CLOSEST to fair (smallest gap past it): the trade
                        # that best represents exiting AT fair. Falls back to the nearest available print
                        # when the price gapped clean through fair with nothing sitting on it.
                        exit_fill=min(allx,key=lambda z:z["gapPp"]) if allx else None
                        # displayed fills: closest-to-fair first (was biggest-by-size, which surfaced fills
                        # far past fair on gapped moves), capped at 6.
                        efills=sorted(allx,key=lambda z:z["gapPp"])[:6]
                        win=mm["win2"] if sgn>0 else 1-mm["win2"]
                        paid=pm if sgn>0 else 1-pm                       # price paid on the cheap side
                        closeS=(pmClose if sgn>0 else 1-pmClose) if pmClose is not None else paid
                        clv=closeS-paid                                  # closing-line value in prob points
                        ents.append({"t":ms//1000,"side":"yes" if sgn>0 else "no",
                                     "entry":round(paid,4),"fair":round(fv,4),
                                     "gap":round(abs(gap),4),"reached":reached,"win":win,"usd":round(usd),
                                     "clv":round(clv,4),"incl":True,"fills":efills,
                                     "entryFill":entry_fill,"exitFill":exit_fill})  # no exclusion filter: every call counts
                    if gap*sgn<theta*0.5: armed[sgn]=True
            ms+=STEP
        inc=[e for e in ents if e.get("incl",True)]; n=len(inc); reach=sum(e["reached"] for e in inc)
        cost=sum(e["entry"] for e in inc); winsum=sum(e["win"] for e in inc)
        tpsum=sum(tp_pnl(e) for e in inc); clvsum=sum(e["clv"] for e in inc)
        out_ent[str(int(theta*100))]=ents
        out_edge[str(int(theta*100))]={"theta":theta,"n":n,"reachRate":round(reach/n,3) if n else 0,
                       "winRate":round(winsum/n,3) if n else 0,"usd":round(sum(e["usd"] for e in inc)),
                       "aggEdgePct":round((winsum-cost)/cost,4) if cost else 0,
                       "tpReturn":round(tpsum/cost,4) if cost else 0,
                       "clvAvg":round(clvsum/n,4) if n else 0,
                       "kellyRoi":round(prod(kelly_mult_tp(e) for e in inc)-1,4) if n else 0}
    out_edge["regResult"]=[mm.get("g1"),mm.get("g2")]   # regulation goals, for honest winner grading
    # fine 1s change-based replay series: [secFromKick, fair, pm], emit only on a value change
    series=[]; last=None; t=mm["kick"]
    while t<=mm["ft"]:
        fv=fair_at(t); pm=pm_at(t)
        if fv is not None:
            pair=(round(fv,4), round(pm,4) if pm is not None else None)
            if pair!=last:
                series.append([round((t-mm["kick"])/1000), pair[0], pair[1]]); last=pair
        t+=1000
    if len(series)>3500:
        stp=len(series)//3500+1; series=series[::stp]
    return out_ent,out_edge,series

# take-profit-at-reach P&L per call (steam follow): the gap closes ~70% of the time -> exit at
# TxLINE's fair, locking the gap; otherwise hold to resolution (pays 1 if the side won, else 0).
def tp_pnl(e):
    return e["gap"] if e["reached"] else (e["win"]-e["entry"])

# Kelly sizing on the fair-vs-price edge: f = gap / (1 - entry), CAPPED at KELLY_CAP (never stake more
# than that fraction on one call). Full Kelly over-bets an edge estimated from a stale-price gap; the cap
# bounds single-bet drawdown while keeping every call. MUST match KELLY_CAP in lib/signals/policy.ts.
# Bankroll multiplier for one call under each exit; compounding these (product) gives Kelly ROI.
KELLY_CAP = 0.3
def kelly_f(e):
    d = 1.0 - e["entry"]
    return max(0.0, min(KELLY_CAP, e["gap"]/d)) if d > 0 else 0.0
def kelly_mult_tp(e):    # exit at fair on reach, else mark out at the close (never resolution)
    r = ((e["gap"] if e["reached"] else e.get("clv",0)) / e["entry"]) if e["entry"] > 0 else 0.0
    return 1.0 + kelly_f(e)*r
def kelly_mult_res(e):   # hold to resolution (pays 1 if the side won, else 0)
    r = ((1.0-e["entry"])/e["entry"]) if e["win"] else -1.0
    return 1.0 + kelly_f(e)*r
def prod(vals):
    p = 1.0
    for v in vals: p *= v
    return p

def agg(entries):
    entries=[e for e in entries if e.get("incl",True)]  # incl is always True now (no exclusion filter); kept for old-blob compat
    n=len(entries)
    if not n: return {"n":0,"reachRate":0,"aggEdgePct":0,"tpReturn":0,"clvAvg":0,"kellyRoi":0,"kellyRoiRes":0,"usd":0}
    cost=sum(e["entry"] for e in entries); win=sum(e["win"] for e in entries)
    tp=sum(tp_pnl(e) for e in entries); clv=sum(e.get("clv",0) for e in entries)
    return {"n":n,"reachRate":round(sum(e["reached"] for e in entries)/n,3),
            "aggEdgePct":round((win-cost)/cost,4) if cost else 0,
            "tpReturn":round(tp/cost,4) if cost else 0,"clvAvg":round(clv/n,4),
            "kellyRoi":round(prod(kelly_mult_tp(e) for e in entries)-1,4),
            "kellyRoiRes":round(prod(kelly_mult_res(e) for e in entries)-1,4),
            "usd":round(sum(e["usd"] for e in entries))}

# match-level bootstrap 90% CI on a compounding (product) metric: resample matches, multiply every
# call's bankroll multiplier, subtract 1. Used for Kelly ROI (order-independent, so match-clustered).
def bootstrap_prod_ci(per_match_entries, mult, B=2000):
    ms=[e for e in per_match_entries if e]
    if len(ms)<2: return None
    vals=[]
    for _ in range(B):
        p=1.0
        for _ in range(len(ms)):
            for x in random.choice(ms): p*=mult(x)
        vals.append(p-1.0)
    if not vals: return None
    vals.sort()
    return [round(vals[int(0.05*len(vals))],4), round(vals[int(0.95*len(vals))],4)]

# match-level bootstrap 90% CI on the MEAN of a per-call key (e.g. CLV: additive pp, not a ratio).
def bootstrap_mean_ci(per_match_entries, key, B=2000):
    ms=[e for e in per_match_entries if e]
    if len(ms)<2: return None
    vals=[]
    for _ in range(B):
        pool=[]
        for _ in range(len(ms)): pool+=random.choice(ms)
        if pool: vals.append(sum(x.get(key,0) for x in pool)/len(pool))
    if not vals: return None
    vals.sort()
    return [round(vals[int(0.05*len(vals))],4), round(vals[int(0.95*len(vals))],4)]

# match-level bootstrap 90% CI on a per-call numerator function (denominator = price paid).
def bootstrap_ci(per_match_entries, pnl, B=2000):
    ms=[e for e in per_match_entries if e]
    if len(ms)<2: return None
    vals=[]
    for _ in range(B):
        pool=[]
        for _ in range(len(ms)): pool+=random.choice(ms)
        cost=sum(x["entry"] for x in pool); num=sum(pnl(x) for x in pool)
        if cost: vals.append(num/cost)
    if not vals: return None
    vals.sort()
    return [round(vals[int(0.05*len(vals))],4), round(vals[int(0.95*len(vals))],4)]

def publish_pooled(pooled):
    KEY=os.environ.get("SUPABASE_SERVICE_ROLE_KEY","")
    matches=[]
    for f in sorted(glob.glob(str(OUT/"*.surface.json"))):
        try: matches.append(json.loads(open(f).read()))
        except Exception: continue
    matches=[m for m in matches if str(m.get("fid")) not in EXCLUDE_FIDS and (m.get("inplay") or {}).get("fills")]
    matches.sort(key=lambda m:-(m.get("inplay",{}).get("usd") or 0))
    blob={"generatedAt":int(time.time()*1000),"matchCount":len(matches),
          "totals":{"usd":sum(m["inplay"]["usd"] for m in matches),
                    "ge5pp_usd":sum(m["inplay"].get("ge5pp_usd",0) for m in matches),
                    "ge10pp_usd":sum(m["inplay"].get("ge10pp_usd",0) for m in matches),
                    "fills":sum(m["inplay"]["fills"] for m in matches)},
          "pooled":pooled,"matches":matches}
    open("/tmp/pickoffs.json","w").write(json.dumps(blob))
    url=f"{SUPA}/storage/v1/object/desk-archives/pickoffs.json"
    code=subprocess.run(["curl","-s","-o","/dev/null","-w","%{http_code}","-X","POST",url,
        "-H",f"Authorization: Bearer {KEY}","-H",f"apikey: {KEY}","-H","Content-Type: application/json",
        "-H","x-upsert: true","--data-binary","@/tmp/pickoffs.json"],capture_output=True,text=True).stdout
    print("published", len(matches), "matches + pooled -> HTTP", code, flush=True)

# VOLUME-TO-DIVERGENCE WINNER HINT (pilot: n=12, in-sample). A late, DIRECTIONAL read on the match
# winner, separate from the lag edge: per team, cumulative real volume (usd that traded through fair)
# per point of divergence. The side with more money per point of divergence tends to WIN; heavy
# divergence with little volume behind it marks the loser (the market rightly fades it). yes backs
# participant 2, no backs participant 1. Fire only on the CONFIDENT subset: the leader's ratio is
# >= WH_MARGIN x the other side AND the leader has real volume behind it; else abstain (None).
WH_MARGIN=4.0        # fire when the leader's volume-per-divergence is this many x the other side
WH_MIN_USD=50000     # ...and the leader has at least this much real volume (else it is not conviction)

def _side_ratio(ents, side):
    us=sum(e.get("usd",0) for e in ents if e["side"]==side)
    gp=sum(abs(e.get("gap",0)) for e in ents if e["side"]==side)
    return (us/gp if gp>0 else None), us

def winner_hint(fid, ents5, kick, teams, reg=None):
    ts=(teams or "").split(" v ")
    if len(ts)!=2 or not ents5: return None
    r2,u2=_side_ratio(ents5,"yes"); r1,u1=_side_ratio(ents5,"no")
    if r1 is None and r2 is None: return None
    if r2 is not None and (r1 is None or r2>=r1): leader,lr,lu,other=2,r2,u2,r1
    else: leader,lr,lu,other=1,r1,u1,r2
    if lu<WH_MIN_USD: return None                       # abstain: leader has no real volume
    margin=(lr/other) if (other and other>0) else float("inf")
    if margin<WH_MARGIN: return None                    # abstain: not far enough ahead
    # when it fired: earliest call at which the running leader matches, is >= the margin, and has volume
    fire_ts=fire_min=None
    cu={"yes":0.0,"no":0.0}; cg={"yes":0.0,"no":0.0}
    for e in sorted(ents5, key=lambda x: x.get("t",0)):
        cu[e["side"]]+=e.get("usd",0); cg[e["side"]]+=abs(e.get("gap",0))
        ry=(cu["yes"]/cg["yes"]) if cg["yes"]>0 else None
        rn=(cu["no"]/cg["no"]) if cg["no"]>0 else None
        lead_r,oth_r,lead_u = (ry,rn,cu["yes"]) if leader==2 else (rn,ry,cu["no"])
        if lead_r is None or lead_u<WH_MIN_USD: continue
        run_margin=(lead_r/oth_r) if (oth_r and oth_r>0) else float("inf")
        if run_margin>=WH_MARGIN:
            fire_ts=e.get("t")
            fire_min=max(0,round((e.get("t",0)*1000-(kick or 0))/60000)) if kick else None
            break
    # Grade against the real regulation scoreline. A decisive result (g1 != g2) resolves the winner;
    # a draw went to extra time or penalties, which regulation goals cannot settle, so we leave it
    # PENDING (correct=None) rather than assert a winner. As the pipeline confirms outcomes, pending
    # matches resolve and the accuracy tally evolves; nothing here is hardcoded.
    g1=g2=None
    if reg and len(reg)==2: g1,g2=reg
    if g1 is None or g2 is None:
        true_winner=None
    elif g1>g2: true_winner=1
    elif g2>g1: true_winner=2
    else: true_winner=None            # regulation draw -> extra time / penalties -> pending
    resolved = true_winner is not None
    correct = (leader==true_winner) if resolved else None
    return {"fid":str(fid), "team":leader, "teamName":ts[leader-1].strip(),
            "margin": None if margin==float("inf") else round(margin,2),
            "atMin":fire_min, "ts":fire_ts, "leaderUsd":round(lu),
            "correct":correct, "resolved":resolved, "n":12, "inSample":True}

if __name__=="__main__":
    per={"5":[],"10":[]}
    for f in sorted(glob.glob(str(OUT/"*.surface.json"))):
        surf=json.loads(open(f).read()); fid=str(surf["fid"])
        if fid in EXCLUDE_FIDS: print(fid,"excluded",flush=True); continue
        r=compute(fid)
        if not r: print(fid,"skip",flush=True); continue
        ents,edge,series=r; surf["divergences"]=ents; surf["edge"]=edge; surf["series"]=series
        surf["winnerHint"]=winner_hint(surf.get("fid"), ents["5"], surf.get("kick"), surf.get("teams"), edge.get("regResult"))
        open(f,"w").write(json.dumps(surf,indent=1))
        for k in ("5","10"): per[k].append([e for e in ents[k] if e.get("incl",True)])
        print(surf["teams"][:20], "n",edge["5"]["n"], "reach",edge["5"]["reachRate"], "edge",edge["5"]["aggEdgePct"], "usd",edge["5"]["usd"], flush=True)
    pooled={}
    for k in ("5","10"):
        alle=[e for m in per[k] for e in m]
        a=agg(alle)
        a["ci90"]=bootstrap_ci(per[k], lambda x: x["win"]-x["entry"])
        a["tpCi90"]=bootstrap_ci(per[k], tp_pnl)
        a["clvCi90"]=bootstrap_mean_ci(per[k], "clv")
        a["kellyCi90"]=bootstrap_prod_ci(per[k], kelly_mult_tp)
        a["theta"]=int(k)/100; pooled[k]=a
        print("POOLED",k,a,flush=True)
    publish_pooled(pooled)
