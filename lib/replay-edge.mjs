// REPLAY-WITH-EDGE — turn one published pickoff match into a policy replay (Linescout, Jul 5 2026).
//
// Bridges the pickoff ledger (pickoff-source.ts → matches[].series = [secFromKick, txlineFair,
// bookImplied|null]) to the trade policy: build aligned frames, recover the match outcome from the
// closing fair, run the policy, and return the frame path + divergence entries + positions + P&L —
// everything a surface needs to animate "the edge in play" and show virtual-USD returns.
//
// PURE (no I/O): the page/route feeds it an already-loaded match object.

import { runPolicy } from "./signals/trade-policy.mjs";
import { detectDivergences } from "./signals/divergence.mjs";

// series point = [secondsFromKick, txlineFair, bookImplied|null] → { ts, fair, pm }
export function framesFromSeries(series) {
  return (series || [])
    .filter((p) => Array.isArray(p) && p[1] != null)
    .map(([t, fair, pm]) => ({ ts: t, fair, pm: pm ?? null }));
}

// P(participant2 win) settles to ~1 if P2 won, ~0 on a P1 win or a draw. The closing TxLINE fair
// IS that settled probability, so the last decisive fair recovers the outcome (no separate score).
export function outcomeFromSeries(frames) {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i] && frames[i].fair != null) return frames[i].fair >= 0.5 ? 1 : 0;
  }
  return null;
}

export function buildReplayEdge(match, policy = {}) {
  const frames = framesFromSeries(match.series);
  const outcomeP2Win = outcomeFromSeries(frames);
  const { positions, summary, policy: p } = runPolicy(frames, policy, { outcomeP2Win });
  const entries = detectDivergences(frames, { theta: p.theta, cheapOnly: p.cheapOnly });
  return { fid: String(match.fid), teams: match.teams, outcomeP2Win, policy: p, frames, entries, positions, summary };
}
