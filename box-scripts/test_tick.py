#!/usr/bin/env python3
# ONE-TICK WIRING SMOKE TEST (offline): stub the live fixture, snapshot fair, market resolver, and a
# synthetic durable jsonl, intercept uploads, and run live_stream.tick() once. Proves the loop body
# wires fixture->fair->fills->detect->publish correctly and emits the exact live-edge blob shape.
import json, os, time
import live_stream as S

captured = {}
S._upload = lambda name, blob: captured.__setitem__(name, blob)     # intercept, no network
S.poll_trades = lambda fid, cond: None                              # offline: skip the Data-API poll

NOW = int(time.time() * 1000)
KICK = NOW - 8 * 60 * 1000                                          # kicked off 8 min ago
FID, COND, YES = "99999999", "0xTESTCOND", "YESTOKEN"

S.LE.live_fixtures = lambda: [{"fid": FID, "p1": "Alpha", "p2": "Beta", "start": KICK}]
S.LE.fair_1x2 = lambda fid: {"fair": 0.30, "ts": KICK + 60000}     # Beta (part2) fair = 0.30
S.P.resolve_market = lambda p2, start: {"yes": YES, "cond": COND}

# synthetic durable log: Beta trades cheap at 0.20 (entry, gap +10pp), then travels to 0.31 (exit)
S.LIVE_DIR = "/tmp/testlive"
os.makedirs(S.LIVE_DIR, exist_ok=True)
with open(os.path.join(S.LIVE_DIR, COND + ".jsonl"), "w") as f:
    f.write(json.dumps({"timestamp": KICK // 1000 + 120, "price": 0.20, "size": 500,
                        "outcome": "Yes", "asset": YES, "transactionHash": "0xENTRY"}) + "\n")
    f.write(json.dumps({"timestamp": KICK // 1000 + 360, "price": 0.31, "size": 500,
                        "outcome": "Yes", "asset": YES, "transactionHash": "0xEXIT"}) + "\n")

nfix, nsig = S.tick()
print("tick(): %d fixtures, %d signals" % (nfix, nsig))
print("\n--- live-edge blob (%s) ---" % S.EDGE_TARGET)
print(json.dumps(captured.get(S.EDGE_TARGET), indent=2))
print("\n--- chart blob fixtures[0] keys/sizes ---")
cs = captured.get("live-stream.json", {}).get("fixtures", [])
if cs:
    fx = cs[0]
    print("teams=%s  txline_pts=%d  market_pts=%d" % (fx["teams"], len(fx["txline"]), len(fx["market"])))

sig = (captured.get(S.EDGE_TARGET) or {}).get("signals", [])
ok = (len(sig) == 1 and sig[0]["side"] == "yes" and sig[0]["entry"] == 0.20
      and sig[0]["fair"] == 0.30 and sig[0].get("exitFill", {}).get("price") == 0.31)
print("\nWIRING:", "PASS" if ok else "FAIL")
os.remove(os.path.join(S.LIVE_DIR, COND + ".jsonl"))
