// BROWSER → foil Supabase (anon, read-only mirror + control queue).
//
// When the EC2 worker is live it mirrors the runner into Supabase; the desk
// reads that here directly (no Vercel function in the data path → near-zero
// Hobby usage). If the env vars are absent, every function no-ops and the desk
// falls back to the in-app SSE replay — so this is safe to ship without keys.

import { labelForFid, relabelMatch } from "./fixture-names";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SESSION = process.env.NEXT_PUBLIC_DESK_SESSION || "live";
const FRESH_MS = 30_000; // mirror older than this ⇒ treat EC2 as offline

export const remoteConfigured = !!(URL && ANON);

function headers(): HeadersInit {
  return { apikey: ANON as string, Authorization: `Bearer ${ANON}` };
}

export interface RemoteAgent {
  id: string;
  name: string;
  title: string;
  edgeKinds: string[];
  status: "running" | "paused" | "stopped";
  bankroll: number;
  startBankroll: number;
  dayPnl: number;
  bets: number;
  wins: number;
  losses: number;
  openPositions: number;
  unrealized: number;
}

export interface RemoteTrade {
  ts: number;
  agentId: string;
  agent: string;
  kind: string;
  match: string;
  side: string;
  direction: string;
  odds: number;
  stake: number;
  proofHash: string;
  status: string;
  clvReturn: number;
  pnl: number;
  // Closing leg — the market's last real quote before it stopped trading, and its
  // frame fingerprint. Null while the call is still open.
  exitOdds: number | null;
  exitProb: number | null;
  exitTs: number | null;
  exitProofHash: string | null;
}

export interface RemoteProvenance {
  fid: string;
  label: string;
  oddsFrames: number;
  scoreFrames: number;
  ingested: number;
}

export interface RemoteSnapshot {
  fresh: boolean;
  mode: string;
  status: string;
  totalIngested: number;
  tradeCount: number;
  proof?: unknown;
  provenance: RemoteProvenance[];
  agents: RemoteAgent[];
  trades: RemoteTrade[];
}

async function get(path: string): Promise<unknown[]> {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

// Returns the mirror, or null when unconfigured/unreachable. `fresh` is false
// when the worker hasn't pushed within FRESH_MS (EC2 down → caller uses SSE).
export async function fetchRemoteSnapshot(): Promise<RemoteSnapshot | null> {
  if (!remoteConfigured) return null;
  try {
    const [metaRows, agentRows, tradeRows] = await Promise.all([
      get(`desk_meta?id=eq.${SESSION}&select=*`),
      get(`desk_agents?session=eq.${SESSION}&select=*&order=name.asc`),
      get(`desk_trades?session=eq.${SESSION}&select=*&order=ts.desc&limit=300`),
    ]);
    const meta = (metaRows as Record<string, unknown>[])[0];
    if (!meta) return null;
    const updated = Date.parse(String(meta.updated_at));
    const fresh = Number.isFinite(updated) && Date.now() - updated < FRESH_MS;

    const agents: RemoteAgent[] = (agentRows as Record<string, unknown>[]).map((a) => ({
      id: String(a.id),
      name: String(a.name),
      title: String(a.title),
      edgeKinds: (a.edge_kinds as string[]) ?? [],
      status: a.status as RemoteAgent["status"],
      bankroll: Number(a.bankroll),
      startBankroll: Number(a.start_bankroll),
      dayPnl: Number(a.day_pnl),
      bets: Number(a.bets),
      wins: Number(a.wins),
      losses: Number(a.losses),
      openPositions: Number(a.open_positions),
      unrealized: Number(a.unrealized),
    }));
    const trades: RemoteTrade[] = (tradeRows as Record<string, unknown>[]).map((t) => ({
      ts: Number(t.ts),
      agentId: String(t.agent_id),
      agent: String(t.agent),
      kind: String(t.kind),
      match: relabelMatch(String(t.match)), // "#fid · market" -> "Team v Team · market"
      side: String(t.side),
      direction: String(t.direction),
      odds: Number(t.odds),
      stake: Number(t.stake),
      proofHash: String(t.proof_hash),
      status: String(t.status),
      clvReturn: Number(t.clv_return),
      pnl: Number(t.pnl),
      exitOdds: t.exit_odds != null ? Number(t.exit_odds) : null,
      exitProb: t.exit_prob != null ? Number(t.exit_prob) : null,
      exitTs: t.exit_ts != null ? Number(t.exit_ts) : null,
      exitProofHash: t.exit_proof_hash != null ? String(t.exit_proof_hash) : null,
    }));

    // The live feed stored bare "#fid" labels — resolve them to team names here.
    const provenance: RemoteProvenance[] = (Array.isArray(meta.provenance) ? meta.provenance : []).map(
      (p: Record<string, unknown>) => ({
        fid: String(p.fid),
        label: labelForFid(String(p.fid)),
        oddsFrames: Number(p.oddsFrames ?? 0),
        scoreFrames: Number(p.scoreFrames ?? 0),
        ingested: Number(p.ingested ?? 0),
      }),
    );

    return {
      fresh,
      mode: String(meta.mode ?? "live"),
      status: String(meta.status ?? ""),
      totalIngested: Number(meta.total_ingested ?? 0),
      tradeCount: Number(meta.trade_count ?? trades.length),
      proof: meta.proof,
      provenance,
      agents,
      trades,
    };
  } catch {
    return null;
  }
}

export interface DeskHealth {
  updatedAt: number; // ms epoch of the worker's last push
  totalIngested: number;
  tradeCount: number;
  stalls: number;
  mode: string;
  status: string;
  agentsTotal: number;
  agentsRunning: number;
}

// Raw health read for the /desk/health page: the worker's last push + agent
// counts. Returns null when unconfigured/unreachable or no meta row exists yet.
export async function fetchDeskHealth(): Promise<DeskHealth | null> {
  if (!remoteConfigured) return null;
  try {
    const [metaRows, agentRows] = await Promise.all([
      get(`desk_meta?id=eq.${SESSION}&select=*`),
      get(`desk_agents?session=eq.${SESSION}&select=id,status`),
    ]);
    const m = (metaRows as Record<string, unknown>[])[0];
    if (!m) return null;
    const agents = agentRows as Record<string, unknown>[];
    const updated = Date.parse(String(m.updated_at));
    return {
      updatedAt: Number.isFinite(updated) ? updated : 0,
      totalIngested: Number(m.total_ingested ?? 0),
      tradeCount: Number(m.trade_count ?? 0),
      stalls: Number(m.stalls ?? 0),
      mode: String(m.mode ?? ""),
      status: String(m.status ?? ""),
      agentsTotal: agents.length,
      agentsRunning: agents.filter((a) => a.status === "running").length,
    };
  } catch {
    return null;
  }
}

// Queue a pause/stop/resume the EC2 worker will pick up within a few seconds.
export async function sendRemoteControl(agentId: string, op: "pause" | "resume" | "stop"): Promise<boolean> {
  if (!remoteConfigured) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/desk_controls`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ session: SESSION, agent_id: agentId, op }]),
    });
    return res.ok;
  } catch {
    return false;
  }
}
