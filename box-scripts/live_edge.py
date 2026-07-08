#!/usr/bin/env python3
# LIVE EDGE DETECTOR — REAL-FILL based (fix for the "live missed what /proof shows" gap).
#
# For each in-play fixture we no longer compare the TxLINE fair to the Polymarket CLOB *midpoint*
# once a minute (a quote, sampled coarsely — it never saw the fill-level dislocations /proof records).
# Instead we anchor REAL Polymarket fills (poly_live_collector → ~/poly-live/{cond}.jsonl) to the
# TxLINE de-vig fair AT the fill's timestamp (±2s), exactly like the offline compute_edge/proof path.
# A fill is an ENTRY only if the fair was higher than the fill's implied price by >= THETA at that
# instant (±2s); the EXIT is a later REAL fill that traded at/through that entry-time fair. Both legs
# carry their Polygon tx, so the bot paper-trades on real, verifiable fills — the same edge /proof
# proves, now visible live. Falls back to the midpoint read only when no fills are collected yet.
#
# Publishes desk-archives/live-edge.json (shape unchanged + entryFill/exitFill/entry/minute added).
#   test: python3 live_edge.py --fid 18202783   (prints the signal it would emit for one fixture)
import json, os, time, bisect, subprocess, sys
from collections import defaultdict
import poly_pickoff_system as P

SUPA = P.SUPA
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BASE = os.environ.get("TXLINE_API_BASE", ""); JWT = os.environ.get("TXLINE_JWT", ""); TOK = os.environ.get("TXLINE_API_TOKEN", "")
HDR = ["-H", "Authorization: Bearer " + JWT, "-H", "X-Api-Token: " + TOK]
UA = "Mozilla/5.0"
THETA = 0.05        # 5pp gap threshold (matches compute_edge / the paid feed)
FLOOR = 50          # a fill must move >= $50 to count as an entry or exit (dust guard, == SIZE_FLOOR)
ANCHOR_MS = 2000    # a fill is anchored to the fair reading within +/-2s of its timestamp
CLOSED_KEEP_MS = 5 * 60 * 1000  # keep publishing a just-closed episode (with its exit fill) for 5 min
CAP_DIR = os.path.expanduser("~/agenthesis/captures_live")
LIVE_DIR = os.path.expanduser("~/poly-live")


