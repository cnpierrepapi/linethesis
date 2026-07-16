# REAL-TIME UNIFIED PIPELINE — one fresh in-memory source per fixture feeds BOTH the chart and the
# live signal detector, so the price the bot settles against is the exact series the chart draws.
#
#   ODDS   : TxLINE demargined 1X2 fair from the live snapshot (LE.fair_1x2), appended on change.
#   FILLS  : Polymarket real fills, UNIFIED from two feeds and deduped by tx —
#              (a) the durable ~/poly-live/{cond}.jsonl tail (collector @2min + poly_live_chain's
#                  on-chain fills the Data API MISSES — the Norway v England exit-fill lesson), and
#              (b) our own Data-API /trades poll every 2s for freshness.
#   SIGNAL : live_detect.detect() over those two in-memory arrays, timestamp-matched (+/-2s), with
#            NO on-disk fair rebuild, NO match-end (`ft`) cap, NO midpoint fallback — the three
#            defects of the old */1 live_edge.py path that froze the market price at entry so a
#            converged position never closed (the England v Argentina ghost).
#
# Publishes desk-archives/live-stream.json (chart, unchanged shape) and the live-edge blob. The edge
# TARGET is env-controlled: default the STAGING blob (deploy safely alongside the old cron), flip to
# live-edge.json at cutover. Rollback = flip env back + re-enable the */1 live_edge cron.
import json, os, time, subprocess
import live_edge as LE
import live_detect as LD
import poly_pickoff_system as P

SUPA = P.SUPA
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
UA = "Mozilla/5.0"
POLL = 2
KEEP = 800
LIVE_DIR = os.path.expanduser("~/poly-live")
EDGE_TARGET = os.environ.get("LIVE_EDGE_TARGET", "live-edge.staging.json")  # cutover -> "live-edge.json"
THETA = LD.THETA

mk_cache = {}    # fid -> {"yes","cond"} or None
streams = {}     # fid -> {"teams","txline":[[ts_ms,fairP2]]}  (market series derived from fills)
fills = {}       # fid -> {"rows":[(ts_ms,impP2,usd,tx)], "seen":set(tx), "off":int jsonl byte offset}
kick_of = {}     # fid -> kickoff ms (from the fixture StartTime)
_last_edge = 0.0 # last live-edge publish (unix s); used for the idle heartbeat
EDGE_HEARTBEAT_S = 60  # republish an empty live-edge at least this often when idle (matches old */1 cron)


def market_for(fid, p2, start):
    if fid not in mk_cache:
        mk = P.resolve_market(p2, start)
        mk_cache[fid] = {"yes": str(mk["yes"]), "cond": mk["cond"]} if mk else None
    return mk_cache[fid]


def _add_fill(fid, row, yes):
    # raw /trades (or jsonl) row -> unified fill tuple, deduped by tx. Alarms on a mapping mismatch
    # (resolve_market's yes token disagreeing with the API outcome label) instead of silently flipping.
    bf = LD.build_fill(row, yes)
    if not bf:
        return
    ts_ms, imp, usd, tx, consistent = bf
    if not tx:
        return
    st = fills[fid]
    if tx in st["seen"]:
        return
    st["seen"].add(tx)
    st["rows"].append((ts_ms, imp, usd, tx))
    if not consistent:
        print("MAPPING ALARM fid=%s tx=%s outcome/asset disagree with resolve_market yes" % (fid, tx), flush=True)


def tail_jsonl(fid, cond):
    # incremental byte-offset tail of the durable log; picks up BOTH the collector and the chain
    # tailer's late on-chain fills without re-reading the whole (10-30MB) file each tick.
    p = os.path.join(LIVE_DIR, "%s.jsonl" % cond)
    if not os.path.exists(p):
        return
    st = fills[fid]
    yes = mk_cache[fid]["yes"]
    try:
        with open(p, "rb") as fh:
            fh.seek(st["off"])
            chunk = fh.read()
            st["off"] += len(chunk)
    except Exception:
        return
    for line in chunk.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        _add_fill(fid, row, yes)


