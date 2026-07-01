// Regenerates lib/exec-ledger.json — the canonical cold-start trade ledger that
// /api/verify-csv ships when a fresh instance has no warm runner history.
//
// It replays the bundled REAL TxLINE frames (lib/replays.json) through the SAME
// edge engine and decision core the live runner uses, in real wall-time at an
// accelerated SPEED, and applies the SAME settlement rule the runner enforces: a
// position settles at the market's CLOSE — its last real quote before it stops
// quoting (detected as the market going quiet) — so every settled row carries a
// verifiable entry AND closing leg that reconciles against replays.json. The live
// AgentRunner remains the source of truth; this mirrors its seedDemoAgents()/
// papers BASE so the offline capture matches its behaviour.
//
// Run: node scripts/gen_exec_ledger.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EdgeEngine } from "../lib/edge/engine.mjs";
import { decide, markPosition } from "../lib/agent-core.mjs";
import { edgeProofHash, markProofHash } from "../lib/frame-proof.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPLAYS = JSON.parse(readFileSync(join(root, "lib/replays.json"), "utf8"));

// ---- engine + agent config (mirrors lib/feed.ts REPLAY_OPTS + lib/papers.ts) --
const REPLAY_OPTS = {
  steamThreshold: 0.015, steamWindowMs: 90_000, overreactionThreshold: 0.03,
  overreactionWindowMs: 150_000, quoteThreshold: 0.005, quoteWindowMs: 60_000,
  historyMs: 300_000, edgeTtlMs: 8_000, edgeCooldownMs: 6_000,
};
const BASE = {
  edgeKinds: ["quote"], minConviction: 0.003, stakeMode: "flat", stakePct: 0.05,
  kellyFraction: 0.5, phase: "both", minMinute: 0, maxMinute: 90, marketFilter: [],
  oddsMin: 1.3, oddsMax: 6.0, maxConcurrent: 3, direction: "follow",
};
const base = (o) => ({ ...BASE, ...o });
const PAPERS = {
  "steam-base": { kind: "steam", title: "Sharp Money and the Information Content of Line Moves", levers: { ...BASE, direction: "follow" } },
  "overreaction-base": { kind: "overreaction", title: "Market Overreaction to Salient In-Play Events", levers: { ...BASE, direction: "follow", phase: "inplay" } },
  "overreaction-redcard": { kind: "overreaction", title: "Red Cards and the Mispricing of Numerical Disadvantage", levers: { ...BASE, direction: "follow", phase: "inplay", minConviction: 0.08 } },
};
function buildStrategies(baseLevers, paperIds) {
  const strats = paperIds.map((pid) => ({
    label: PAPERS[pid].title, source: "paper", paperId: pid,
    edgeKinds: [PAPERS[pid].kind], levers: PAPERS[pid].levers,
  }));
  strats.push({ label: "base tuning", source: "base", paperId: null, edgeKinds: baseLevers.edgeKinds, levers: baseLevers });
  return strats;
}
function mkAgent(id, name, paperIds, baseLevers) {
  return { id, name, status: "running", bankroll: 350, strategies: buildStrategies(baseLevers, paperIds), positions: [], seq: 0 };
}
const AGENTS = [
  mkAgent("agent_1", "Market Pulse", [], base({ stakePct: 0.04, maxConcurrent: 4 })),
  mkAgent("agent_2", "The Closer", ["steam-base"], base({ stakePct: 0.05 })),
  mkAgent("agent_3", "Mean Reverter", ["overreaction-base"], base({ stakePct: 0.06, direction: "fade" })),
  mkAgent("agent_4", "The Cynic", ["overreaction-redcard"], base({ stakePct: 0.03, maxConcurrent: 2 })),
];

const labels = new Map();
const engine = new EdgeEngine(REPLAY_OPTS);
const CLOSE_QUIET_MS = 2_500; // wall silence that means the market has closed — matches runner CLOSE_QUIET_REPLAY
const SPEED = 30; // match-seconds per wall-second — prod parity, so the quiet windows match the live runner
let seq = 0;

// ---- the runner's onEdge / markAll, replicated ------------------------------
engine.on("edge", (edge) => {
  for (const agent of AGENTS) {
    const openCount = agent.positions.filter((p) => p.status === "open").length;
    const minute = engine.matchMinute(edge.market.fixtureId);
    const d = decide(agent, edge, { minute, openCount });
    if (!d.take || d.stake == null) continue;
    const res = engine.stake(edge.id, d.stake);
    if (!res.ok || !res.accepted) continue;
    const now = Date.now();
    const entryFrame = engine.markFrameForMarket(edge.market);
    const entryTs = entryFrame?.ts ?? now;
    agent.positions.push({
      id: `pos_${++seq}`, agent: agent.name, source: d.source || "base tuning", paperId: d.paperId ?? null,
      kind: edge.kind, market: edge.market,
      fixtureId: edge.market.fixtureId, superOddsType: edge.market.superOddsType,
      marketParameters: edge.market.marketParameters, sideIndex: edge.market.sideIndex,
      side: d.side, direction: d.direction, entryProb: d.entryProb, odds: d.entryOdds, entryTs,
      stake: res.accepted, proofHash: edgeProofHash(edge), openedAt: now,
      markTs: entryTs, lastQuoteWall: now,
      exitProb: null, exitOdds: null, exitTs: null, exitProofHash: null,
      clvReturn: 0, pnl: 0, status: "open",
    });
  }
});

