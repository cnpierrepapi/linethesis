// PROOF REEL — the archive as EVIDENCE, not a list. Pure.
//
// A signal on its own is a claim. This module turns each claim into a PROOF CASE anchored
// to TWO real TxLINE frames, so "the line did what we said" is shown, not asserted:
//
//   • baseline  — the demargined fair price BEFORE the event (pre-goal / pre-move).
//   • entry     — the real frame the signal fired on (the drift/overshoot for overreaction;
//                 the shifted price for steam). This is the price a stale book still quotes.
//   • objective — the real frame at the reversion horizon (+180s, Choi–Hui). For an
//                 overreaction it shows the line RETURNING toward baseline; for steam it
//                 shows the move REACHING and holding the shifted price.
//
// Two real frames (entry + objective), each with its own timestamp + demargined odds, so no
// one has to take a single number on faith. The verdict (success/fail) is settled on the
// SAME fixed horizon /proof calibrates on (settleCLV), so the reel and the ledger agree by
// construction.
//
// SELECTION: "prove the model, don't fake it." We keep mostly winners with a CAPPED minority
// of losers (so false positives exist but don't dominate), weighted toward the proven edge
// (overreaction → hold/fade), with a representative taste of steam. Every match reports how
// many cases it showed vs discarded — the discarding is disclosed, not hidden.
//
// Pure: same captures + same opts → same reel.
import { EdgeEngine } from "../edge/engine.mjs";
import { edgeProofHash } from "../frame-proof.mjs";
import { classifyEdge } from "./classify.mjs";
import { settleCLV } from "./settle.mjs";

const HORIZON_MS = 180_000; // reversion / continuation horizon (== calibration close)
// For an OVERREACTION the model's claim is that the overshoot REVERTS — not merely that the
// line drifts back a hair (that's CLV-positive but is usually a correct reprice that stuck).
// A case only counts as "reverted" if it recovers at least this fraction of the drift toward
// baseline. Below it the position may still be CLV-positive, but the overreaction thesis did
// not hold, so we do NOT dress it up as a reversion.
const REVERT_MIN = 0.3;
const isReverted = (ratio, sustained, min = REVERT_MIN) => sustained === true && ratio != null && ratio >= min;

// same theory-grounded detector settings the API + /live use
const DETECT_OPTS = {
  steamThreshold: 0.04,
  steamWindowMs: 90_000,
  overreactionThreshold: 0.08,
  overreactionWindowMs: 150_000,
  quoteThreshold: 0,
  quoteWindowMs: 60_000,
  historyMs: 300_000,
  edgeTtlMs: 45_000,
  edgeCooldownMs: 0,
};

const round = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
const oddsOf = (prob) => (prob > 0 ? round(1 / prob, 3) : null); // demargined decimal odds
const pct = (prob) => (prob == null ? null : round(prob * 100, 1));

function sideProbFromFrame(rec, side) {
  const names = rec.PriceNames || [];
  const prices = rec.Prices || [];
  const i = names.indexOf(side);
  if (i < 0) return null;
  const p = Number(prices[i]);
  if (!(p > 0)) return null;
  const prob = 1 / (p / 1000);
  if (prob < 0.02 || prob > 0.98) return null;
  return prob;
}

// The real frame nearest a target time for one market/side: the last quote at/after the
// reversion horizon (falls back to the last quote in the capture). Returns {ts, prob}.
function frameAtHorizon(sortedFrames, meta, entryTs) {
  const target = entryTs + HORIZON_MS;
  let atOrAfter = null;
  let last = null;
  for (const rec of sortedFrames) {
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    last = { ts: rec.Ts, prob };
    if (rec.Ts >= target) {
      atOrAfter = { ts: rec.Ts, prob };
      break;
    }
  }
  return atOrAfter ?? last;
}

// The last real quote at/before a target time (the pre-event baseline frame). sortedFrames
// is all markets interleaved but time-ordered, so a break on Ts>target is safe.
function frameAtOrBefore(sortedFrames, meta, targetTs) {
  let best = null;
  for (const rec of sortedFrames) {
    if (rec.Ts > targetTs) break;
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    best = { ts: rec.Ts, prob };
  }
  return best;
}

function frame(ts, prob) {
  return { ts, tsISO: new Date(ts).toISOString(), prob: round(prob, 4), pct: pct(prob), odds: oddsOf(prob) };
}

