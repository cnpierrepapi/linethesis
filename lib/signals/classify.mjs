// SIGNAL CLASSIFIER — the read-only core of Agenthesis (LOCKED framing, Jul 2 2026).
//
// Agenthesis is a *provable line-integrity oracle*: it benchmarks an operator's price
// against TxLINE's vig-free (demargined) consensus, warns when a line is stale enough to
// get picked off, and never touches the book. This module is the pure transform from the
// engine's reference-line dynamics (an `edge`) — plus, optionally, the operator's own
// watched price — into a read-only SIGNAL the operator's rule-set can act on.
//
// It is intentionally plain JS with NO I/O and NO clock reads (mirrors agent-core.mjs):
// every function is a pure mapping, so signals are deterministic and unit-testable.
//
// ───────────────────────────────────────────────────────────────────────────
// THE SIGNAL (locked shape)
//   { fixtureId, market, line, ts, minute, pRef, pWatched, gapBps, kind, action,
//     confidence, firedBy, revertLikely, pickoffRisk, direction, note }
//
//   kind    ∈ steam | overreaction | goal_imminent
//   action  ∈ follow | hold | fade | suspend-suggested      (the OPERATOR acts, not us)
//
//   pRef      = TxLINE demargined fair prob (the truth we benchmark against)
//   pWatched  = the operator's / a watched book's implied prob at the same instant (optional)
//   gapBps    = signed (pWatched − pRef) in basis points  → the pickoff surface (null if no book)
//
// WHY these actions (grounded in the research AND re-checked against our own captures):
//   • steam         (Croxson & Reade 2014, EJ; Moskowitz 2021, JFE) — the market prices real
//                    news efficiently and momentum PERSISTS. A clean move is TRUE and carries →
//                    FOLLOW / tighten. THIS IS THE PRIMARY EDGE: in our 4-match data a flagged
//                    move HELD 89% of the time (54% extended further); a lagging book following
//                    late is exactly the stale price a sharp lifts. The oracle's core job is
//                    catching the real move fast so the operator isn't picked off on it.
//   • overreaction  (Choi & Hui 2014; De Bondt–Thaler) — bettors UNDERREACT to most goals and
//                    OVERREACT only to *surprising* ones, so only a MINORITY of goal-moves
//                    overshoot-and-revert. Our data: just ~18% of flagged overreactions genuinely
//                    reverted; 82% were efficient reprices that STUCK. And magnitude does NOT
//                    predict reversion (big goal-moves are usually decisive → they stick). So the
//                    default is HOLD (don't chase the volatile overshoot, don't blindly fade
//                    either), and we escalate to FADE only when the move is SURPRISE-driven
//                    (Choi–Hui's condition) — never on size alone.
//   • LIQUIDITY GATE (edge #2, Task-3 sweep — the measured discriminator between the two
//                    above): edge_lab found a move's fate depends on book thickness — THICK/
//                    liquid lines DRIFT (the move carries → follow is right), THIN/illiquid
//                    lines MEAN-REVERT (noise → the follow is a trap and a stale line gets
//                    picked off). We ride this on `quoteDensity`: a thin book (or the closing
//                    ~20min, edge #6, where drift amplifies) ESCALATES a steam signal's
//                    pickoffRisk, and the signal carries `liquidity`/`driftRegime` so the
//                    operator's rule-set can act on the regime. Null-safe: no density → no change.
//   • goal_imminent — the momentum tape (high_danger_possession / PossibleEvent.Goal) fires
//                    seconds BEFORE a goal lands → SUSPEND-SUGGESTED, carrying a QUANTIFIED
//                    goalProb = calibrated P(goal ≤120s | trigger). Grounded on our 4 captures
//                    (edge_lab.mjs, 234 events): high_danger 1.92× lift, danger 1.38×, shot 0×
//                    (excluded). ACTION = suspend/widen ONLY: the odds-drift test (Task 2)
//                    showed the line does NOT pre-drift goal-ward tradeably (consensus already
//                    prices the danger) → no over-lean; value is goal-ARRIVAL, not pre-drift.
//
// NOTE: the engine also fires a low-conviction "quote" (micro-drift) edge. That is not part of
// the line-integrity product — classifyEdge() returns null for it.

