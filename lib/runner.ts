// AGENT RUNNER — the autonomous loop (Track C's "no human in the loop").
//
// On every engine edge, each running agent's policy decides independently and,
// if it takes the edge, the runner stakes fake-USD and opens a position. A mark
// loop revalues open positions on closing-line value and settles them after a
// hold horizon. Nothing here waits on a human; the UI only observes.

import { EventEmitter } from "node:events";
import { getFeed, type FeedHandle } from "./feed";
import { decide, markPosition, type Agent, type Position } from "./agent";
import { getPaper, buildStrategies, DEFAULT_BASE_LEVERS, type AgentLevers } from "./papers";
import type { EdgeKind } from "./edge/types";
import { getProof } from "./proof";
import type { Edge } from "./edge/types";

const START_BANKROLL = 350; // universal — every agent starts equal
const HOLD_MS_SYNTH = 12_000;
const HOLD_MS_LIVE = 90_000;
const HOLD_MS_REPLAY = 10_000; // wall: ~5 match-min of CLV horizon at 30× replay
const MARK_MS = 2_500;

export interface RunnerActivity {
  type: "trade" | "settle" | "matchEvent";
  ts: number;
  agentId?: string;
  agentName?: string;
  text: string;
  pnl?: number;
}

class AgentRunner extends EventEmitter {
  agents = new Map<string, Agent>();
  private feed: FeedHandle;
  private holdMs: number;
  private seq = 0;

  constructor() {
    super();
    this.feed = getFeed();
    this.holdMs =
      this.feed.mode === "synth" ? HOLD_MS_SYNTH : this.feed.mode === "replay" ? HOLD_MS_REPLAY : HOLD_MS_LIVE;

    this.feed.engine.on("edge", (e) => this.onEdge(e));
    this.feed.engine.on("matchEvent", (m) =>
      this.push({ type: "matchEvent", ts: Date.now(), text: `${this.label(m.fixtureId)} — ${m.label}` }),
    );

    const t = setInterval(() => this.markAll(), MARK_MS);
    t.unref?.();

    this.seedDemoAgents();
  }

  private label(fixtureId: string | number): string {
    return this.feed.labels.get(String(fixtureId)) || `#${fixtureId}`;
  }

