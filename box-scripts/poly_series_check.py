#!/usr/bin/env python3
# GROUND-TRUTH CHECK: overlay TxLINE demargined P(France) vs Polymarket midpoint history
# across the Paraguay v France match. If they track (with lag) the pickoff surface is real;
# if they diverge persistently, the TxLINE fair (period/mapping) is wrong.
import json, subprocess, bisect, datetime as dt
from collections import defaultdict
SUPA="https://mohbmvajroqizlfaarjk.supabase.co"
YES="113891226639705983282066963484423345278150974279743795316461155085208879415201"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
def curl(url,*a): return subprocess.run(["curl","-s","--max-time","30",*a,url],capture_output=True,text=True).stdout

j=json.loads(curl(f"{SUPA}/storage/v1/object/public/desk-archives/live/18188721.json"))
# TxLINE fair per 1X2 period + goals
byp=defaultdict(list)
for o in j["odds"]:
    if o.get("SuperOddsType")=="1X2_PARTICIPANT_RESULT": byp[o.get("MarketPeriod")].append(o)
def series(period):
    fair=[]
    for o in sorted(byp[period],key=lambda x:x["Ts"]):
        nm,pr=o.get("PriceNames") or [],o.get("Prices") or []
        dd={n:(1/(p/1000) if p and p>0 else 0) for n,p in zip(nm,pr)}; s=sum(dd.values())
        if s>0 and "part2" in dd: fair.append((o["Ts"],dd["part2"]/s))
    return fair
periods={p:series(p) for p in byp}
# goals from scores
goals=[]
prev={"Participant1":0,"Participant2":0}
for s in sorted(j.get("scores",[]),key=lambda x:x["Ts"]):
    sc=s.get("Score") or {}
    for side in ("Participant1","Participant2"):
        g=((sc.get(side) or {}).get("Total") or {}).get("Goals")
        if g is not None and g>prev[side]:
            goals.append((s["Ts"],side,g)); prev[side]=g
print("GOALS:")
for ts,side,g in goals:
    print(f"  {dt.datetime.utcfromtimestamp(ts/1000):%H:%M:%S}  {side} -> {g}")

# Polymarket midpoint history over the match window (fidelity=1)
run=[s["Ts"] for s in j.get("scores",[]) if (s.get("Clock") or {}).get("Running")]
kick,ft=min(run),max(run)
ph=json.loads(curl(f"https://clob.polymarket.com/prices-history?market={YES}&startTs={kick//1000-120}&endTs={ft//1000+120}&fidelity=1","-H",f"User-Agent: {UA}"))
pm=[(p["t"]*1000,p["p"]) for p in ph.get("history",[])]
print(f"\nPM midpoint points: {len(pm)}  ({dt.datetime.utcfromtimestamp(kick/1000):%H:%M} .. {dt.datetime.utcfromtimestamp(ft/1000):%H:%M})")

def at(series_ts, series, ms):
    ts=[t for t,_ in series]; i=bisect.bisect_right(ts,ms)-1; return series[i][1] if i>=0 else None
print("\ntime      TxL(None) TxL(half1)  PM_mid   | dP=PM-TxL(None)")
for k in range(0, int((ft-kick)/60000)+1, 8):   # every 8 min
    ms=kick+k*60000
    tN=at(None,periods.get(None,[]),ms); tH=at("half=1",periods.get("half=1",[]),ms); pmid=at(None,pm,ms)
    def f(x): return f"{x:.3f}" if x is not None else "  -  "
    dP = (pmid-tN) if (pmid is not None and tN is not None) else None
    print(f"{dt.datetime.utcfromtimestamp(ms/1000):%H:%M}    {f(tN)}    {f(tH)}     {f(pmid)}   | {('%+.3f'%dP) if dP is not None else '-'}")