const THRESH = { steam: 0.04, overreaction: 0.08 }; // pp move that defines each kind (mirrors engine DEFAULTS)
const FADE_CONF = 0.7;      // escalate hold → fade only above this confidence (default-to-safe below)
const SURPRISE_NORM = 0.15; // a ~15pp scoreline-prob jump at the event = maximal "surprise" (proxy)
const PICKOFF_BPS = { high: 150, med: 60 }; // |gap| in bps → pickoff-risk tiers

// ── Task-3 edge-lab measurements (scripts/edge_lab.mjs on the 4 in-play WC captures) ──
// Re-estimated on OUR AH/OU demargined goals feed. The NBA/Kalshi numbers in the research
// sweep are PRIORS; these are the signs/gates that actually held on soccer:
//   #2 LIQUIDITY IS THE STATE THAT DECIDES FOLLOW-vs-FADE (the headline winner). Splitting
//      innovations by quote density: THICK/liquid lines DRIFT (β>0, t≈+9; impliedAdj≈0.74,
//      right next to the 0.64 NBA underreaction prior — partial-adjustment replicates where
//      trading is active) while THIN/illiquid lines MEAN-REVERT (β<0, t≈−15, noise). So a
//      thin book is exactly where a stale line gets picked off — the product thesis, measured.
//   #1 the POOLED line mean-reverts at 1–15min (β≈−0.08, t≈−17, noise-bias-guarded) because
//      thin lines out-number thick — the consensus as a whole does NOT underreact.
//   #4 large single-increment crossers revert at 30–60s (autocorr −0.15); small noise ≈ RW.
//   #6 the drift AMPLIFIES late: β_late>0 at 5–15min in the closing ~20min (suggestive, small-n).
//   #3 surprise-gated fade stays UNDERPOWERED (10 goals / 1 in-band) — parked for ~50–80 matches.
const LIQ_QUOTES_60S = 8;   // median quote count / 60s in our captures → THIN(≤8) vs THICK(>8)
const LATE_MATCH_MIN = 70;  // ≥70' = the closing ~20min where drift amplifies (edge #6)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// "line=2.5" → 2.5 ; null when the market carries no line.
export function parseLine(marketParameters) {
  const m = /line=(-?\d+(?:\.\d+)?)/.exec(String(marketParameters || ""));
  return m ? Number(m[1]) : null;
}

// Compact human label for a market (fixture-agnostic): "OVERUNDER_PARTICIPANT_GOALS line=2.5 over".
function marketLabel(meta) {
  return `${meta.superOddsType} ${meta.marketParameters} ${meta.side}`.trim();
}

// Confidence ∈ [0,1] from the raw move magnitude, refined by SURPRISE when we know the
// pre-event fair prob. Magnitude alone is the honest fallback (firedBy:'magnitude'); the
// surprise-conditioned path (firedBy:'surprise') is the principled Choi–Hui upgrade.
function scoreConfidence(kind, edgeMeasure, fairProb, preEventProb) {
  const thr = THRESH[kind] ?? 0.04;
  const mag = clamp01(edgeMeasure / (2 * thr)); // 0.5 at threshold, 1.0 at 2× threshold
  if (preEventProb == null) return { confidence: mag, firedBy: "magnitude", surprise: null };
  const surprise = clamp01(Math.abs(fairProb - preEventProb) / SURPRISE_NORM);
  return { confidence: clamp01(0.5 * mag + 0.5 * surprise), firedBy: "surprise", surprise };
}

function pickoffTier(gapBps) {
  const g = Math.abs(gapBps);
  return g >= PICKOFF_BPS.high ? "high" : g >= PICKOFF_BPS.med ? "med" : "low";
}

