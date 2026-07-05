// DIVERGENCE ENTRY SIGNAL — the Linescout lead-lag core (Jul 5 2026).
//
// Thesis (validated on the backfilled World Cup matches — see the two backtests in
// ~/backtest_both.py on the box):  TxLINE's de-vig 1X2 fair LEADS the prediction market's moneyline.
// When PM's price sits far enough BELOW the sharp fair, that outcome is being offered too
// cheap — an ENTRY on the cheap side.  Two independent results support it:
//   • Take-profit (Test 1): from the divergence, PM travelled to TxLINE's price before FT
//     ~81% of the time (unbounded hold; convergence often takes minutes).
//   • Resolution   (Test 2): buying the cheap side and holding to settlement returned
//     +11–17% per unit, and the edge GREW with the size of the divergence.
//
// This module emits ONLY the entry signal. It does NOT size or exit — a virtual-USD stake,
// the resolution/take-profit exit, and any time-stop live in the trade policy (task 6). Kept
// PURE (no I/O, no clock read, mirrors classify.mjs/agent-core.mjs): a fixed frame series maps
// to a fixed entry list, so signals are deterministic and unit-testable.
//
// ───────────────────────────────────────────────────────────────────────────
// A FRAME is the aligned pickoff shape — { ts, fair, pm } (or a [ts, fair, pm] tuple):
//   fair = TxLINE demargined P(participant2 win)  — the sharp reference line
//   pm   = prediction market implied  P(participant2 win)  — last trade / mid (may be null: no print yet)
//
// An entry fires when the SIGNED gap crosses the divergence threshold θ, on whichever side is
// cheap, with hysteresis (re-arms only after the gap heals below θ·disarmRatio) so ONE
// dislocation yields ONE entry, not a burst of them as the gap lingers.
//
//   side='yes' : fair > pm  → buy YES (P2-win)      at pm       ; worth  fair
//   side='no'  : pm  > fair → buy NO  (P2-not-win)  at 1−pm     ; worth  1−fair
//
// DivergenceEntry = {
//   ts, side ('yes'|'no'), sign (+1|-1),
//   gap,          // signed divergence at entry, in prob units (always ≥ θ)
//   pmAtEntry,    // PM implied P2-win at entry
//   fairAtEntry,  // TxLINE fair  P2-win at entry
//   entryProb,    // implied prob of the BOUGHT side (yes: pm ; no: 1−pm)
//   entryPrice,   // virtual-USD cost per share of the bought side (== entryProb, 0..1)
//   targetProb    // what the bought side is worth at the sharp line (yes: fair ; no: 1−fair)
// }

export const DEFAULT_THETA = 0.05; // 5pp divergence to fire an entry
export const DEFAULT_DISARM_RATIO = 0.5; // re-arm once the gap heals below θ·this
export const DEFAULT_PROB_BOUNDS = [0.02, 0.98]; // drop near-settlement extremes both sides

// Accept either an { ts, fair, pm } object or a [ts, fair, pm] tuple (the surface.json shape).
export function normalizeFrame(f) {
  if (Array.isArray(f)) return { ts: f[0], fair: f[1], pm: f[2] };
  return { ts: f.ts, fair: f.fair, pm: f.pm };
}

// Build one entry record from a fired divergence.
function makeEntry(ts, sign, fair, pm) {
  const entryProb = sign > 0 ? pm : 1 - pm; // implied prob of the bought (cheap) side
  const targetProb = sign > 0 ? fair : 1 - fair; // what that side is worth at the sharp line
  return {
    ts,
    side: sign > 0 ? "yes" : "no",
    sign,
    gap: +((fair - pm) * sign).toFixed(6), // signed divergence, ≥ θ
    pmAtEntry: pm,
    fairAtEntry: fair,
    entryProb,
    entryPrice: entryProb, // cost/share in virtual USD (0..1); sizing is the policy's job
    targetProb,
  };
}

// Scan aligned frames and emit divergence entries (the shared entry leg of both backtests).
export function detectDivergences(frames, opts = {}) {
  const theta = opts.theta ?? DEFAULT_THETA;
  const disarm = theta * (opts.disarmRatio ?? DEFAULT_DISARM_RATIO);
  const [lo, hi] = opts.probBounds ?? DEFAULT_PROB_BOUNDS;
  const sides = opts.cheapOnly ? [1] : [1, -1]; // default watches both cheap-yes and cheap-no
  const armed = { 1: true, "-1": true };
  const entries = [];
  for (const raw of frames || []) {
    const { ts, fair, pm } = normalizeFrame(raw);
    if (fair == null || pm == null) continue;
    if (fair < lo || fair > hi || pm < lo || pm > hi) continue; // valid sharp reference + price
    const gap = fair - pm;
    for (const sign of sides) {
      const signed = gap * sign;
      if (signed >= theta && armed[sign]) {
        armed[sign] = false;
        entries.push(makeEntry(ts, sign, fair, pm));
      } else if (signed < disarm) {
        armed[sign] = true; // gap healed → ready to fire this side again
      }
    }
  }
  return entries;
}

// Read-only summary (counts by side + average gap) for surfaces / sanity checks.
export function summarizeDivergences(entries) {
  const n = entries.length;
  const yes = entries.filter((e) => e.side === "yes").length;
  const avgGap = n ? entries.reduce((s, e) => s + e.gap, 0) / n : 0;
  return { n, yes, no: n - yes, avgGap: +avgGap.toFixed(4) };
}
