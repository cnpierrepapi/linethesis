#!/usr/bin/env python3
# LIVE DETECT — the single, pure divergence detector shared by the live pipeline.
#
# WHY THIS EXISTS: the old split had two data paths that drifted apart. The signal path
# (live_edge.py) rebuilt the TxLINE fair from a STALE on-disk archive (captures_live ->
# archive-cache -> blob) and bounded the Polymarket fills by a match-end `ft` derived from a
# scores clock that could freeze seconds after kickoff. When that happened the market price it
# fed the bot froze at the entry, so a position never converged and never closed (the England v
# Argentina ghost). Meanwhile live_stream.py already held a FRESH dual series in memory (TxLINE
# fair from the /api/odds/snapshot, Polymarket fills from the Data API /trades, both ~2s), but
# only drew a chart with it.
#
# This module removes the disagreement: it is a PURE function library that decides the current
# signal for one fixture from two in-memory arrays — the fair series and the fill series — with
# NO disk, NO `ft` cap, NO midpoint fallback. live_stream.py (the single persistent 2s service)
# feeds it its own fresh series and publishes live-edge.json from the result, so the signal the
# bot/CLI settle against is computed from the same fresh source the chart draws.
#
# MAPPING: a Polymarket /trades row carries BOTH `outcome` ("Yes"/"No") and `asset` (the ERC-1155
# token id). Those are two encodings of one fact. We key the price off `outcome` — self-describing
# and API-authoritative — instead of `asset == yes_token`, which silently breaks if resolve_market
# ever returns the wrong token id. We still assert `(asset==yes_token) == (outcome=="Yes")` so a
# resolve_market mismatch is caught loudly (the same token id the on-chain /proof path depends on).
#
# The episode scan mirrors compute_edge.py / the frozen live_edge.detect() EXACTLY — same THETA,
# FLOOR, ANCHOR_MS, CLOSED_KEEP_MS, same sign logic, same entry/exit prices — so a signal fired
# live reconciles with what /proof later anchors on-chain. Only the data SOURCE changed.
#
# Self-test:  python3 live_detect.py     (synthetic cases: entry / converge / markout / invariant)

import time, bisect

THETA = 0.05                       # 5pp gap threshold (== compute_edge / the paid feed)
FLOOR = 50                         # a fill must move >= $50 to count as entry or exit (dust guard)
ANCHOR_MS = 2000                   # a fill anchors to the fair reading within +/-2s of its timestamp
CLOSED_KEEP_MS = 5 * 60 * 1000     # keep publishing a just-closed episode (with its exit) for 5 min


def imp_p2(price, outcome):
    """Implied P(part2 wins) from a /trades row. outcome-based, API-authoritative.
    A 'Yes' token trades at P(part2); a 'No' token at P(part2 loses) = 1 - price."""
    return price if outcome == "Yes" else 1.0 - price


def mapping_consistent(asset, yes_token, outcome):
    """True when the token-id encoding agrees with the outcome encoding. A False here means
    resolve_market's `yes` token id disagrees with Polymarket's own outcome label — the exact
    id the on-chain /proof path settles on — so the caller should alarm, not silently proceed."""
    return (str(asset) == str(yes_token)) == (outcome == "Yes")


def build_fill(trade, yes_token):
    """One /trades row -> (ts_ms, impP2, usd, tx, consistent) or None if unusable.
    ts is normalised to ms; usd is notional (price*size) for the FLOOR guard; tx is the Polygon
    hash that will anchor entryFill/exitFill. `consistent` surfaces the mapping invariant."""
    try:
        ts = float(trade.get("timestamp", 0) or 0)
        price = float(trade.get("price"))
        size = float(trade.get("size", 0) or 0)
    except (TypeError, ValueError):
        return None
    if not (0.0 < price < 1.0):
        return None
    outcome = trade.get("outcome")
    ts_ms = int(ts if ts > 1e12 else ts * 1000)
    imp = imp_p2(price, outcome)
    usd = price * size
    tx = trade.get("transactionHash")
    consistent = mapping_consistent(trade.get("asset", ""), yes_token, outcome)
    return (ts_ms, round(imp, 4), usd, tx, consistent)