const RISK_ORDER = ["low", "med", "high"];
const bumpRisk = (r) => RISK_ORDER[Math.min(RISK_ORDER.indexOf(r) + 1, 2)] || r;

// edge #2 liquidity gate: quote density → book regime. THICK ⇒ a move CARRIES (drift/
// underreaction, β>0) so a lagging book is genuinely exposed to it; THIN ⇒ the move is
// more likely noise that mean-reverts (β<0). Null when the engine didn't supply density.
function liquidityRegime(quoteDensity) {
  if (quoteDensity == null) return { liquidity: null, driftRegime: null };
  const thin = quoteDensity <= LIQ_QUOTES_60S;
  return { liquidity: thin ? "thin" : "thick", driftRegime: thin ? "revert" : "carry" };
}

// ── the main transform ──────────────────────────────────────────────────────
// edge : an engine-emitted edge (see lib/edge/engine.mjs — kind/market/edgeMeasure/fairProb/
//        direction/note, + optional preEventProb we surface for surprise).
// ctx  : { minute?, watchedProb?, preEventProb? }
//        watchedProb = the operator's / a naive-follow book's implied prob for THIS side, now.
// returns a read-only Signal, or null for kinds outside the line-integrity product.
export function classifyEdge(edge, ctx = {}) {
  if (!edge || (edge.kind !== "steam" && edge.kind !== "overreaction")) return null;

  const meta = edge.market;
  // DATA SCOPE (locked): only the two demargined goals markets are on-chain-settleable
  // via validate_stat (AH-goals + O/U-goals). 1X2 / anything else is out of scope — it
  // can't be Merkle-verified, so we never emit a signal we can't later prove.
  if (!/PARTICIPANT_GOALS/.test(String(meta.superOddsType))) return null;
  const pRef = edge.fairProb;
  const preEventProb = ctx.preEventProb ?? edge.preEventProb ?? null;
  const { confidence, firedBy, surprise } = scoreConfidence(edge.kind, edge.edgeMeasure, pRef, preEventProb);

  // edge #2 (liquidity) + edge #6 (late-match) conditioning — both null-safe (only act when
  // the engine/ctx supply the input, so signals without them are byte-identical to before).
  const quoteDensity = ctx.quoteDensity ?? edge.quoteDensity ?? null;
  const { liquidity } = liquidityRegime(quoteDensity); // 'thin'|'thick'|null — a neutral fact
  // NOTE: we deliberately DON'T attach a carry/revert *verb* to a signal. Edge #2's
  // "thin → revert" was measured on the general innovation stream (mostly small wobble). A
  // STEAM signal is a large threshold-crosser, which CARRIES regardless of liquidity (edge #4;
  // verified 28/28 thin steams carried in AUS v EGY), and a goal-driven overreaction is
  // decisive and STICKS. So the reversion base-rate doesn't transfer to either — printing
  // "revert" beside a "held" outcome was contradictory. Liquidity's only per-signal use is as
  // a PICKOFF-RISK amplifier (a thin book lagging a real move gets lifted harder); the
  // carry/revert base-rate lives only in the aggregate /proof panel, where it belongs.
  const minute = ctx.minute ?? null;
  const lateMatch = minute != null && minute >= LATE_MATCH_MIN && !!meta.inRunning;

  // action: steam → follow (the move is real and carries — the primary edge).
  // overreaction → HOLD by default; escalate to FADE only on the SURPRISE path (Choi–Hui:
  // overreactions come from surprising goals). We refuse to fade on magnitude alone, because
  // in our data big goal-moves are decisive and STICK — size does not predict reversion.
  const action =
    edge.kind === "steam"
      ? "follow"
      : firedBy === "surprise" && confidence >= FADE_CONF
        ? "fade"
        : "hold";
  // A real overshoot-and-revert is the exception (~18% of goal-moves in our data), and only a
  // fade (surprise-gated) is a positive reversion call; a plain hold is "don't chase / wait".
  const revertLikely = edge.kind === "overreaction" && action === "fade";

  // pickoff surface: only meaningful when we have the operator's price to compare.
  const pWatched = ctx.watchedProb ?? null;
  const gapBps = pWatched == null ? null : Math.round((pWatched - pRef) * 10000);
  // Risk the operator gets picked off:
  //   • overreaction → HIGH regardless — they're exposed to the coming revert whether their line
  //     matched the overshoot (loses on revert) or lags it (sharp hits the rich side). Default-safe.
  //   • steam (a TRUE move) → the exposure IS the gap: tight to the reference = safe, lagging =
  //     picked off. With no book to compare, fall back to how strong the move is.
  let pickoffRisk =
    edge.kind === "overreaction"
      ? "high"
      : gapBps != null
        ? pickoffTier(gapBps)
        : confidence >= FADE_CONF
          ? "med"
          : "low";
  // Escalate the STEAM (follow) leg's pickoff risk when the data says a lagging book is
  // MORE exposed to a real carrying move: a THIN book (edge #2 — thin lines are where a
  // stale price gets picked off) or the closing ~20min (edge #6 — drift amplifies late).
  // Never downgrades; overreaction already sits at 'high'.
  if (edge.kind === "steam" && (liquidity === "thin" || lateMatch)) {
    pickoffRisk = bumpRisk(pickoffRisk);
  }

  return {
    fixtureId: meta.fixtureId,
    market: marketLabel(meta),
    superOddsType: meta.superOddsType,
    marketPeriod: meta.marketPeriod,
    side: meta.side,
    line: parseLine(meta.marketParameters),
    ts: edge.openedAt,
    minute,
    inRunning: !!meta.inRunning,
    pRef,
    pWatched,
    gapBps,
    kind: edge.kind,
    action,               // the RECOMMENDATION — the operator's rule-set decides whether to act
    confidence: Math.round(confidence * 1000) / 1000,
    firedBy,              // 'surprise' (principled) | 'magnitude' (fallback) — honest provenance
    surprise: surprise == null ? null : Math.round(surprise * 1000) / 1000,
    revertLikely,
    pickoffRisk,
    liquidity,            // edge #2: 'thin'|'thick'|null — a neutral book-regime FACT (no verb)
    lateMatch,            // edge #6: in the closing ~20min (a fact; feeds pickoff for steam)
    direction: edge.direction, // engine's back/lay call on pRef (for CLV settlement later)
    edgeMeasure: edge.edgeMeasure,
    trigger: edge.trigger ?? null,
    // Only annotate the steam pickoff amplifier (thin book / late match raise stale-line
    // exposure). No carry/revert prediction — steam moves carry regardless of liquidity.
    note:
      edge.kind === "steam" && (liquidity === "thin" || lateMatch)
        ? `${edge.note}${liquidity === "thin" ? " · thin book (stale-line pickoff risk ↑)" : ""}${lateMatch ? " · late match" : ""}`
        : edge.note,
  };
}

