// OPERATOR FEED — the deterministic edge snapshot behind /api/v1/edges.
//
// A market operator polling the API gets typed, scored edges per fixture, each
// carrying the proofHash that ties it to the exact real TxLINE frame it was
// derived from. We build that snapshot by replaying the bundled REAL captures
// through a fresh EdgeEngine (one per fixture, so no cross-match bleed) and
// keeping the LATEST edge per market+kind.
//
// Why replay rather than scrape the live runner: on serverless the runner's
// engine barely gets CPU on a cold instance, so a poll could return nothing.
// Replaying the captures is deterministic and reproducible — every request
// yields the same answer, derived from real data. In production this same
// contract is served by a persistent worker watching the live stream (see the
// API docs: the payload shape is identical, only the source clock differs).
import { EdgeEngine } from "./edge/engine.mjs";
import { edgeProofHash, scoreProofHash } from "./frame-proof.mjs";
import { classifyEdge, goalImminent, IMMINENT_SURFACE_CONF } from "./signals/classify.mjs";
import { settleCLV, settleGoalArrival } from "./signals/settle.mjs";
import { calibrate, calibrateArrival } from "./signals/calibration.mjs";
import { withNaiveBook, DEFAULT_LAG_MS } from "./signals/naive-book.mjs";
import { evaluatePolicy, describeAction, DEMO_POLICY } from "./signals/policy.mjs";

// Theory-grounded thresholds (== engine DEFAULTS, == what /live uses). Cooldown off so
// we keep the most-recent edge per market+kind. The old loose values (0.015 / 0.03)
// surfaced every wobble, diluting the fade edge with coin-flip "holds" (overreaction
// hit-rate 51% across 5 real matches). Choi–Hui: only SURPRISING (big) overshoots
// revert, so detecting at 0.08 lifts overreaction to ~74% and keeps fade (conf>=0.7)
// at ~86% across all 5 matches — precision over recall for a production signal.
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

const round = (x, n) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};
const CONV_RANK = { High: 3, Medium: 2, Low: 1 };

