// Agenthesis SDK — quant-desk quickstart (runnable).
//
//   node examples/desk_quickstart.mjs
//
// Demonstrates the desk integration end to end on REAL captured TxLINE frames:
//   feed the demargined book  ->  engine emits typed edges  ->  your strategy
//   decides (decide)  ->  positions are scored on closing-line value (markPosition).
// No network, no token: it replays bundled real frames (lib/replays.json) so the
// output is deterministic. In production you would feed your own live stream.

import { readFileSync } from "node:fs";
import { EdgeEngine, defineStrategy, createAgent, decide, markPosition } from "../sdk/index.mjs";

// 1) Detection thresholds (match-time windows; calibrated to real in-play books).
const engine = new EdgeEngine({
  steamThreshold: 0.015,
  steamWindowMs: 90_000,
  overreactionThreshold: 0.03,
  overreactionWindowMs: 150_000,
  quoteThreshold: 0.006,
  quoteWindowMs: 60_000,
  historyMs: 300_000,
  edgeTtlMs: 60_000,
  edgeCooldownMs: 0, // no wall-clock cooldown in a synchronous backtest
});

// 2) YOUR strategy — a desk brings its own lever set (here: fractional Kelly on
//    all three edge kinds). The SDK never prescribes a strategy.
const strategy = defineStrategy(
  { edgeKinds: ["steam", "overreaction", "quote"], stakeMode: "kelly", kellyFraction: 0.5, minConviction: 0.006, maxConcurrent: 6 },
  { label: "desk-kelly" },
);
const agent = createAgent({ name: "Desk", bankroll: 100_000, strategies: [strategy] });

// A position settles at its market's CLOSE — the last real quote before the
// market goes quiet (stops re-quoting for this long in match-time). Same idea the
// live runner uses; here it also frees concurrency so trades keep flowing.
const CLOSE_QUIET_MATCH_MS = 120_000;

// 3) Wire decisions. The engine emits an edge; you decide and (in production)
//    route the order. Here we open a paper position, mark it live, and settle it
//    on the closing line.
let curOff = 0;
let edgesSeen = 0;
const open = [];
const settled = [];

engine.on("edge", (edge) => {
  edgesSeen++;
  const minute = engine.matchMinute(edge.market.fixtureId);
  const d = decide(agent, edge, { minute, openCount: open.length });
  if (!d.take) return;
  open.push({
    market: edge.market,
    kind: edge.kind,
    side: d.side,
    direction: d.direction,
    entryProb: d.entryProb,
    entryOdds: d.entryOdds,
    stake: d.stake,
    entryOff: curOff,
    lastQuoteOff: curOff, // match-offset of this market's last observed quote
    markProb: d.entryProb, // live provisional mark
  });
});

// Settle any position whose market has gone quiet (closed) at its last real quote
// = the closing line. `force` closes everything still open at the final frame.
function settleClosed(nowOff, force = false) {
  for (let i = open.length - 1; i >= 0; i--) {
    const p = open[i];
    const f = engine.markFrameForMarket(p.market); // { prob, ts } of the latest real frame
    if (f) {
      const off = f.ts - firstTs;
      if (off > p.lastQuoteOff) {
        p.lastQuoteOff = off; // re-quoted → still trading
        if (off > p.entryOff) p.markProb = f.prob;
      }
    }
    const closed = force || nowOff - p.lastQuoteOff >= CLOSE_QUIET_MATCH_MS;
    if (closed && p.lastQuoteOff > p.entryOff) {
      const { clvReturn, pnl } = markPosition(p, p.markProb);
      agent.bankroll += pnl;
      settled.push({ ...p, clvReturn, pnl });
      open.splice(i, 1);
    }
  }
}

// 4) Feed real frames in match-time order (rewrite Ts to a monotonic offset so
//    the engine's windows read correctly). One match for a clean demo.
const replays = JSON.parse(readFileSync(new URL("../lib/replays.json", import.meta.url)));
const match = [...replays].sort((a, b) => b.odds.length - a.odds.length)[0];
const firstTs = Math.min(...match.odds.map((o) => o.Ts));
const stream = [
  ...match.odds.map((r) => ({ kind: "odds", rec: r, off: r.Ts - firstTs })),
  ...match.scores.map((r) => ({ kind: "scores", rec: r, off: r.Ts - firstTs })),
].sort((a, b) => a.off - b.off);

console.log(`Feeding ${match.p1} v ${match.p2} — ${match.odds.length} odds + ${match.scores.length} score frames…\n`);
for (const e of stream) {
  curOff = e.off;
  const rec = { ...e.rec, Ts: firstTs + e.off };
  if (e.kind === "odds") engine.ingestOdds(rec);
  else engine.ingestScores(rec);
  settleClosed(curOff);
}
// Close out anything still open at the final frame — the match's closing line.
settleClosed(curOff, true);

// 5) Report.
const shown = settled.slice(0, 8);
for (const s of shown) {
  console.log(
    `  ${s.kind.padEnd(12)} ${s.direction} ${s.side.padEnd(6)} @ ${s.entryOdds.toFixed(2)} ` +
      `$${s.stake.toFixed(0).padStart(5)}  ->  CLV ${(s.clvReturn * 100).toFixed(1).padStart(6)}%  ${pnlStr(s.pnl)}`,
  );
}
if (settled.length > shown.length) console.log(`  … ${settled.length - shown.length} more`);

const net = settled.reduce((s, p) => s + p.pnl, 0);
const wins = settled.filter((p) => p.pnl >= 0).length;
const avgClv = settled.length ? settled.reduce((s, p) => s + p.clvReturn, 0) / settled.length : 0;
console.log(
  `\n${edgesSeen} edges -> ${settled.length} positions · win-rate ${((wins / (settled.length || 1)) * 100).toFixed(0)}% ` +
    `· avg CLV ${(avgClv * 100).toFixed(2)}% · net ${pnlStr(net)} on $100k bankroll`,
);

function pnlStr(n) {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}
