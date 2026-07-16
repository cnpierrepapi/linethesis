#!/usr/bin/env python3
# INTEGRATION TEST (no network writes): prove live_detect over the UNIFIED fill path — build_fill
# on the real durable ~/poly-live/{cond}.jsonl (exactly what live_stream.tail_jsonl does) plus the
# fixed fair series — reproduces the golden signal for a settled match, and contrast it with the OLD
# capped live_edge path so the ft-cap difference is visible.
import json, os, sys
import live_detect as LD
import live_edge as LE
import poly_pickoff_system as P


def load_jsonl_fills(cond, yes):
    p = os.path.expanduser("~/poly-live/%s.jsonl" % cond)
    rows, seen = [], set()
    if not os.path.exists(p):
        return rows
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        bf = LD.build_fill(r, yes)
        if not bf:
            continue
        ts, imp, usd, tx, _cons = bf
        if not tx or tx in seen:
            continue
        seen.add(tx)
        rows.append((ts, imp, usd, tx))
    rows.sort()
    return rows


def main(fid):
    mm = LE.fair_series(fid)
    if not mm:
        print("no fair series", fid)
        return
    p = os.path.expanduser("~/agenthesis/captures_live/%s.json" % fid)
    j = json.load(open(p)) if os.path.exists(p) else {}
    p1, p2 = j.get("p1"), j.get("p2")
    if not p2:  # capture reaped (>120min) -> recover teams from the published ledger
        led = P.dget("%s/storage/v1/object/public/desk-archives/pickoffs.json" % P.SUPA) or {}
        for m in led.get("matches", []):
            if str(m.get("fid")) == str(fid):
                parts = str(m.get("teams", "")).split(" v ")
                if len(parts) == 2:
                    p1, p2 = parts[0].strip(), parts[1].strip()
                break
    teams = "%s v %s" % (p1, p2)
    mk = P.resolve_market(p2, mm["kick"])
    if not mk:
        print("no market", fid)
        return
    yes = str(mk["yes"])

    fills = load_jsonl_fills(mk["cond"], yes)                 # NEW: uncapped, outcome-based, deduped
    txline = [[t, f] for t, f in mm["fair"]]                  # as the service holds it: [[ts_ms, fairP2]]
    print("fid %s (%s): %d fair pts, %d unified fills, kick=%s ft=%s" % (
        fid, teams, len(txline), len(fills), mm["kick"], mm["ft"]))

    LD.CLOSED_KEEP_MS = 10 ** 15
    sig_new = LD.detect(fid, teams, txline, fills, mm["kick"])
    print("\nNEW live_detect (unified fills, NO ft cap):")
    print(json.dumps(sig_new, indent=2) if sig_new else "  no current signal")

    LE.CLOSED_KEEP_MS = 10 ** 15
    old_fills = LE.load_fills(mk["cond"], mm["kick"], mm["ft"])
    sig_old = LE.detect(fid, teams, mm, old_fills)
    print("\nOLD live_edge (fills capped at ft=%s -> %d fills):" % (mm["ft"], len(old_fills)))
    print(json.dumps(sig_old, indent=2) if sig_old else "  no current signal")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "18241006")