def tget(path):
    out = subprocess.run(["curl", "-s", "--max-time", "10", *HDR, BASE + path], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return None


def live_fixtures():
    snap = tget("/api/fixtures/snapshot")
    fx = snap if isinstance(snap, list) else (snap or {}).get("fixtures", [])
    now = time.time() * 1000; out = []
    for f in fx:
        st = float(f.get("StartTime") or 0)
        if st and st <= now and now - st <= 3 * 3600 * 1000:
            out.append({"fid": f.get("FixtureId"), "p1": f.get("Participant1"), "p2": f.get("Participant2"), "start": st})
    return out


def fair_series(fid):
    # freshest fair first: the archiver's live local capture (~2s cadence), else the published blob.
    j = None
    p = os.path.join(CAP_DIR, "%s.json" % fid)
    if os.path.exists(p):
        try:
            j = json.load(open(p))
        except Exception:
            j = None
    if j is None:
        j = P.dget("%s/storage/v1/object/public/desk-archives/live/%s.json" % (SUPA, fid))
    if not j or "odds" not in j:
        return None
    byp = defaultdict(list)
    for o in j["odds"]:
        if o.get("SuperOddsType") == "1X2_PARTICIPANT_RESULT":
            byp[o.get("MarketPeriod")].append(o)
    if not byp:
        return None
    period = max(byp, key=lambda pp: max(x["Ts"] for x in byp[pp]) - min(x["Ts"] for x in byp[pp]))
    fair = []
    for o in sorted(byp[period], key=lambda x: x["Ts"]):
        nm, pr = o.get("PriceNames") or [], o.get("Prices") or []
        dd = {n: (1.0 / (v / 1000.0) if v and v > 0 else 0) for n, v in zip(nm, pr)}
        s = sum(dd.values())
        if s > 0 and "part2" in dd:
            fair.append((o["Ts"], dd["part2"] / s))
    if not fair:
        return None
    run = [s["Ts"] for s in j.get("scores", []) if (s.get("Clock") or {}).get("Running")]
    kick, ft = (min(run), max(run)) if run else (fair[0][0], fair[-1][0])
    return {"fair": fair, "fts": [t for t, _ in fair], "kick": kick, "ft": ft}


def load_fills(cond, kick, ft):
    p = os.path.join(LIVE_DIR, "%s.jsonl" % cond)
    if not os.path.exists(p):
        return []
    out = []
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        ts = int(float(r.get("timestamp", 0)) * 1000)
        if ts < kick or ts > ft:
            continue
        price = float(r.get("price", 0)); size = float(r.get("size", 0))
        if not (0 < price < 1):
            continue
        imp = price if r.get("outcome") == "Yes" else 1 - price  # implied P(part2 wins)
        out.append((ts, imp, price * size, r.get("transactionHash")))
    out.sort()
    return out


def detect(fid, teams, mm, trades):
    # Episode scan (mirror of compute_edge's sgn logic) over REAL fills. Returns the CURRENT signal
    # for the fixture (the open episode, or a just-closed one within CLOSED_KEEP_MS), or None.
    fair, fts, ft = mm["fair"], mm["fts"], mm["ft"]
    if not trades or not fair:
        return None

    def fair_anchored(ms):
        lo = bisect.bisect_left(fts, ms - ANCHOR_MS); hi = bisect.bisect_right(fts, ms + ANCHOR_MS)
        if hi > lo:
            b = min(range(lo, hi), key=lambda k: abs(fts[k] - ms))
            return fair[b][1]
        i = bisect.bisect_right(fts, ms) - 1
        return fair[i][1] if i >= 0 else None

    episodes = []; side = 0; ent = None
    for (ts, imp, usd, tx) in trades:
        fv = fair_anchored(ts)
        if fv is None:
            continue
        gap = fv - imp  # >0 → YES cheap (market too low); <0 → NO cheap (market too high)
        sg = 1 if gap >= THETA else (-1 if gap <= -THETA else 0)
        if side == 0:
            if sg != 0 and usd >= FLOOR:
                side = sg
                ent = {"t": ts, "fairP2": fv, "side": "yes" if sg > 0 else "no",
                       "entry": round(imp if sg > 0 else 1 - imp, 4), "gapPp": round(abs(gap) * 100, 1),
                       "entryTx": tx}
        else:
            reached = (side > 0 and imp >= ent["fairP2"]) or (side < 0 and imp <= ent["fairP2"])
            if reached and usd >= FLOOR:
                ent["exit"] = {"t": ts, "price": round(imp if side > 0 else 1 - imp, 4),
                               "gapPp": round((imp - ent["fairP2"]) * side * 100, 1), "exitTx": tx}
                episodes.append(ent); side = 0; ent = None
    if ent:
        episodes.append(ent)
    if not episodes:
        return None

    cur = episodes[-1]
    open_now = "exit" not in cur
    now_ms = time.time() * 1000
    if not open_now and (now_ms - cur["exit"]["t"]) > CLOSED_KEEP_MS:
        return None  # nothing current on this fixture

    cur_fair = fair[-1][1]      # current fair P(part2)
    pm_now = trades[-1][1]      # current market P(part2) (latest real fill)
    sig = {
        "fid": str(fid), "teams": teams, "side": cur["side"],
        "fair": round(cur["fairP2"], 4),        # entry-time fair P(part2) == the take-profit basis
        "pm": round(pm_now, 4),                 # CURRENT market P(part2) — the bot settles against this
        "entry": round(cur["entry"], 4),        # entry price on the bought side (from the real entry fill)
        "gapPp": round(cur["gapPp"], 1),
        "diverged": bool(open_now and abs(cur_fair - pm_now) >= THETA),
        "ts": int(cur["t"]),
        "minute": max(0, round((cur["t"] - mm["kick"]) / 60000.0, 1)),
        "entryFill": {"t": int(cur["t"] // 1000), "price": round(cur["entry"], 4), "tx": cur["entryTx"]},
        "src": "fill",
    }
    if "exit" in cur:
        x = cur["exit"]
        sig["exitFill"] = {"t": int(x["t"] // 1000), "price": x["price"], "tx": x["exitTx"], "gapPp": x["gapPp"]}
    return sig


def midpoint_fallback(fx):
    # graceful degrade: when no fills are collected yet for a live fixture, keep the old midpoint read
    # (no entryFill — it is a quote, not a trade). Rarely hit: poly_live_collector covers live matches.
    od = tget("/api/odds/snapshot/" + str(fx["fid"]))
    recs = od if isinstance(od, list) else (od or {}).get("records", [])
    best = None
    for r in recs:
        if r.get("Bookmaker") != "TXLineStablePriceDemargined" or r.get("SuperOddsType") != "1X2_PARTICIPANT_RESULT":
            continue
        if r.get("MarketPeriod") not in (None, "null", ""):
            continue
        if best is None or float(r.get("Ts", 0)) > float(best.get("Ts", 0)):
            best = r
    if not best:
        return None
    nm, pr = best.get("PriceNames") or [], best.get("Prices") or []
    dd = {n: (1 / (p / 1000) if p and p > 0 else 0) for n, p in zip(nm, pr)}; s = sum(dd.values())
    if s <= 0 or "part2" not in dd:
        return None
    fair = dd["part2"] / s
    mk = P.resolve_market(fx["p2"], fx["start"])
    if not mk:
        return None
    out = subprocess.run(["curl", "-s", "--max-time", "10", "-H", "User-Agent: " + UA,
        "https://clob.polymarket.com/midpoint?token_id=" + str(mk["yes"])], capture_output=True, text=True).stdout
    try:
        pm = float(json.loads(out)["mid"])
    except Exception:
        return None
    gap = fair - pm
    return {"fid": str(fx["fid"]), "teams": str(fx["p1"]) + " v " + str(fx["p2"]),
            "fair": round(fair, 4), "pm": round(pm, 4), "entry": round(pm if gap > 0 else 1 - pm, 4),
            "gapPp": round(abs(gap) * 100, 1), "diverged": abs(gap) >= THETA,
            "side": "yes" if gap > 0 else "no", "ts": int(time.time() * 1000), "src": "midpoint"}


def signal_for(fx):
    fid = fx["fid"]; teams = str(fx["p1"]) + " v " + str(fx["p2"])
    mm = fair_series(fid)
    if mm:
        mk = P.resolve_market(fx["p2"], fx["start"])
        if mk:
            trades = load_fills(mk["cond"], mm["kick"], mm["ft"])
            sig = detect(fid, teams, mm, trades)
            if sig:
                return sig
    return midpoint_fallback(fx)  # no fills / no fair yet → degrade to the midpoint read


def main():
    fixtures = live_fixtures()
    sigs = []
    for fx in fixtures:
        try:
            s = signal_for(fx)
            if s:
                sigs.append(s)
        except Exception as e:
            print("signal_for", fx.get("fid"), e)
    blob = {"generatedAt": int(time.time() * 1000), "liveCount": len(fixtures), "theta": THETA, "signals": sigs}
    open("/tmp/live-edge.json", "w").write(json.dumps(blob))
    if KEY:
        url = SUPA + "/storage/v1/object/desk-archives/live-edge.json"
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-X", "POST", url, "-H", "Authorization: Bearer " + KEY,
            "-H", "apikey: " + KEY, "-H", "Content-Type: application/json", "-H", "x-upsert: true",
            "--data-binary", "@/tmp/live-edge.json"], capture_output=True, text=True)
    print(json.dumps(blob))


def test_fid(fid):
    # replay one fixture through the detector using whatever archive + fills are on disk (no publish).
    global CLOSED_KEEP_MS
    CLOSED_KEEP_MS = 10 ** 15  # settled fixture: show the last episode's signal shape regardless of age
    mm = fair_series(fid)
    if not mm:
        print("no fair series for", fid); return
    # teams from the capture
    p = os.path.join(CAP_DIR, "%s.json" % fid)
    j = json.load(open(p)) if os.path.exists(p) else {}
    teams = "%s v %s" % (j.get("p1"), j.get("p2"))
    mk = P.resolve_market(j.get("p2"), mm["kick"])
    trades = load_fills(mk["cond"], mm["kick"], mm["ft"]) if mk else []
    print("fixture %s (%s) — %d fills, %d fair pts" % (fid, teams, len(trades), len(mm["fair"])))
    sig = detect(fid, teams, mm, trades)
    print(json.dumps(sig, indent=2) if sig else "no current signal")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--fid":
        test_fid(sys.argv[2])
    else:
        main()
