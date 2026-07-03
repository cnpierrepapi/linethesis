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
import { edgeProofHash } from "./frame-proof.mjs";
import { classifyEdge } from "./signals/classify.mjs";
import { settleCLV } from "./signals/settle.mjs";
import { calibrate } from "./signals/calibration.mjs";
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
const ACTION_RANK = { fade: 3, hold: 2, follow: 1 };

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
    for (const ev of events) {
      curTs = ev.ts;
      if (ev.kind === "odds") engine.ingestOdds(ev.rec);
      else engine.ingestScores(ev.rec);
    }

    const signals = [...latest.values()].map(({ signal, edge, frameTs }) => ({
      id: edge.id,
      match: label,
      ...signal,
      pRef: round(signal.pRef, 4),
      edgeMeasure: round(signal.edgeMeasure, 4),
      frameTs,
      frameTsISO: new Date(frameTs).toISOString(),
      proofHash: edgeProofHash(edge),
    }));

    // fade first (strongest recommendation), then most recent
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

// ── the CALIBRATION LEDGER behind /proof ─────────────────────────────────────
// Replay the captures, emit signals, and SETTLE each against the market's fair line
// at the reversion horizon (deterministic CLV leg). The on-chain outcome leg is added
// live by the worker (validateStat); the snapshot proves the calibration numbers
// reproducibly from real frames alone. Returns the ledger + settled rows. Pure.
export function computeCalibration(replays) {
  const settled = [];

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
    for (const ev of events) {
      curTs = ev.ts;
      if (ev.kind === "odds") engine.ingestOdds(ev.rec);
      else engine.ingestScores(ev.rec);
    }

    // settle each signal against the market's fair line at the reversion horizon
    // (frameTs = the MATCH-time the signal fired; NOT edge.openedAt/wall-clock).
    for (const { signal, edge, frameTs } of latest.values()) {
      const closeProb = closeAtHorizon(m.odds, edge.market, frameTs);
      const clv = settleCLV(signal, closeProb);
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
        proofHash: edgeProofHash(edge),
        ...clv,
        closingProb: clv.closingProb == null ? null : round(clv.closingProb, 4),
        clvReturn: clv.clvReturn == null ? null : round(clv.clvReturn, 4),
      });
    }
  }

  return { ledger: calibrate(settled), settled };
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