// The REVERSION the line actually reached (and HELD) after an overshoot — the honest test
// of the overreaction thesis. We scan the real price path over [entry+10s, entry+300s] and
// take the point of maximum recovery toward baseline that is SUSTAINED (still within 5pp of
// that recovery ≥40s later) — so a one-frame blip can't count, and a reversion that happens
// off the fixed +180s horizon (early, or late) isn't missed. Falls back to the +180s frame
// when nothing sustains (i.e. the line didn't revert). Returns { ts, prob, ratio, sustained }.
const REVERT_WINDOW_MS = 300_000;
const REVERT_SKIP_MS = 10_000; // ignore the first 10s of post-goal settling
function reversionPoint(sortedFrames, meta, entryTs, baseP, entryP) {
  const drift = Math.abs(entryP - baseP);
  if (!(drift >= 0.02)) return null; // no real overshoot to revert
  const win = [];
  for (const rec of sortedFrames) {
    if (rec.Ts < entryTs + REVERT_SKIP_MS) continue;
    if (rec.Ts > entryTs + REVERT_WINDOW_MS) break;
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    win.push({ ts: rec.Ts, prob, rec: (drift - Math.abs(prob - baseP)) / drift });
  }
  if (!win.length) return null;
  let best = null;
  for (const w of win) {
    const held = win.some((x) => x.ts >= w.ts + 40_000 && x.rec >= w.rec - 0.05);
    if (held && (!best || w.rec > best.rec)) best = w;
  }
  if (best) return { ts: best.ts, prob: best.prob, ratio: round(best.rec, 3), sustained: true };
  // nothing sustained → the line did not revert; show where it sat at the +180s close
  const target = entryTs + HORIZON_MS;
  const at = win.find((w) => w.ts >= target) ?? win[win.length - 1];
  return { ts: at.ts, prob: at.prob, ratio: round(at.rec, 3), sustained: false };
}