def poll_trades(fid, cond):
    # 2s-fresh Data-API poll (chart freshness). Returns the last 200 trades; dedup-by-tx in _add_fill
    # absorbs the overlap with the jsonl tail, so no timestamp cursor is needed.
    yes = mk_cache[fid]["yes"]
    out = subprocess.run(
        ["curl", "-s", "--max-time", "8", "-H", "User-Agent: " + UA,
         "https://data-api.polymarket.com/trades?market=" + cond + "&limit=200&takerOnly=false"],
        capture_output=True, text=True).stdout
    try:
        arr = json.loads(out)
    except Exception:
        return
    if not isinstance(arr, list):
        return
    for row in arr:
        _add_fill(fid, row, yes)


def market_series(fid):
    # chart tape derived from the unified fills: [ts_ms, impP2], consecutive-dedup, last KEEP.
    out = []
    for ts_ms, imp, _u, _t in sorted(fills[fid]["rows"]):
        if not out or out[-1][1] != imp:
            out.append([ts_ms, imp])
    return out[-KEEP:]


def _upload(name, blob):
    tmp = "/tmp/" + name
    open(tmp, "w").write(json.dumps(blob))
    if KEY:
        subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-X", "POST",
             SUPA + "/storage/v1/object/desk-archives/" + name,
             "-H", "Authorization: Bearer " + KEY, "-H", "apikey: " + KEY,
             "-H", "Content-Type: application/json", "-H", "x-upsert: true",
             "--data-binary", "@" + tmp],
            capture_output=True, text=True)


def publish_stream():
    fixtures = [{"fid": fid, "teams": s["teams"], "txline": s["txline"][-KEEP:], "market": market_series(fid)}
                for fid, s in streams.items()]
    _upload("live-stream.json", {"generatedAt": int(time.time() * 1000), "poll": POLL, "fixtures": fixtures})


def publish_edge(sigs):
    _upload(EDGE_TARGET, {"generatedAt": int(time.time() * 1000), "liveCount": len(streams),
                          "theta": THETA, "signals": sigs})


def tick():
    fixs = LE.live_fixtures()
    live_now = {str(fx["fid"]) for fx in fixs}
    pruned = [fid for fid in list(streams) if fid not in live_now]
    for fid in pruned:                           # match left the live window: drop it so the blob shrinks
        streams.pop(fid, None); mk_cache.pop(fid, None)
        fills.pop(fid, None); kick_of.pop(fid, None)

    sigs = []
    for fx in fixs:
        fid = str(fx["fid"])
        if fid not in streams:
            streams[fid] = {"teams": str(fx["p1"]) + " v " + str(fx["p2"]), "txline": []}
            fills[fid] = {"rows": [], "seen": set(), "off": 0}   # off=0 -> first tick rehydrates full history
            kick_of[fid] = int(fx.get("start") or 0)

        fv = LE.fair_1x2(fx["fid"])               # ODDS: snapshot fair, appended on change
        if fv is not None:
            tl = streams[fid]["txline"]; v = round(fv["fair"], 4)
            if not tl or tl[-1][1] != v:
                tl.append([int(fv.get("ts") or time.time() * 1000), v])
                streams[fid]["txline"] = tl[-KEEP:]

        mk = market_for(fid, fx["p2"], fx["start"])
        if mk:
            tail_jsonl(fid, mk["cond"])            # FILLS: durable log (completeness) ...
            poll_trades(fid, mk["cond"])           #        ... + 2s poll (freshness), unified & deduped
            try:                                    # SIGNAL: from the SAME fresh arrays the chart draws
                sig = LD.detect(fid, streams[fid]["teams"], streams[fid]["txline"],
                                fills[fid]["rows"], kick_of[fid])
                if sig:
                    sigs.append(sig)
            except Exception as e:
                print("detect err fid=%s %s" % (fid, e), flush=True)

    global _last_edge
    now = time.time()
    if fixs or pruned:                             # live/just-ended: publish both, refresh heartbeat
        publish_stream()
        publish_edge(sigs)
        _last_edge = now
    elif now - _last_edge >= EDGE_HEARTBEAT_S:      # idle: keep live-edge.json generatedAt fresh (no chart write)
        publish_edge([])
        _last_edge = now
    return len(fixs), len(sigs)


def run():
    print("live_stream (unified: chart + live-edge -> %s) up, poll %ss" % (EDGE_TARGET, POLL), flush=True)
    while True:
        try:
            tick()
        except Exception as e:
            print("err " + str(e), flush=True)
        time.sleep(POLL)


if __name__ == "__main__":
    run()
