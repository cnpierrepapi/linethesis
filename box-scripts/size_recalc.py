# REVIEW ONLY (no writes): per call, recompute "size available" using fills AT the TxLINE fair
# (the take-profit exit price that gives the ROI) vs the current at-stale-price size. Prints a table.
import bisect, sys
import compute_edge as ce

THETA = float(sys.argv[1]) if len(sys.argv) > 1 else 0.05

def recalc(fid):
    mm = ce.load_match(fid)
    if not mm: return None
    trades = ce.pm_series(fid, mm)
    if not trades: return None
    fair, fts = mm["fair"], mm["fts"]
    fair_at = lambda ms: fair[bisect.bisect_right(fts, ms)-1][1] if bisect.bisect_right(fts, ms) else None
    tt = [t for t, _, _, _ in trades]; ii = [i for _, i, _, _ in trades]
    pm_at = lambda ms: ii[bisect.bisect_right(tt, ms)-1] if bisect.bisect_right(tt, ms) else None
    rows = []
    armed = {1: True, -1: True}; ms = mm["kick"]; STEP = ce.STEP
    while ms <= mm["ft"]:
        fv = fair_at(ms); pm = pm_at(ms)
        if fv is not None and pm is not None and 0.02 <= fv <= 0.98 and 0.02 <= pm <= 0.98:
            gap = fv - pm
            for sgn in (1, -1):
                if gap*sgn >= THETA and armed[sgn]:
                    armed[sgn] = False
                    reached = False; reach_ms = mm["ft"]; t2 = ms+1
                    while t2 <= mm["ft"]:
                        p2 = pm_at(t2)
                        if p2 is not None and ((sgn > 0 and p2 >= fv) or (sgn < 0 and p2 <= fv)):
                            reached = True; reach_ms = t2; break
                        t2 += STEP
                    lo = bisect.bisect_left(tt, ms); hi = bisect.bisect_right(tt, reach_ms)
                    stale = 0.0
                    for k in range(lo, hi):
                        fv2 = fair_at(trades[k][0])
                        if fv2 is None: continue
                        price = trades[k][1]; usd = trades[k][2]
                        # old: fills sitting at the stale/cheap price (>=theta off fair on the cheap side)
                        if (sgn > 0 and fv2-price >= THETA) or (sgn < 0 and price-fv2 >= THETA): stale += usd
                    # NEW (agreed): only if reached/surpassed; fills at/through the FIXED entry-fair target,
                    # from entry to full time. Never reached -> $0 (you could never exit at that price).
                    atfair = 0.0
                    if reached:
                        hi2 = bisect.bisect_right(tt, mm["ft"])
                        for k in range(lo, hi2):
                            price = trades[k][1]; usd = trades[k][2]
                            if (sgn > 0 and price >= fv) or (sgn < 0 and price <= fv): atfair += usd
                    rows.append({"min": (ms-mm["kick"])//60000, "side": "yes" if sgn > 0 else "no",
                                 "entry": (pm if sgn > 0 else 1-pm), "fair": (fv if sgn > 0 else 1-fv),
                                 "gap": abs(gap)*100, "reached": reached,
                                 "stale": round(stale), "atfair": round(atfair)})
                if gap*sgn < THETA*0.5: armed[sgn] = True
        ms += STEP
    return rows

if __name__ == "__main__":
    import glob, json, os
    fixmap = []
    for f in sorted(glob.glob(str(ce.OUT/"*.surface.json"))):
        try:
            s = json.loads(open(f).read()); fixmap.append((str(s["fid"]), s.get("teams", s["fid"])))
        except Exception: pass
    print(f"theta = {THETA*100:.0f}pp\n")
    tot_s = tot_f = 0
    for fid, teams in fixmap:
        rows = recalc(fid)
        if not rows: continue
        print(f"== {teams} ==")
        print(f"  {'min':>4} {'side':>4} {'entry':>6} {'fair':>6} {'gap':>5}  {'reach':>5}  {'OLD size(stale)':>16}  {'NEW size(@fair)':>16}")
        for x in rows:
            tot_s += x["stale"]; tot_f += x["atfair"]
            print(f"  {x['min']:>4} {x['side']:>4} {x['entry']:>6.3f} {x['fair']:>6.3f} {x['gap']:>4.1f}pp  {'Y' if x['reached'] else 'n':>5}  ${x['stale']:>15,}  ${x['atfair']:>15,}")
        print()
    print(f"TOTAL  OLD(stale) ${tot_s:,}   NEW(@fair) ${tot_f:,}")