// Build the per-fixture edge snapshot from an array of captured matches
// ({ fid, p1, p2, odds[], scores[] }). Pure: same captures -> same output.
export function computeOperatorEdges(replays) {
  const fixtures = [];

  for (const m of replays) {
    if (!m.odds?.length) continue;
    const fid = String(m.fid);
    const label = `${m.p1} v ${m.p2}`;
    const engine = new EdgeEngine(DETECT_OPTS);

    // latest edge per market+kind, tagged with the frame's match timestamp
    const latest = new Map();
    let curTs = 0;
    engine.on("edge", (e) => {
      const key = `${e.market.fixtureId}|${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
      latest.set(key, { edge: e, frameTs: curTs });
    });

    // Anchor to the in-play odds window (drop stale pre-match coverage), then
    // feed odds+scores in real match-time order.
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

    const edges = [...latest.values()].map(({ edge, frameTs }) => ({
      id: edge.id,
      fixtureId: edge.market.fixtureId,
      match: label,
      kind: edge.kind,
      direction: edge.direction,
      conviction: edge.conviction,
      market: {
        superOddsType: edge.market.superOddsType,
        marketParameters: edge.market.marketParameters,
        marketPeriod: edge.market.marketPeriod,
        side: edge.market.side,
        sideIndex: edge.market.sideIndex,
      },
      fairProb: round(edge.fairProb, 4),
      impliedOdds: round(1 / edge.fairProb, 3),
      edgeMeasure: round(edge.edgeMeasure, 4),
      note: edge.note,
      ...(edge.trigger ? { trigger: edge.trigger } : {}),
      frameTs,
      frameTsISO: new Date(frameTs).toISOString(),
      proofHash: edgeProofHash(edge),
    }));

    edges.sort(
      (a, b) => CONV_RANK[b.conviction] - CONV_RANK[a.conviction] || b.frameTs - a.frameTs,
    );
    fixtures.push({ fixtureId: fid, label, edgeCount: edges.length, edges });
  }

  fixtures.sort((a, b) => b.edgeCount - a.edgeCount);
  return fixtures;
}

// ── the LOCKED product: read-only line-integrity SIGNALS ─────────────────────
// Same deterministic replay as computeOperatorEdges, but each engine edge is run
// through the signal classifier (lib/signals/classify.mjs) into the read-only
// signal shape an operator's rule-set acts on: kind (steam|overreaction) → action
// (follow|hold|fade), confidence, pickoffRisk, and pRef (the demargined truth we
// benchmark against). The snapshot has no operator book, so pWatched/gapBps are
// null here — those populate on the live path (control-room / SSE) when a book is
// connected. proofHash ties each signal to the real TxLINE frame it came from.
// Pure: same captures → same signals.
const IMMINENT_COOLDOWN_MS = 180_000; // collapse dense high_danger clusters into a readable cadence
// (a "goal is building" warning every ~3min of sustained pressure — one suspend covers a camped
// spell; re-warning every possession frame is noise, and floods the demo tape).
const ACTION_RANK = { fade: 4, "suspend-suggested": 3, hold: 2, follow: 1 };

export function computeOperatorSignals(replays) {
  const fixtures = [];

  for (const m of replays) {
    if (!m.odds?.length) continue;
    const fid = String(m.fid);
    const label = `${m.p1} v ${m.p2}`;
    const engine = new EdgeEngine(DETECT_OPTS);

    const latest = new Map(); // market+kind -> { signal, edge, frameTs }
    let curTs = 0;
    engine.on("edge", (e) => {
      const sig = classifyEdge(e, { minute: engine.matchMinute(e.market.fixtureId) });
      if (!sig) return; // quote edges are outside the line-integrity product
      const key = `${e.market.fixtureId}|${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
      latest.set(key, { signal: sig, edge: e, frameTs: curTs });
    });

    const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
    const windowStart = firstOdds - 5 * 60_000;
    const events = [];
    for (const o of m.odds) if (o.Ts >= windowStart) events.push({ ts: o.Ts, kind: "odds", rec: o });
    for (const s of m.scores) if (s.Ts >= windowStart) events.push({ ts: s.Ts, kind: "scores", rec: s });
    events.sort((a, b) => a.ts - b.ts);

    // goal_imminent fires off the SCORE tape, not an engine edge, so we tap the scores
    // branch directly. Surface only strong triggers (high_danger / PossibleEvent.Goal;
    // conf >= IMMINENT_SURFACE_CONF) and collapse dense clusters with a cooldown so the
    // feed carries a modest cadence, not one warning per possession frame.
    const imminent = [];
    let lastImminentTs = -Infinity;
    for (const ev of events) {
      curTs = ev.ts;
      if (ev.kind === "odds") {
        engine.ingestOdds(ev.rec);
      } else {
        engine.ingestScores(ev.rec);
        const gi = goalImminent(ev.rec, { minute: engine.matchMinute(ev.rec.FixtureId) });
        if (gi && gi.confidence >= IMMINENT_SURFACE_CONF && gi.ts - lastImminentTs >= IMMINENT_COOLDOWN_MS) {
          lastImminentTs = gi.ts;
          imminent.push({ signal: gi, frameTs: ev.ts });
        }
      }
    }

    const edgeSignals = [...latest.values()].map(({ signal, edge, frameTs }) => ({
      id: edge.id,
      match: label,
      ...signal,
      pRef: round(signal.pRef, 4),
      edgeMeasure: round(signal.edgeMeasure, 4),
      frameTs,
      frameTsISO: new Date(frameTs).toISOString(),
      proofHash: edgeProofHash(edge),
    }));
    const imminentSignals = imminent.map(({ signal, frameTs }) => ({
      id: `gi_${signal.fixtureId}_${signal.ts}`,
      match: label,
      ...signal,
      frameTs,
      frameTsISO: new Date(frameTs).toISOString(),
      proofHash: scoreProofHash(signal),
    }));
    const signals = [...edgeSignals, ...imminentSignals];

    // strongest recommendation first (fade → suspend → hold → follow), then most recent
    signals.sort((a, b) => (ACTION_RANK[b.action] ?? 0) - (ACTION_RANK[a.action] ?? 0) || b.frameTs - a.frameTs);
    fixtures.push({ fixtureId: fid, label, signalCount: signals.length, signals });
  }

  fixtures.sort((a, b) => b.signalCount - a.signalCount);
  return fixtures;
}

// Fair prob for one SIDE of one market from a raw odds frame (mirrors engine._fairProbs).
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

// The closing line for CLV at the reversion horizon: the market's fair prob at the
// first frame at/after entryTs + horizon (Choi–Hui: overreactions revert within
// minutes, so we grade the call over that window, NOT end-of-match). Falls back to
// the last real quote for that market if the horizon runs past the capture.
const CLV_HORIZON_MS = 180_000; // ~3 min reversion window
function closeAtHorizon(oddsFrames, meta, entryTs) {
  const target = entryTs + CLV_HORIZON_MS;
  let atOrAfter = null;
  let last = null;
  for (const rec of oddsFrames) {
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    last = prob;
    if (rec.Ts >= target) { atOrAfter = prob; break; } // first quote at/after the horizon
  }
  return atOrAfter ?? last;
}

// Goals for a side from a Score record, tolerant of both feed shapes
// (Participant{n}.Total.Goals and Total.Participant{n}.Goals).
function goalsOf(sc, n) {
  if (!sc) return 0;
  const p = sc["Participant" + n];
  const pf = p?.Total?.Goals;
  if (pf != null) return Number(pf);
  const pe = sc.Total?.["Participant" + n]?.Goals;
  return pe != null ? Number(pe) : 0;
}
// Real goal times = match-time ms where the running-max goal count increments (mirrors the
// engine's monotonic goal detection). Used to settle goal_imminent on arrival + base rate.
function goalTimesFromScores(scores) {
  let p1 = 0, p2 = 0;
  const gt = [];
  for (const s of [...scores].sort((a, b) => a.Ts - b.Ts)) {
    if (!s.Score) continue;
    const n1 = Math.max(p1, goalsOf(s.Score, 1)), n2 = Math.max(p2, goalsOf(s.Score, 2));
    if (n1 > p1 || n2 > p2) { gt.push(Number(s.Ts)); p1 = n1; p2 = n2; }
  }
  return gt;
}
const ARRIVAL_WINDOW_MS = 120_000; // the anticipation horizon the 1.92× lift was measured over
const HELD_BAND = 0.1; // FCV band: follow/hold is correct if FCV reverted ≤10pp toward baseline

// Fair prob for one side at/before a target time (the pre-event baseline). No ordering
// assumption: take the latest qualifying frame with Ts ≤ target.
function fairProbAtOrBefore(oddsFrames, meta, targetTs) {
  let best = null;
  for (const rec of oddsFrames) {
    if (Number(rec.Ts) > targetTs) continue;
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    if (best == null || Number(rec.Ts) > best.ts) best = { ts: Number(rec.Ts), prob };
  }
  return best ? best.prob : null;
}

// ── the CALIBRATION LEDGER behind /proof ─────────────────────────────────────
// Replay the captures, emit signals, and SETTLE each against the market's fair line
// at the reversion horizon (deterministic CLV leg). goal_imminent has no CLV — it settles
// on GOAL-ARRIVAL (did a goal land within 120s → the 1.92× lift). The on-chain outcome leg
// is added live by the worker (validateStat); the snapshot proves the calibration numbers
// reproducibly from real frames alone. Returns the ledger (+ .imminent) + settled rows. Pure.
export function computeCalibration(replays) {
  const settled = [];
  const imminentRows = [];
  let totalGoals = 0, totalInplayMs = 0;

  for (const m of replays) {
    if (!m.odds?.length) continue;
    const fid = String(m.fid);
    const label = `${m.p1} v ${m.p2}`;
    const engine = new EdgeEngine(DETECT_OPTS);

    const latest = new Map();
    let curTs = 0;
    engine.on("edge", (e) => {
      const sig = classifyEdge(e, { minute: engine.matchMinute(e.market.fixtureId) });
      if (!sig) return;
      const key = `${e.market.fixtureId}|${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
      latest.set(key, { signal: sig, edge: e, frameTs: curTs }); // frameTs = MATCH time at emit
    });

    const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
    const windowStart = firstOdds - 5 * 60_000;
    const events = [];
    for (const o of m.odds) if (o.Ts >= windowStart) events.push({ ts: o.Ts, kind: "odds", rec: o });
    for (const s of m.scores) if (s.Ts >= windowStart) events.push({ ts: s.Ts, kind: "scores", rec: s });
    events.sort((a, b) => a.ts - b.ts);
    // collect EVERY surfaced goal_imminent (no cooldown here — max statistical power for
    // the arrival-rate calibration, matching the edge-lab's per-event methodology).
    const imminentEvents = [];
    for (const ev of events) {
      curTs = ev.ts;
      if (ev.kind === "odds") {
        engine.ingestOdds(ev.rec);
      } else {
        engine.ingestScores(ev.rec);
        const gi = goalImminent(ev.rec, { minute: engine.matchMinute(ev.rec.FixtureId) });
        if (gi && gi.confidence >= IMMINENT_SURFACE_CONF) imminentEvents.push(gi);
      }
    }

    // goal_imminent settles on GOAL-ARRIVAL. Grade each warning against this match's real
    // goal times + accumulate the base rate (uniform-arrival null) for the lift.
    const goalTimes = goalTimesFromScores(m.scores);
    const goalsMkt = m.odds.filter((o) => /PARTICIPANT_GOALS/.test(String(o.SuperOddsType))).map((o) => o.Ts);
    const spanMs = goalsMkt.length ? Math.max(...goalsMkt) - Math.min(...goalsMkt) : 0;
    totalGoals += goalTimes.length;
    totalInplayMs += spanMs;
    for (const gi of imminentEvents) {
      const arr = settleGoalArrival(gi, goalTimes, ARRIVAL_WINDOW_MS);
      imminentRows.push({
        fixtureId: fid, match: label, ts: gi.ts, minute: gi.minute, kind: gi.kind,
        trigger: gi.trigger, confidence: gi.confidence, goalProb: gi.goalProb,
        proofHash: scoreProofHash(gi), ...arr,
      });
    }

    // settle each signal against the market's fair line at the reversion horizon
    // (frameTs = the MATCH-time the signal fired; NOT edge.openedAt/wall-clock).
    for (const { signal, edge, frameTs } of latest.values()) {
      const closeProb = closeAtHorizon(m.odds, edge.market, frameTs);
      const clv = settleCLV(signal, closeProb);
      // FCV (Fair Close Value) band verdict for FOLLOW/HOLD (line should hold in its drift
      // region); FADE keeps the CLV-positive (reversion) verdict. `correct` is what /proof
      // grades on — CLV sign is NOT the test for follow/hold.
      const winMs = signal.kind === "overreaction" ? 150_000 : 90_000;
      const baseP = fairProbAtOrBefore(m.odds, edge.market, frameTs - winMs);
      const movedBack =
        baseP == null || closeProb == null ? null : Math.abs(signal.pRef - baseP) - Math.abs(closeProb - baseP);
      const held = movedBack == null ? null : movedBack <= HELD_BAND;
      const correct = signal.action === "fade" ? clv.clvRight : held;
      settled.push({
        fixtureId: fid,
        match: label,
        ts: frameTs,
        minute: signal.minute,
        kind: signal.kind,
        action: signal.action,
        firedBy: signal.firedBy,
        side: signal.side,
        superOddsType: signal.superOddsType,
        line: signal.line,
        pRef: round(signal.pRef, 4),
        direction: signal.direction,
        confidence: signal.confidence,
        liquidity: signal.liquidity ?? null,     // edge #2: neutral book-regime fact
        lateMatch: signal.lateMatch ?? false,    // edge #6
        pickoffRisk: signal.pickoffRisk ?? null,
        proofHash: edgeProofHash(edge),
        ...clv,
        closingProb: clv.closingProb == null ? null : round(clv.closingProb, 4),
        clvReturn: clv.clvReturn == null ? null : round(clv.clvReturn, 4),
        fcv: closeProb == null ? null : round(closeProb, 4), // Fair Close Value
        movedBack: movedBack == null ? null : round(movedBack, 4),
        held, // follow/hold: FCV within ±10pp band
        correct, // the /proof verdict: fade→CLV-positive, follow/hold→held
      });
    }
  }

  const baseRate = totalInplayMs ? (totalGoals * ARRIVAL_WINDOW_MS) / totalInplayMs : null;
  const ledger = calibrate(settled);
  ledger.imminent = calibrateArrival(imminentRows, baseRate); // arrival-based, not CLV
  return { ledger, settled, imminentSettled: imminentRows };
}

// ── the CONTROL-ROOM timeline behind /desk (D) ───────────────────────────────
// The demo where the read-only boundary is VISIBLE. For the strongest in-play match
// we replay the signals, attach a simulated NAIVE-FOLLOW book (the thing that gets
// picked off — pWatched + gapBps), run the operator's POLICY over each signal, and
// return a timeline: signal → the book's stale gap → the action the OPERATOR'S rule
// chose. We compute the decision; the operator's rule-set owns the action. The
// caption writes itself: "the signal is ours, the action is theirs — we never touched
// the book." Pure (given policy + lagMs). Defaults to BRA-JAP + the demo policy.
/**
 * @param {any[]} replays
 * @param {{ fixtureId?: string, policy?: any, lagMs?: number }} [opts]
 */
export function computeControlRoom(replays, opts = {}) {
  const { fixtureId, policy = DEMO_POLICY, lagMs = DEFAULT_LAG_MS } = opts;
  const signalFixtures = computeOperatorSignals(replays);
  const target = fixtureId
    ? signalFixtures.find((f) => String(f.fixtureId) === String(fixtureId))
    : signalFixtures[0]; // most signals first
  if (!target) return { fixtureId: null, label: null, lagMs, events: [], summary: { total: 0, acted: 0 } };

  const cap = replays.find((m) => String(m.fid) === String(target.fixtureId));
  const frames = cap?.odds || [];

  let acted = 0;
  let pickoffsFlagged = 0;
  const events = target.signals
    .map((sig) => {
      const withBook = withNaiveBook(sig, frames, sig.frameTs, lagMs);
      const { ruleIndex, action, matched } = evaluatePolicy(policy, withBook);
      if (matched && action.do !== "none") acted++;
      if (withBook.pickoffRisk === "high") pickoffsFlagged++;
      return {
        ts: sig.frameTs,
        tsISO: new Date(sig.frameTs).toISOString(),
        minute: sig.minute,
        market: sig.market,
        kind: sig.kind,
        pRef: sig.pRef,
        pWatched: withBook.pWatched,
        gapBps: withBook.gapBps, // the pickoff surface: stale book vs moved reference
        pickoffRisk: withBook.pickoffRisk,
        signalAction: sig.action, // OUR recommendation
        operatorRule: matched ? ruleIndex : null,
        operatorAction: describeAction(action), // what THEIR rule chose (we don't execute it)
        proofHash: sig.proofHash,
        note: sig.note,
      };
    })
    .sort((a, b) => a.ts - b.ts); // chronological for the demo tape

  return {
    fixtureId: target.fixtureId,
    label: target.label,
    lagMs,
    boundary: "Agenthesis emits the signal; the operator's policy takes the action. We never touch the book.",
    summary: { total: events.length, acted, pickoffsFlagged },
    events,
  };
}
