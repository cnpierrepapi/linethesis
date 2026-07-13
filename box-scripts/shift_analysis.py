# Does a significant TxLINE odds shift toward a team predict that team winning?
# TxLINE demargined 1X2 frames only (desk-archives/live/<fid>.json). No Polymarket data.
# Shift = a team's de-vig win probability rising >= theta pp within one 60s grid step, in-play.
# Rules graded: FIRST shift / LAST shift / LARGEST shift -> predicted winner vs regulation result.
# Baseline: favourite at kickoff. Shifts tagged goal-adjacent (within 2 min of a goal frame).
import json, math, os, bisect, urllib.request
from collections import defaultdict

SUPA = os.environ["SUPABASE_URL"]

def get(u):
    return json.load(urllib.request.urlopen(u))

pk = get(SUPA + "/storage/v1/object/public/desk-archives/pickoffs.json")
matches = [(str(m["fid"]), m["teams"]) for m in pk["matches"]]

def load(fid):
    j = get(SUPA + "/storage/v1/object/public/desk-archives/live/%s.json" % fid)
    byp = defaultdict(list)
    for o in j["odds"]:
        if o.get("SuperOddsType") == "1X2_PARTICIPANT_RESULT":
            byp[o.get("MarketPeriod")].append(o)
    period = max(byp, key=lambda p: max(x["Ts"] for x in byp[p]) - min(x["Ts"] for x in byp[p]))
    ser = []  # (ts, p1, p2) de-vig win probs, same maths as compute_edge.py
    for o in sorted(byp[period], key=lambda x: x["Ts"]):
        nm, pr = o.get("PriceNames") or [], o.get("Prices") or []
        dd = {n: (1 / (p / 1000) if p and p > 0 else 0) for n, p in zip(nm, pr)}
        s = sum(dd.values())
        if s > 0 and "part1" in dd and "part2" in dd:
            ser.append((o["Ts"], dd["part1"] / s, dd["part2"] / s))
    run = [x["Ts"] for x in j.get("scores", []) if (x.get("Clock") or {}).get("Running")]
    kick, ft = (min(run), max(run)) if run else (ser[0][0], ser[-1][0])
    goals = []
    last = [0, 0]
    for x in sorted(j.get("scores", []), key=lambda x: x["Ts"]):
        sc = x.get("Score") or {}
        a = ((sc.get("Participant1") or {}).get("Total") or {}).get("Goals") or 0
        b = ((sc.get("Participant2") or {}).get("Total") or {}).get("Goals") or 0
        if a > last[0]: goals.append((x["Ts"], 1)); last[0] = a
        if b > last[1]: goals.append((x["Ts"], 2)); last[1] = b
    return ser, kick, ft, last[0], last[1], goals

def analyze(fid, teams):
    ser, kick, ft, g1, g2, goals = load(fid)
    ts = [r[0] for r in ser]
    def pat(ms, i):
        k = bisect.bisect_right(ts, ms) - 1
        return ser[k][i] if k >= 0 else None
    grid = list(range(int(kick), int(ft), 60000))
    events = []  # (ts, team, delta_pp, goal_adjacent)
    for t in grid[1:]:
        for i in (1, 2):
            a, b = pat(t - 60000, i), pat(t, i)
            if a is None or b is None: continue
            d = (b - a) * 100
            if d > 0:
                ga = any(abs(t - gt) <= 120000 for gt, _ in goals)
                events.append((t, i, d, ga))
    winner = 1 if g1 > g2 else (2 if g2 > g1 else 0)
    fav = 1 if (pat(kick, 1) or 0) >= (pat(kick, 2) or 0) else 2
    return {"teams": teams, "score": "%d-%d" % (g1, g2), "winner": winner,
            "fav": fav, "kick": kick, "events": events}

TH = [5, 10, 15]
rows = []
for fid, teams in matches:
    try:
        rows.append((fid, analyze(fid, teams)))
    except Exception as e:
        print("SKIP", fid, teams, repr(e))