  // Deterministic fingerprint of the real TxLINE frame a trade was taken on, so
  // a position is verifiably tied to ingested data (FNV-1a, 8 hex chars).
  private proofHash(edge: Edge): string {
    const s = `${edge.market.fixtureId}|${edge.market.superOddsType}|${edge.market.marketParameters}|${edge.market.side}|${edge.fairProb.toFixed(4)}|${edge.kind}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  private push(a: RunnerActivity) {
    this.emit("activity", a);
  }

  // ---- agent lifecycle --------------------------------------------------
  // An agent = an always-on base tuning PLUS any attached papers. With no papers
  // it trades the baseline "quote" signal on the live book; each paper adds a
  // calibrated steam / overreaction strategy on top.
  createAgent(
    name: string,
    opts: { paperIds?: string[]; baseLevers?: AgentLevers } = {},
  ): Agent | null {
    const paperIds = (opts.paperIds || []).filter((pid) => !!getPaper(pid));
    const baseLevers = opts.baseLevers || DEFAULT_BASE_LEVERS;
    const strategies = buildStrategies(baseLevers, paperIds);
    if (!strategies.length) return null;

    const edgeKinds = [...new Set(strategies.flatMap((s) => s.edgeKinds))] as EdgeKind[];
    const title = paperIds.length
      ? `Base + ${paperIds.length} paper${paperIds.length > 1 ? "s" : ""}`
      : "Base tuning";

    const id = `agent_${++this.seq}`;
    const agent: Agent = {
      id,
      name,
      papers: paperIds,
      baseLevers,
      strategies,
      title,
      edgeKinds,
      status: "running",
      startBankroll: START_BANKROLL,
      bankroll: START_BANKROLL,
      dayPnl: 0,
      bets: 0,
      wins: 0,
      losses: 0,
      positions: [],
      createdAt: Date.now(),
    };
    this.agents.set(id, agent);
    return agent;
  }

  control(id: string, action: "pause" | "resume" | "stop"): boolean {
    const a = this.agents.get(id);
    if (!a) return false;
    a.status = action === "pause" ? "paused" : action === "resume" ? "running" : "stopped";
    return true;
  }

  // ---- the autonomous decision on each edge -----------------------------
  private onEdge(edge: Edge) {
    for (const agent of this.agents.values()) {
      if (agent.status !== "running") continue;
      const openCount = agent.positions.filter((p) => p.status === "open").length;
      const minute = this.feed.engine.matchMinute(edge.market.fixtureId);
      const d = decide(agent, edge, { minute, openCount });
      if (!d.take || d.stake == null) continue;

      const res = this.feed.engine.stake(edge.id, d.stake);
      if (!res.ok || !res.accepted) continue;

      const now = Date.now();
      const pos: Position = {
        id: `pos_${++this.seq}`,
        agentId: agent.id,
        edgeId: edge.id,
        source: d.source || "base tuning",
        paperId: d.paperId ?? null,
        kind: edge.kind,
        market: edge.market,
        matchLabel: `${this.label(edge.market.fixtureId)} · ${edge.market.superOddsType} ${edge.market.marketParameters}`,
        side: d.side!,
        direction: d.direction!,
        entryProb: d.entryProb!,
        entryOdds: d.entryOdds!,
        stake: res.accepted,
        proofHash: this.proofHash(edge),
        openedAt: now,
        holdUntil: now + this.holdMs,
        markProb: d.entryProb!,
        clvReturn: 0,
        pnl: 0,
        status: "open",
      };
      agent.positions.push(pos);
      agent.bets += 1;
      this.push({
        type: "trade",
        ts: now,
        agentId: agent.id,
        agentName: agent.name,
        text: `${agent.name} → ${pos.direction.toUpperCase()} ${pos.side} @ ${pos.entryOdds.toFixed(2)} on ${pos.matchLabel} ($${pos.stake.toFixed(0)}, ${edge.kind}·${edge.conviction}) · frame ${pos.proofHash}`,
      });
    }
  }

  // ---- mark + settle ----------------------------------------------------
  private markAll() {
    const now = Date.now();
    for (const agent of this.agents.values()) {
      for (const pos of agent.positions) {
        if (pos.status !== "open") continue;
        const cur = this.feed.engine.fairProbForMarket(pos.market) ?? pos.markProb;
        const { clvReturn, pnl } = markPosition(pos, cur);
        pos.markProb = cur;
        pos.clvReturn = clvReturn;
        pos.pnl = pnl;
        if (now >= pos.holdUntil) {
          pos.status = "settled";
          agent.bankroll = Math.round((agent.bankroll + pnl) * 100) / 100;
          agent.dayPnl = Math.round((agent.dayPnl + pnl) * 100) / 100;
          if (pnl >= 0) agent.wins += 1;
          else agent.losses += 1;
          this.push({
            type: "settle",
            ts: now,
            agentId: agent.id,
            agentName: agent.name,
            pnl,
            text: `${agent.name} settled ${pos.side} ${pos.direction} — CLV ${(clvReturn * 100).toFixed(1)}% → ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
          });
        }
      }
    }
  }

  // ---- demo agents so the desk shows autonomous trading immediately -----
  // Each carries the always-on base (quote) tuning; the latter three add a paper.
  // Base tuning is varied per agent so they diverge from the first trade rather
  // than moving in lockstep on the shared baseline signal.
  private seedDemoAgents() {
    if (this.agents.size) return;
    const base = (over: Partial<AgentLevers>): AgentLevers => ({ ...DEFAULT_BASE_LEVERS, ...over });
    // base only — trades the live book continuously
    this.createAgent("Market Pulse", { baseLevers: base({ stakePct: 0.04, maxConcurrent: 4 }) });
    this.createAgent("The Closer", { paperIds: ["steam-base"], baseLevers: base({ stakePct: 0.05 }) });
    this.createAgent("Mean Reverter", { paperIds: ["overreaction-base"], baseLevers: base({ stakePct: 0.06, direction: "fade" }) });
    this.createAgent("The Cynic", { paperIds: ["overreaction-redcard"], baseLevers: base({ stakePct: 0.03, maxConcurrent: 2 }) });
  }

  // ---- serializable state for the API -----------------------------------
  snapshot() {
    const provenance = [...this.feed.provenance.values()];
    const totalIngested = provenance.reduce((s, p) => s + p.ingested, 0);
    const agents = [...this.agents.values()];

    // Flat trade ledger across every agent — each row carries the proofHash that
    // ties the bet to the exact real TxLINE frame it was taken on. Newest first.
    const trades = agents
      .flatMap((a) =>
        a.positions.map((p) => ({
          ts: p.openedAt,
          agentId: a.id,
          agent: a.name,
          source: p.source,
          kind: p.kind,
          match: p.matchLabel,
          side: p.side,
          direction: p.direction,
          odds: p.entryOdds,
          stake: p.stake,
          proofHash: p.proofHash,
          status: p.status,
          clvReturn: p.clvReturn,
          pnl: p.pnl,
        })),
      )
      .sort((x, y) => y.ts - x.ts)
      .slice(0, 300);

    return {
      mode: this.feed.mode,
      status: this.feed.status,
      proof: getProof(),
      // Provenance: which REAL matches are loaded and how many frames the engine
      // has ingested from each — the "we ingested this data" half of the proof.
      provenance,
      totalIngested,
      tradeCount: agents.reduce((s, a) => s + a.bets, 0),
      trades,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        title: a.title,
        papers: a.papers,
        edgeKinds: a.edgeKinds,
        status: a.status,
        startBankroll: a.startBankroll,
        bankroll: a.bankroll,
        dayPnl: a.dayPnl,
        bets: a.bets,
        wins: a.wins,
        losses: a.losses,
        createdAt: a.createdAt,
        openPositions: a.positions.filter((p) => p.status === "open").length,
        unrealized:
          Math.round(a.positions.filter((p) => p.status === "open").reduce((s, p) => s + p.pnl, 0) * 100) / 100,
      })),
    };
  }
}

const KEY = "__agenthesis_runner__";

export function getRunner(): AgentRunner {
  const g = globalThis as unknown as Record<string, AgentRunner | undefined>;
  if (!g[KEY]) g[KEY] = new AgentRunner();
  return g[KEY]!;
}

export type { AgentRunner };
