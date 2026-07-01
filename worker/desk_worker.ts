// EC2 LIVE DESK WORKER
//
// Runs the SAME runner/engine/agents as the web app, but on a durable always-on
// box fed by the live TxLINE SSE. Trades happen in real time here; every PUSH_MS
// we push a delta (agents + recent trades + meta) to Supabase, and the Vercel
// /desk reads that directly. Pause/stop intents queued by the browser into
// desk_controls are polled and applied here, so the buttons reach the real
// runner even though it lives off Vercel.
//
// Run:  FEED_MODE=live tsx worker/desk_worker.ts
// Env:  TXLINE_API_BASE / TXLINE_JWT / TXLINE_API_TOKEN  (live feed)
//       SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY          (push sink)
//       PUSH_MS (15000) CONTROL_MS (4000) DESK_SESSION (live)

if (!process.env.FEED_MODE) process.env.FEED_MODE = "live";

import { getRunner } from "../lib/runner";
import { upsert, select, del } from "./supabase.mjs";

const PUSH_MS = Number(process.env.PUSH_MS) || 15_000;
const CONTROL_MS = Number(process.env.CONTROL_MS) || 4_000;
const SESSION = process.env.DESK_SESSION || "live";
const nowIso = () => new Date().toISOString();
const log = (...a: unknown[]) => console.log(nowIso(), ...a);

const runner = getRunner();
log(`desk_worker up — push=${PUSH_MS}ms control=${CONTROL_MS}ms session=${SESSION}`);

// ---- push loop: mirror runner state into Supabase ----------------------
// Stall tracking doubles as the post-match assessment log: if total ingested
// frames don't advance between cycles the live SSE has gone quiet (a drop or a
// genuinely idle feed) — every transition is logged with a timestamp so we can
// reconstruct exactly what the worker saw and "what happened after it dropped".
let lastIngested = -1;
let stalls = 0;

async function push(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = runner.snapshot() as any;

  const stamp = nowIso();
  const agents = snap.agents.map((a: any) => ({
    id: a.id,
    session: SESSION,
    name: a.name,
    title: a.title,
    edge_kinds: a.edgeKinds,
    status: a.status,
    bankroll: a.bankroll,
    start_bankroll: a.startBankroll,
    day_pnl: a.dayPnl,
    bets: a.bets,
    wins: a.wins,
    losses: a.losses,
    open_positions: a.openPositions,
    unrealized: a.unrealized,
    updated_at: stamp,
  }));

  // Stable id ties a row to the exact frame+open-time so re-pushes upsert in
  // place (status/pnl evolve from open → settled) rather than duplicating.
  const trades = (snap.trades || []).slice(0, 200).map((t: any) => ({
    id: `${t.agentId}:${t.proofHash}:${t.ts}`,
    session: SESSION,
    ts: t.ts,
    agent_id: t.agentId,
    agent: t.agent,
    kind: t.kind,
    match: t.match,
    side: t.side,
    direction: t.direction,
    odds: t.odds,
    stake: t.stake,
    proof_hash: t.proofHash,
    status: t.status,
    clv_return: t.clvReturn,
    pnl: t.pnl,
    // Closing leg — carried through so /proof + /desk can show and verify the
    // entry-quote → closing-quote pair. Null until the position settles.
    exit_odds: t.exitOdds ?? null,
    exit_prob: t.exitProb ?? null,
    exit_ts: t.exitTs ?? null,
    exit_proof_hash: t.exitProofHash ?? null,
  }));

  const ingested = snap.totalIngested || 0;
  if (ingested === lastIngested) {
    stalls += 1;
    log(`STALL #${stalls}: feed quiet — ingested frozen at ${ingested}`);
  } else {
    if (stalls) log(`feed recovered after ${stalls} stall cycle(s) — ingested ${lastIngested} → ${ingested}`);
    stalls = 0;
  }
  lastIngested = ingested;

  const meta = [
    {
      id: SESSION,
      mode: snap.mode,
      status: snap.status,
      total_ingested: ingested,
      trade_count: snap.tradeCount,
      provenance: snap.provenance,
      proof: snap.proof,
      source: "ec2-live",
      stalls,
      updated_at: stamp,
    },
  ];

  try {
    await upsert("desk_agents", agents);
    if (trades.length) await upsert("desk_trades", trades);
    await upsert("desk_meta", meta);
    log(`pushed ${agents.length} agents / ${trades.length} trades · ingested=${ingested} trades=${snap.tradeCount} mode=${snap.mode}`);
  } catch (e) {
    log("push error:", (e as Error).message);
  }
}

// ---- control loop: browser → desk_controls → runner --------------------
async function controls(): Promise<void> {
  try {
    const rows = (await select("desk_controls", `session=eq.${SESSION}&select=*`)) as Array<{
      id: number;
      agent_id: string;
      op: "pause" | "resume" | "stop";
    }>;
    if (!rows.length) return;
    const done: number[] = [];
    for (const r of rows) {
      const ok = runner.control(r.agent_id, r.op);
      log(`control ${r.op} ${r.agent_id} → ${ok}`);
      done.push(r.id);
    }
    await del("desk_controls", `id=in.(${done.join(",")})`);
  } catch (e) {
    log("control error:", (e as Error).message);
  }
}

setInterval(push, PUSH_MS);
setInterval(controls, CONTROL_MS);
void push();

process.on("SIGINT", () => {
  log("SIGINT — exiting");
  process.exit(0);
});