print("PER-MATCH (theta=10pp, FIRST-shift rule):")
for fid, m in rows:
    ev10 = [e for e in m["events"] if e[2] >= 10]
    if ev10:
        f = ev10[0]
        team = m["teams"].split(" v ")[f[1] - 1].strip()
        minute = round((f[0] - m["kick"]) / 60000)
        ok = "WIN" if m["winner"] == f[1] else ("draw" if m["winner"] == 0 else "LOSS")
        print("  %-26s %s  1st: %-12s +%.1fpp @%3dm goal_adj=%-5s n=%d -> %s" %
              (m["teams"], m["score"], team, f[2], minute, f[3], len(ev10), ok))
    else:
        print("  %-26s %s  no 10pp shift" % (m["teams"], m["score"]))

def wilson(k, n, z=1.645):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round((c - h) * 100), round((c + h) * 100))

print("")
print("CUMULATIVE:")
for th in TH:
    for rule in ("first", "last", "max"):
        pairs = []
        for fid, m in rows:
            ev = [e for e in m["events"] if e[2] >= th]
            if not ev: continue
            e = ev[0] if rule == "first" else (ev[-1] if rule == "last" else max(ev, key=lambda x: x[2]))
            pairs.append((m, e))
        n = len(pairs)
        k = sum(1 for m, e in pairs if m["winner"] == e[1])
        ga = sum(1 for m, e in pairs if e[3])
        favk = sum(1 for m, e in pairs if m["winner"] == m["fav"])
        lo, hi = wilson(k, n)
        pct = round(100 * k / n) if n else 0
        fpct = round(100 * favk / n) if n else 0
        print("  th=%2dpp rule=%-5s: %d/%d = %2d%%  CI90[%d,%d]  goal_adj %d/%d  favourite-baseline %d%%" %
              (th, rule, k, n, pct, lo, hi, ga, n, favk and fpct or 0))

n = len(rows)
favk = sum(1 for _, m in rows if m["winner"] == m["fav"])
draws = sum(1 for _, m in rows if m["winner"] == 0)
print("")
print("  all %d matches: favourite-at-kick wins %d/%d = %d%% ; regulation draws %d/%d" %
      (n, favk, n, round(100 * favk / n), draws, n))

# --- PASS 2: time-stratified + incremental-value control -------------------
# (a) Only shifts occurring by minute M (45/60/75): does an EARLY shift predict the final result,
#     or was the 83% carried by late shifts that ARE the deciding goal?
# (b) Control: at the moment of the shift, the current favourite (higher fair) usually IS the shift
#     team. Grade "favourite at shift time" alone; if it matches the shift rule, the shift adds nothing.
print("")
print("TIME-STRATIFIED (theta=10pp, FIRST shift <= cutoff):")
for cutoff in (45, 60, 75, 999):
    pairs = []
    for fid, m in rows:
        ev = [e for e in m["events"] if e[2] >= 10 and (e[0] - m["kick"]) / 60000 <= cutoff]
        if ev: pairs.append((m, ev[0]))
    n = len(pairs)
    k = sum(1 for m, e in pairs if m["winner"] == e[1])
    lo, hi = wilson(k, n)
    lab = "<=%dm" % cutoff if cutoff < 999 else "all  "
    print("  %s : %d/%d = %2d%%  CI90[%d,%d]" % (lab, k, n, round(100 * k / n) if n else 0, lo, hi))

print("")
print("INCREMENTAL VALUE (theta=10pp, first shift): shift-team vs favourite-at-that-moment:")
agree = 0; n = 0; shift_k = 0; fav_now_k = 0
for fid, m in rows:
    ev = [e for e in m["events"] if e[2] >= 10]
    if not ev: continue
    e = ev[0]
    ser, kick, ft, g1, g2, goals = load(fid)
    ts = [r[0] for r in ser]
    kk = bisect.bisect_right(ts, e[0]) - 1
    p1, p2 = ser[kk][1], ser[kk][2]
    fav_now = 1 if p1 >= p2 else 2
    n += 1
    agree += 1 if fav_now == e[1] else 0
    shift_k += 1 if m["winner"] == e[1] else 0
    fav_now_k += 1 if m["winner"] == fav_now else 0
print("  shift-team correct  : %d/%d" % (shift_k, n))
print("  fav-at-shift correct: %d/%d" % (fav_now_k, n))
print("  shift-team == fav-at-shift in %d/%d matches" % (agree, n))