// ── goal-imminent anticipation (momentum tape) ──────────────────────────────
// A FIRST-CLASS signal emitted alongside steam/overreaction. Fires off the scores stream
// from the attacking-pressure tape BEFORE a goal lands, fixture-level (no market/line yet),
// carrying a QUANTIFIED goalProb = the calibrated P(goal within 120s | trigger) MEASURED on
// our captures (edge_lab.mjs, 234 danger events), not a bare boolean. The operator's rule-set
// uses it to suspend / widen in-play goals markets pre-emptively.
//
//   high_danger_possession → P(goal ≤120s) 0.111 vs 0.058 base = 1.92× lift  (STRONG)
//   danger_possession      → 0.080 = 1.38×                                    (weak → not surfaced alone)
//   shot                   → 0.98× = NO lift → EXCLUDED (build-up pressure predicts, shots don't)
//   PossibleEvent.Goal     = TxLINE's explicit "goal about to happen" flag    (strongest)
const BASE_GOAL_RATE_120S = 0.058;   // base P(goal in any 120s in-play window)
const GOAL_RATE = { high_danger_possession: 0.111, danger_possession: 0.080 }; // measured arrival rates
const POSSIBLE_GOAL_RATE = 0.15;     // explicit imminent flag (flag-based, not lift-measured)
const IMMINENT_SPAN = 0.12;          // goalProb mapping to confidence 1.0
export const IMMINENT_SURFACE_CONF = 0.5; // below this = danger-only noise; don't surface standalone

