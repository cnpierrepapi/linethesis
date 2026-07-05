// TRADE POLICY — how a divergence ENTRY becomes a virtual-USD position (Linescout, Jul 5 2026).
//
// The divergence module (divergence.mjs) says WHEN/WHERE to enter (PM lagging the TxLINE fair,
// on the cheap side). A trade policy says HOW MUCH to stake and WHEN to exit. It is the runnable
// spec behind "replay a match with the edge in play": feed it the aligned [ts,fair,pm] frames
// (+ the final outcome) and it returns every position with its P&L, in virtual USD only.
//
// EXITS (the two are exactly the validated backtests in ~/backtest_both.py, plus a time-stop):
//   • 'resolution' (DEFAULT) — hold to settlement. The bought side pays $1/share if it wins, else
//     $0. This is where the real edge lives (you entered under the true probability). Needs the
//     match outcome (outcomeP2Win = 1 if participant2 won, else 0).
//   • 'take_profit' — exit when PM travels to the TxLINE price (the gap you entered on closes).
//     Fills at the fair (a limit at TxLINE's line); `tpBandPp` takes profit a touch early. If PM
//     never reaches it before FT, falls back to resolution.
//   • 'time_stop' — mark out at entry + timeStopMs at the prevailing PM price; resolution if the
//     match ends first.
//
// PURE: no I/O, no clock. runPolicy(frames, policy, { outcomeP2Win }) -> deterministic result.
// A share count = stakeUsd / entryPrice, so a cheaper entry buys more shares (correct: the payoff
// is per share). Sizing is flat virtual USD per entry; Kelly/other sizing can layer on later.

import { detectDivergences, normalizeFrame } from "./divergence.mjs";

export const DEFAULT_POLICY = {
  theta: 0.05, // divergence threshold for entries (→ divergence.mjs)
  stakeUsd: 100, // flat virtual-USD stake per entry
  exit: "resolution", // 'resolution' | 'take_profit' | 'time_stop'
  tpBandPp: 0, // take-profit: take a touch before the fair (in pp); 0 = exactly TxLINE's price
  timeStopMs: null, // time_stop horizon
  cheapOnly: false, // pass-through: only the fair>pm (YES-cheap) direction
};

// Settle a single entry under the policy against the post-entry PM path (+ outcome for resolution).
function settleEntry(e, p, afterFrames, outcomeP2Win) {
  const shares = p.stakeUsd / e.entryPrice;
  const bandProb = (p.tpBandPp || 0) / 100;

  const resolve = () => {
    if (outcomeP2Win == null) return { mode: "resolution", exitTs: null, exitPrice: null, pnlUsd: null, reached: null, note: "no outcome" };
    const wins = e.side === "yes" ? outcomeP2Win : 1 - outcomeP2Win; // 1 | 0
    return { mode: "resolution", exitTs: null, exitPrice: wins, pnlUsd: shares * wins - p.stakeUsd, wins };
  };

  let exit;
  if (p.exit === "take_profit") {
    // target in P2-prob space = the TxLINE fair at entry; fill the bought side at that line
    const targetP2 = e.side === "yes" ? e.fairAtEntry - bandProb : e.fairAtEntry + bandProb;
    const hit = afterFrames.find((f) => (e.side === "yes" ? f.pm >= targetP2 : f.pm <= targetP2));
    if (hit) {
      const fill = e.side === "yes" ? targetP2 : 1 - targetP2; // price of the bought side at the fair
      exit = { mode: "take_profit", exitTs: hit.ts, exitPrice: fill, reached: true, pnlUsd: shares * fill - p.stakeUsd };
    } else {
      exit = { ...resolve(), reached: false, note: "tp not reached → resolution" };
    }
  } else if (p.exit === "time_stop") {
    const stopTs = e.ts + (p.timeStopMs || 0);
    const at = afterFrames.find((f) => f.ts >= stopTs);
    if (at) {
      const fill = e.side === "yes" ? at.pm : 1 - at.pm;
      exit = { mode: "time_stop", exitTs: at.ts, exitPrice: fill, reached: null, pnlUsd: shares * fill - p.stakeUsd };
    } else {
      exit = resolve();
    }
  } else {
    exit = resolve();
  }

  return {
    ...e,
    stakeUsd: p.stakeUsd,
    shares: +shares.toFixed(4),
    exit,
    pnlUsd: exit.pnlUsd == null ? null : +exit.pnlUsd.toFixed(2),
    returnPct: exit.pnlUsd == null ? null : +(exit.pnlUsd / p.stakeUsd).toFixed(4),
  };
}

// Run a whole match: detect divergence entries, settle each under the policy, aggregate.
export function runPolicy(frames, policy = {}, ctx = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const entries = detectDivergences(frames, { theta: p.theta, cheapOnly: p.cheapOnly });
  const path = (frames || []).map(normalizeFrame).filter((f) => f.pm != null && f.ts != null);
  const positions = entries.map((e) => settleEntry(e, p, path.filter((f) => f.ts > e.ts), ctx.outcomeP2Win));
  return { policy: p, positions, summary: summarizePolicy(positions, p) };
}

// Aggregate P&L across positions (virtual USD).
export function summarizePolicy(positions, p) {
  const settled = positions.filter((x) => x.pnlUsd != null);
  const n = settled.length;
  const pnl = settled.reduce((s, x) => s + x.pnlUsd, 0);
  const staked = n * p.stakeUsd;
  const wins = settled.filter((x) => x.pnlUsd > 0).length;
  const reached = positions.filter((x) => x.exit.reached === true).length;
  return {
    entries: positions.length,
    settled: n,
    totalStakedUsd: +staked.toFixed(2),
    totalPnlUsd: +pnl.toFixed(2),
    avgReturnPct: n ? +(pnl / staked).toFixed(4) : 0,
    winRate: n ? +(wins / n).toFixed(3) : 0,
    reachRate: positions.length ? +(reached / positions.length).toFixed(3) : 0,
  };
}