function markAll() {
  const now = Date.now();
  for (const agent of AGENTS) {
    for (const pos of agent.positions) {
      if (pos.status !== "open") continue;
      const frame = engine.markFrameForMarket(pos.market);
      if (!frame) continue;
      // Re-quoted since last look → refresh the live mark and reset the quiet clock.
      if (frame.ts > pos.markTs) {
        if (frame.ts > pos.entryTs) {
          const { clvReturn, pnl } = markPosition(pos, frame.prob);
          pos.clvReturn = clvReturn;
          pos.pnl = pnl;
        }
        pos.markTs = frame.ts;
        pos.lastQuoteWall = now;
        continue;
      }
      // Market quiet long enough → it has closed; its last real quote is the
      // closing line the position settles on.
      if (now - pos.lastQuoteWall >= CLOSE_QUIET_MS && pos.markTs > pos.entryTs) {
        pos.exitProb = frame.prob;
        pos.exitOdds = Math.round((1 / frame.prob) * 1000) / 1000;
        pos.exitTs = frame.ts;
        pos.exitProofHash = markProofHash(pos.market, frame.prob, pos.kind);
        pos.status = "settled";
      }
    }
  }
}

// ---- replay scheduler (mirrors lib/feed.ts startReplay) ---------------------
const events = [];
for (const m of REPLAYS) {
  if (!m.odds?.length) continue;
  labels.set(String(m.fid), `${m.p1} v ${m.p2}`);
  const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
  const windowStart = firstOdds - 5 * 60_000;
  const push = (rec, kind) => { if (rec.Ts >= windowStart) events.push({ offset: rec.Ts - firstOdds, kind, rec }); };
  for (const o of m.odds) push(o, "odds");
  for (const s of m.scores) push(s, "scores");
}
events.sort((a, b) => a.offset - b.offset);
const span = events[events.length - 1].offset;
const loopLen = span + 90_000;
const t0wall = Date.now();
const t0virtual = Date.now();
let i = 0, loop = 0;
const feedIv = setInterval(() => {
  const matchElapsed = (Date.now() - t0wall) * SPEED;
  let guard = 0;
  for (;;) {
    if (i >= events.length) { i = 0; loop += 1; }
    const e = events[i];
    const absOffset = loop * loopLen + e.offset;
    if (absOffset > matchElapsed) break;
    const rec = { ...e.rec, Ts: t0virtual + absOffset };
    if (e.kind === "odds") engine.ingestOdds(rec);
    else engine.ingestScores(rec);
    i += 1;
    if (++guard > 4000) break;
  }
}, 200);
const markIv = setInterval(markAll, 2_500);

// ---- run, then dump ---------------------------------------------------------
const RUN_MS = Number(process.env.GEN_RUN_MS) || 90_000;
setInterval(() => {
  const all = AGENTS.flatMap((a) => a.positions);
  const settled = all.filter((p) => p.status === "settled").length;
  process.stderr.write(`  ${Math.round((Date.now() - t0wall) / 1000)}s · positions ${all.length} · settled ${settled}\n`);
}, 5_000);

setTimeout(() => {
  clearInterval(feedIv);
  clearInterval(markIv);
  const all = AGENTS.flatMap((a) =>
    a.positions.map((p) => ({
      agent: p.agent, source: p.source, kind: p.kind, fixtureId: p.fixtureId, superOddsType: p.superOddsType,
      marketParameters: p.marketParameters, sideIndex: p.sideIndex, entryProb: p.entryProb, side: p.side,
      direction: p.direction, odds: p.odds, stake: p.stake, proofHash: p.proofHash,
      exitProb: p.exitProb, exitOdds: p.exitOdds, exitTs: p.exitTs, exitProofHash: p.exitProofHash,
      status: p.status, clvReturn: p.clvReturn, pnl: p.pnl,
    })),
  );
  // Prefer settled rows (they carry the exit leg); pad with open to fill the file.
  const settled = all.filter((r) => r.status === "settled");
  const open = all.filter((r) => r.status !== "settled");
  const out = [...settled, ...open].slice(0, 300);
  writeFileSync(join(root, "lib/exec-ledger.json"), JSON.stringify(out));
  process.stderr.write(`\nWROTE ${out.length} rows (${settled.length} settled w/ exit leg) → lib/exec-ledger.json\n`);
  process.exit(0);
}, RUN_MS);