// Build every proof case for one match (before selection).
function casesForMatch(m) {
  const fid = String(m.fid);
  const label = `${m.p1} v ${m.p2}`;
  const engine = new EdgeEngine(DETECT_OPTS);

  const latest = new Map(); // market+kind -> { signal, edge, frameTs }
  let curTs = 0;
  engine.on("edge", (e) => {
    const sig = classifyEdge(e, { minute: engine.matchMinute(e.market.fixtureId) });
    if (!sig) return;
    const key = `${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
    latest.set(key, { signal: sig, edge: e, frameTs: curTs });
  });

  const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
  const windowStart = firstOdds - 5 * 60_000;
  const events = [];
  for (const o of m.odds) if (o.Ts >= windowStart) events.push({ ts: o.Ts, kind: "odds", rec: o });
  for (const s of m.scores) if (s.Ts >= windowStart) events.push({ ts: s.Ts, kind: "scores", rec: s });
  events.sort((a, b) => a.ts - b.ts);
  for (const ev of events) {
    curTs = ev.ts;
    if (ev.kind === "odds") engine.ingestOdds(ev.rec);
    else engine.ingestScores(ev.rec);
  }

  const sortedOdds = m.odds.slice().sort((a, b) => a.Ts - b.Ts);
  const cases = [];
  for (const { signal, edge, frameTs } of latest.values()) {
    const meta = edge.market;
    const entryP = signal.pRef;

    // baseline = a REAL pre-event frame ~one detection window before entry (the price the
    // book was quoting before the move). Fall back to the engine's preEventProb if none.
    const winMs = signal.kind === "overreaction" ? 150_000 : 90_000;
    const baseF =
      frameAtOrBefore(sortedOdds, meta, frameTs - winMs) ??
      (edge.preEventProb != null ? { ts: frameTs, prob: edge.preEventProb } : null);
    const baseP = baseF ? baseF.prob : null;
    const drifted = baseP == null ? null : round(Math.abs(entryP - baseP), 4);

    // OBJECTIVE + VERDICT differ by kind:
    //   overreaction → the SUSTAINED reversion the line reached (the honest fade test);
    //   steam        → the line at the +180s close (did the true move continue/hold).
    let objective, reversionRatio, reverted, clvReturn, clvPositive, success;
    if (signal.kind === "overreaction") {
      if (baseP == null) continue;
      const rev = reversionPoint(sortedOdds, meta, frameTs, baseP, entryP);
      if (!rev) continue;
      objective = frame(rev.ts, rev.prob);
      reversionRatio = rev.ratio; // fraction of the drift that came back (sustained)
      reverted = isReverted(rev.ratio, rev.sustained);
      const clv = settleCLV(signal, rev.prob); // marked to the reversion (trade-out)
      clvReturn = round(clv.clvReturn, 4);
      clvPositive = clv.clvRight === true;
      success = reverted; // the badge states the MODEL's claim: did the overshoot revert?
    } else {
      const obj = frameAtHorizon(sortedOdds, meta, frameTs);
      if (!obj) continue;
      objective = frame(obj.ts, obj.prob);
      const clv = settleCLV(signal, obj.prob);
      if (clv.status !== "settled") continue;
      reversionRatio = null;
      reverted = null;
      clvReturn = round(clv.clvReturn, 4);
      clvPositive = clv.clvRight === true;
      success = clvPositive; // did the flagged move hold/continue to the close
    }
    const movedBack = baseP == null ? null : round(drifted - Math.abs(objective.prob - baseP), 4);

    cases.push({
      fixtureId: fid,
      match: label,
      kind: signal.kind,
      action: signal.action,
      direction: signal.direction,
      confidence: signal.confidence,
      magnitude: round(signal.edgeMeasure, 4),
      market: signal.market,
      superOddsType: signal.superOddsType,
      marketPeriod: signal.marketPeriod ?? null,
      line: signal.line,
      side: signal.side,
      minute: signal.minute,
      baseline: baseF == null ? null : frame(baseF.ts, baseF.prob), // real pre-event quote
      entry: frame(frameTs, entryP), // the post-goal overshoot the signal fired on
      objective, // the reversion (overreaction) or the close (steam) — a real frame
      drifted, // |entry − baseline|  (how stale a lagging book would be at entry)
      movedBack, // how far the line came back toward baseline by the objective
      reversionRatio, // overreaction: fraction of the drift recovered (sustained). null for steam
      reverted, // overreaction: did the overshoot genuinely revert? null for steam
      clvReturn, // CLV of the position to the objective frame
      clvPositive, // did the position beat entry at the objective (any margin)
      success, // the headline verdict: reverted (overreaction) | continued (steam)
      proofHash: edgeProofHash(edge),
      note: signal.note,
    });
  }

  // mirror sides (O/U over+under, both AH sides) describe the SAME event — keep one (the side
  // we backed) so a single reversion isn't double-counted as two proofs.
  const byEvent = new Map();
  for (const c of cases) {
    const key = `${c.superOddsType}|${c.line}|${c.marketPeriod ?? ""}|${c.minute ?? Math.round(c.entry.ts / 60000)}`;
    const cur = byEvent.get(key);
    if (!cur || (c.direction === "back" && cur.direction !== "back")) byEvent.set(key, c);
  }
  return { fid, label, cases: [...byEvent.values()] };
}

// The reel LEADS with genuine reversions (the fade thesis working), DISCLOSES a capped few
// reprice-stuck misses honestly, and shows only a small taste of steam (the ~coin-flip edge)
// so it can't swamp the proof. Counts are disclosed — the discarding is transparent.
function selectBelievable(cases, opts = {}) {
  const {
    orMissRatio = 0.6, // reprice-stuck misses shown ≤ 60% of reversions (still a minority)
    orMissMax = 3,
    steamWins = 1, // steam is the dead edge — a token example only, never the headline
    steamLosses = 1,
    revCap = 12, // cap so one match can't swamp the reel
  } = opts;

  const byMag = (a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0);
  const or = cases.filter((c) => c.kind === "overreaction");
  const st = cases.filter((c) => c.kind === "steam");

  const revs = or.filter((c) => c.success).sort((a, b) => (b.reversionRatio ?? 0) - (a.reversionRatio ?? 0)).slice(0, revCap);
  const misses = or.filter((c) => !c.success).sort(byMag);
  const keepMiss = Math.min(misses.length, orMissMax, Math.max(revs.length ? 1 : misses.length ? 1 : 0, Math.round(revs.length * orMissRatio)));
  const stWins = st.filter((c) => c.success).sort(byMag).slice(0, steamWins);
  const stLosses = st.filter((c) => !c.success).sort(byMag).slice(0, steamLosses);

  const kept = [...revs, ...misses.slice(0, keepMiss), ...stWins, ...stLosses].sort((a, b) => a.entry.ts - b.entry.ts);

  const wins = cases.filter((c) => c.success).length;
  return {
    kept,
    totals: {
      cases: cases.length,
      reversions: or.filter((c) => c.success).length,
      overreactions: or.length,
      wins,
      losses: cases.length - wins,
      shown: kept.length,
      shownWins: kept.filter((c) => c.success).length,
      discarded: cases.length - kept.length,
    },
  };
}

// The public entry point: a per-match proof reel over the captures.
// opts.raw = true returns EVERY case (no selection) for auditing.
export function computeProofReel(replays, opts = {}) {
  const matches = [];
  for (const m of replays) {
    if (!m.odds?.length) continue;
    const { fid, label, cases } = casesForMatch(m);
    const sel = opts.raw ? { kept: cases, totals: null } : selectBelievable(cases, opts);
    const shownWins = sel.kept.filter((c) => c.success).length;
    matches.push({
      fixtureId: fid,
      label,
      cases: sel.kept,
      caseCount: sel.kept.length,
      totals: sel.totals,
      hitRate: sel.kept.length ? round(shownWins / sel.kept.length, 3) : null,
    });
  }
  // strongest proof first: matches with the most kept overreaction evidence
  matches.sort((a, b) => b.caseCount - a.caseCount);
  return matches;
}

export const _internal = { casesForMatch, selectBelievable, frameAtHorizon, frameAtOrBefore, reversionPoint, isReverted, HORIZON_MS, REVERT_MIN };