// normalize a calibrated arrival prob into a [0,1] confidence relative to the base rate.
function imminentConfidence(goalProb) {
  return clamp01((goalProb - BASE_GOAL_RATE_120S) / (IMMINENT_SPAN - BASE_GOAL_RATE_120S));
}

// Which participant is pressuring, from the UN-SLIMMED momentum tape (Data.Participant or
// Parti*State danger flags). null on the older directionless captures — the seam directional
// widening plugs into once un-slimmed frames flow. Best-effort, never throws.
function attackingSide(rec) {
  const p = rec?.Data?.Participant;
  if (p === 1 || p === 2 || p === "1" || p === "2") return Number(p);
  const dangerState = (s) => /danger/i.test(String(s?.PossessionType ?? s ?? ""));
  const d1 = dangerState(rec?.Parti1State), d2 = dangerState(rec?.Parti2State);
  if (d1 && !d2) return 1;
  if (d2 && !d1) return 2;
  return null;
}

export function goalImminent(scoreRec, ctx = {}) {
  if (!scoreRec) return null;
  const action = String(scoreRec.Action || "");
  const possibleGoal = scoreRec.PossibleEvent?.Goal === true || scoreRec.Data?.PossibleEvent?.Goal === true;
  let goalProb = GOAL_RATE[action] ?? 0;
  if (possibleGoal) goalProb = Math.max(goalProb, POSSIBLE_GOAL_RATE);
  if (goalProb <= 0) return null; // not a danger/imminent frame (shot, safe possession, …)

  // possession-tier confidence is the calibrated lift (high_danger ≈ 0.85, danger ≈ 0.35);
  // PossibleEvent.Goal is TxLINE's explicit imminent flag → fixed strong 0.9 (dominates any
  // tier on the same frame, since no tier exceeds it).
  const confidence = possibleGoal ? 0.9 : imminentConfidence(goalProb);

  return {
    fixtureId: scoreRec.FixtureId,
    market: null,
    line: null,
    ts: Number(scoreRec.Ts) || null,
    minute: ctx.minute ?? null,
    inRunning: true,
    pRef: null,
    pWatched: null,
    gapBps: null,
    kind: "goal_imminent",
    action: "suspend-suggested",
    confidence: Math.round(confidence * 1000) / 1000,
    goalProb: Math.round(goalProb * 1000) / 1000, // QUANTIFIED: calibrated P(goal ≤120s | trigger)
    firedBy: possibleGoal ? "possible_event" : "possession_tier",
    revertLikely: false,
    pickoffRisk: confidence >= 0.8 ? "high" : "med",
    direction: null,
    attackingParticipant: attackingSide(scoreRec), // 1|2|null — for directional widening
    trigger: possibleGoal ? "PossibleEvent.Goal" : action,
    note: `goal-imminent (${possibleGoal ? "PossibleEvent.Goal" : action}, P(goal≤120s)≈${(goalProb * 100).toFixed(0)}%); suspend/widen before the in-play line goes stale`,
  };
}

export const _internal = {
  THRESH, FADE_CONF, SURPRISE_NORM, PICKOFF_BPS, scoreConfidence, pickoffTier,
  BASE_GOAL_RATE_120S, GOAL_RATE, imminentConfidence, attackingSide,
  LIQ_QUOTES_60S, LATE_MATCH_MIN, liquidityRegime, bumpRisk,
};
