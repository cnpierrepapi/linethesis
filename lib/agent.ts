// AGENT — typed surface over the pure decision core (agent-core.mjs).
//
// The math lives in agent-core.mjs (plain JS, deterministic, unit-tested). This
// file holds the TypeScript shapes and thin typed wrappers so the runner and UI
// stay fully typed while the logic stays testable in isolation.

import type { Edge, EdgeDirection, EdgeMarketMeta, EdgeKind } from "./edge/types";
import type { AgentLevers, Strategy } from "./papers";
import { decide as decideCore, markPosition as markCore } from "./agent-core.mjs";

export type AgentStatus = "running" | "paused" | "stopped";
export type PositionStatus = "open" | "settled";

export interface Position {
  id: string;
  agentId: string;
  edgeId: string;
  source: string; // which strategy took it ("base tuning" or a paper title)
  paperId: string | null;
  kind: EdgeKind;
  market: EdgeMarketMeta;
  matchLabel: string;
  side: string;
  direction: EdgeDirection;
  entryProb: number;
  entryOdds: number;
  entryTs: number; // ts of the real TxLINE frame the entry price came from
  stake: number;
  proofHash: string; // fingerprint of the real TxLINE frame this trade was taken on
  openedAt: number;
  lastQuoteWall: number; // wall-clock of the market's last observed re-quote (drives close detection)
  markProb: number;
  markTs: number; // ts of the latest real frame the position is marked against
  // EXIT leg — set only at settlement, taken from the market's CLOSING line: its
  // last real quote before it stops trading (kickoff / suspension). Observed
  // strictly after entry (the position stays open until one exists), verifiable
  // like the entry leg.
  exitProb?: number;
  exitOdds?: number;
  exitTs?: number;
  exitProofHash?: string;
  clvReturn: number;
  pnl: number;
  status: PositionStatus;
}

export interface Agent {
  id: string;
  name: string;
  papers: string[]; // attached paper ids (0..n)
  baseLevers: AgentLevers; // the user-tuned, always-on base strategy
  strategies: Strategy[]; // resolved: base tuning + one per paper
  title: string; // display summary, e.g. "Base + 2 papers"
  edgeKinds: EdgeKind[]; // union of what it trades (display tags)
  status: AgentStatus;
  startBankroll: number;
  bankroll: number;
  dayPnl: number;
  bets: number;
  wins: number;
  losses: number;
  positions: Position[];
  createdAt: number;
}

export interface Decision {
  take: boolean;
  reason: string;
  source?: string;
  paperId?: string | null;
  side?: string;
  direction?: EdgeDirection;
  stake?: number;
  entryProb?: number;
  entryOdds?: number;
}

export interface DecideContext {
  minute: number | null;
  openCount: number;
}

export function decide(agent: Agent, edge: Edge, ctx: DecideContext): Decision {
  return decideCore(agent, edge, ctx) as Decision;
}

export function markPosition(pos: Position, currentProb: number): { clvReturn: number; pnl: number } {
  return markCore(pos, currentProb) as { clvReturn: number; pnl: number };
}