def _fair_anchored(fts, fair, ms):
    """Nearest fair reading within +/-ANCHOR_MS of ms; else the last reading at or before ms.
    fts = [ts...] (sorted), fair = [(ts, fairP2)...] aligned to fts. Identical to live_edge."""
    lo = bisect.bisect_left(fts, ms - ANCHOR_MS)
    hi = bisect.bisect_right(fts, ms + ANCHOR_MS)
    if hi > lo:
        b = min(range(lo, hi), key=lambda k: abs(fts[k] - ms))
        return fair[b][1]
    i = bisect.bisect_right(fts, ms) - 1
    return fair[i][1] if i >= 0 else None


def detect(fid, teams, fair_series, fills, kick_ms, now_ms=None):
    """Current signal for one fixture, or None.

    fair_series: [(ts_ms, fairP2)...]  fresh from the TxLINE snapshot (P(part2 wins))
    fills:       [(ts_ms, impP2, usd, tx)...]  fresh from the Polymarket /trades reader
    kick_ms:     kickoff ms (for the display minute)

    Returns the live-edge.json signal dict (open episode, or one closed within CLOSED_KEEP_MS)
    in the EXACT published shape, so downstream (bot / npm / web) needs no change.
    """
    if not fills or not fair_series:
        return None
    fair = sorted(fair_series, key=lambda x: x[0])
    fts = [t for t, _ in fair]
    trades = sorted(fills, key=lambda x: x[0])
    now = now_ms if now_ms is not None else time.time() * 1000

    episodes = []
    side = 0
    ent = None
    for (ts, imp, usd, tx) in trades:
        fv = _fair_anchored(fts, fair, ts)
        if fv is None:
            continue
        gap = fv - imp                      # >0 -> YES cheap (market too low); <0 -> NO cheap
        sg = 1 if gap >= THETA else (-1 if gap <= -THETA else 0)
        if side == 0:
            if sg != 0 and usd >= FLOOR:    # open an episode on the first fill past THETA with size
                side = sg
                ent = {"t": ts, "fairP2": fv, "side": "yes" if sg > 0 else "no",
                       "entry": round(imp if sg > 0 else 1 - imp, 4),
                       "gapPp": round(abs(gap) * 100, 1), "entryTx": tx}
        else:
            reached = (side > 0 and imp >= ent["fairP2"]) or (side < 0 and imp <= ent["fairP2"])
            if reached and usd >= FLOOR:     # exit: a later fill that traded at/through entry fair
                ent["exit"] = {"t": ts, "price": round(imp if side > 0 else 1 - imp, 4),
                               "gapPp": round((imp - ent["fairP2"]) * side * 100, 1), "exitTx": tx}
                episodes.append(ent)
                side = 0
                ent = None
    if ent:
        episodes.append(ent)
    if not episodes:
        return None

    cur = episodes[-1]
    open_now = "exit" not in cur
    if not open_now and (now - cur["exit"]["t"]) > CLOSED_KEEP_MS:
        return None                          # nothing current on this fixture

    cur_fair = fair[-1][1]                    # CURRENT fair P(part2) (fresh snapshot)
    pm_now = trades[-1][1]                    # CURRENT market P(part2) (latest real fill)
    sig = {
        "fid": str(fid), "teams": teams, "side": cur["side"],
        "fair": round(cur["fairP2"], 4),      # entry-time fair P(part2) == the take-profit basis
        "pm": round(pm_now, 4),               # CURRENT market P(part2) — the bot settles against this
        "entry": round(cur["entry"], 4),      # entry price on the bought side (from the real fill)
        "gapPp": round(cur["gapPp"], 1),
        "diverged": bool(open_now and abs(cur_fair - pm_now) >= THETA),
        "ts": int(cur["t"]),
        "minute": max(0, round((cur["t"] - kick_ms) / 60000.0, 1)),
        "entryFill": {"t": int(cur["t"] // 1000), "price": round(cur["entry"], 4), "tx": cur["entryTx"]},
        "src": "fill",
    }
    if "exit" in cur:
        x = cur["exit"]
        sig["exitFill"] = {"t": int(x["t"] // 1000), "price": x["price"], "tx": x["exitTx"], "gapPp": x["gapPp"]}
    return sig


# ── self-test (synthetic, offline) ────────────────────────────────────────────────────────────────
def _selftest():
    ok = True

    def check(name, cond):
        nonlocal ok
        ok = ok and cond
        print(("  PASS " if cond else "  FAIL ") + name)

    KICK = 1_000_000_000_000
    def t(sec):  # ms timestamp `sec` seconds after kick
        return KICK + sec * 1000

    # Fair flat at P2=0.2455 (England the favourite; part2 = Argentina). Reproduces the real fixture.
    fair = [(t(s), 0.2455) for s in range(0, 120, 2)]

    # Case A — ENTRY ONLY (England 'no' side cheap): a big fill with impP2=0.315 -> England 0.685.
    fillsA = [(t(1), 0.315, 5000.0, "0xENTRY")]
    a = detect("18241006", "England v Argentina", fair, fillsA, KICK, now_ms=t(2))
    check("A side=no", a and a["side"] == "no")
    check("A entry=0.685", a and a["entry"] == 0.685)
    check("A fair=0.2455 (P2 basis)", a and a["fair"] == 0.2455)
    check("A gapPp~6.9 (matches real GOLDEN signal)", a and abs(a["gapPp"] - 6.9) < 0.11)
    check("A entryFill tx", a and a["entryFill"]["tx"] == "0xENTRY")
    check("A no exitFill", a and "exitFill" not in a)
    check("A diverged (pm 0.315 vs fair 0.2455)", a and a["diverged"] is True)

    # Case B — CONVERGE: later fill drives impP2 down to 0.24 (England 0.76 >= fair side 0.7545).
    fillsB = fillsA + [(t(40), 0.24, 800.0, "0xEXIT")]
    b = detect("18241006", "England v Argentina", fair, fillsB, KICK, now_ms=t(41))
    check("B exitFill present (reached)", b and "exitFill" in b)
    check("B exit price ~0.76 (bought side)", b and abs(b["exitFill"]["price"] - 0.76) < 1e-6)
    check("B exit tx", b and b["exitFill"]["tx"] == "0xEXIT")

    # Case C — MARKOUT/LOSS: England collapses, impP2 rises to 0.9975 (England 0.0025), never reached.
    fillsC = fillsA + [(t(50), 0.60, 900.0, "0xMID"), (t(90), 0.9975, 2000.0, "0xLATE")]
    c = detect("18241006", "England v Argentina", fair, fillsC, KICK, now_ms=t(91))
    check("C still open (no reach)", c and "exitFill" not in c)
    check("C pm tracks collapse to 0.9975", c and c["pm"] == 0.9975)
    check("C entry unchanged 0.685", c and c["entry"] == 0.685)

    # Case D — MAPPING INVARIANT: asset==yes but outcome='No' must be flagged inconsistent.
    good = build_fill({"timestamp": t(1) / 1000, "price": 0.9, "size": 100, "outcome": "Yes",
                       "asset": "YESID", "transactionHash": "0x1"}, "YESID")
    bad = build_fill({"timestamp": t(1) / 1000, "price": 0.9, "size": 100, "outcome": "No",
                      "asset": "YESID", "transactionHash": "0x2"}, "YESID")
    check("D consistent flagged True", good and good[4] is True)
    check("D inconsistent flagged False", bad and bad[4] is False)
    check("D outcome mapping: No@0.9 -> impP2 0.1", bad and bad[1] == 0.1)

    # Case E — DUST GUARD: a sub-FLOOR entry fill must NOT open an episode.
    e = detect("x", "A v B", fair, [(t(1), 0.315, 10.0, "0xDUST")], KICK, now_ms=t(2))
    check("E dust fill ignored (no signal)", e is None)

    print("live_detect self-test:", "ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    import sys
    sys.exit(0 if _selftest() else 1)
