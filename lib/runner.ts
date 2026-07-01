// AGENT RUNNER — the autonomous loop (Track C's "no human in the loop").
//
// On every engine edge, each running agent's policy decides independently and,
// if it acts on the edge, the runner records a conviction-weighted call and
// opens a position. A mark loop revalues open calls with a live provisional CLV
// and SETTLES each at its market's close — the last real quote before the market
// stops trading (kickoff for a pre-match market; suspension / FT in-play),
// detected as the market going quiet. So the final grade is a true entry-quote →
// closing-quote CLV, exactly what "beat the close" means. Nothing here waits on a
// human; the UI only observes. (Stake/bankroll are retained internally to drive
// CLV but are never surfaced — the product speaks in mispricings and CLV, not
// dollars.)

import { EventEmitter } from "node:events";
import { getFeed, type FeedHandle } from "./feed";
import { decide, markPosition, type Agent, type Position } from "./agent";
import { getPaper, buildStrategies, DEFAULT_BASE_LEVERS, type AgentLevers } from "./papers";
import type { EdgeKind } from "./edge/types";
import { getProof } from "./proof";
import { edgeProofHash, markProofHash } from "./frame-proof.mjs";
import type { Edge } from "./edge/types";

const START_BANKROLL = 350; // universal — every agent starts equal

// A forecast is graded on the CLOSING line: the market's last real quote before
// it stops trading. We detect "closed" as the market going QUIET — no new quote
// for CLOSE_QUIET_MS of WALL time (frame timestamps ride an accelerated virtual
// clock in replay, so only wall-time silence is a valid quiet measure). Until it
// closes, the position stays open and carries a live provisional mark.
const CLOSE_QUIET_SYNTH = 6_000;
const CLOSE_QUIET_REPLAY = 2_500; // dense ~ms quotes stay open; the kickoff gap closes them
const CLOSE_QUIET_LIVE = 60_000; // in-play books re-quote often; only a real suspension/FT is this quiet
// Synth markets quote forever (there is no kickoff), so nothing would ever close.
// Settle illustrative synth positions after this cap. Never used for real data.
const SYNTH_MAX_OPEN_MS = 15_000;
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
  private closeQuietMs: number;
  private seq = 0;

  constructor() {
    super();
    this.feed = getFeed();
    this.closeQuietMs =
      this.feed.mode === "synth" ? CLOSE_QUIET_SYNTH : this.feed.mode === "replay" ? CLOSE_QUIET_REPLAY : CLOSE_QUIET_LIVE;

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
  // a position is verifiably tied to ingested data. Shared with the operator API
  // (lib/frame-proof) so a trade and a published edge hash identically.
  private proofHash(edge: Edge): string {
    return edgeProofHash(edge);
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
      // Timestamp of the real frame the entry price came from. The settle loop
      // requires a frame strictly LATER than this before it will close, so the
      // exit is always a distinct, real, post-entry observation.
      const entryFrame = this.feed.engine.markFrameForMarket(edge.market);
      const entryTs = entryFrame?.ts ?? now;
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
        entryTs,
        stake: res.accepted,
        proofHash: this.proofHash(edge),
        openedAt: now,
        lastQuoteWall: now,
        markProb: d.entryProb!,
        markTs: entryTs,
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
        text: `${agent.name} flagged ${pos.side} mispriced @ ${pos.entryOdds.toFixed(2)} on ${pos.matchLabel} (${edge.kind}·${edge.conviction}) · frame ${pos.proofHash}`,
      });
    }
  }

  // ---- mark + settle at the CLOSE ---------------------------------------
  private markAll() {
    const now = Date.now();
    const synth = this.feed.mode === "synth";
    for (const agent of this.agents.values()) {
      for (const pos of agent.positions) {
        if (pos.status !== "open") continue;

        // Latest REAL ingested frame for this market. We only ever mark or settle
        // against a real TxLINE frame observed strictly AFTER entry — never invent
        // or carry forward a price — so both legs are real, distinct observations.
        const frame = this.feed.engine.markFrameForMarket(pos.market);
        if (!frame) continue;

        // The market re-quoted since we last looked → refresh the live provisional
        // mark and reset the quiet clock. It is still trading, so it has NOT closed.
        if (frame.ts > pos.markTs) {
          if (frame.ts > pos.entryTs) {
            const { clvReturn, pnl } = markPosition(pos, frame.prob);
            pos.markProb = frame.prob;
            pos.clvReturn = clvReturn;
            pos.pnl = pnl;
          }
          pos.markTs = frame.ts;
          pos.lastQuoteWall = now;
          continue;
        }

        // No new quote since last check. Once the market has been quiet long enough
        // it has CLOSED (kickoff / suspension / FT), so its last real quote IS the
        // closing line — settle the forecast on it. (Synth quotes forever, so an
        // illustrative backstop closes those positions; never triggers on real data
        // that reaches a genuine close first.)
        const quiet = now - pos.lastQuoteWall >= this.closeQuietMs;
        const backstop = synth && now - pos.openedAt >= SYNTH_MAX_OPEN_MS;
        if ((quiet || backstop) && pos.markTs > pos.entryTs) {
          // Exit leg = the closing line, fingerprinted like the entry so it
          // reconciles against the real TxLINE frame exactly.
          pos.exitProb = frame.prob;
          pos.exitOdds = Math.round((1 / frame.prob) * 1000) / 1000;
          pos.exitTs = frame.ts;
          pos.exitProofHash = markProofHash(pos.market, frame.prob, pos.kind);
          pos.status = "settled";
          agent.bankroll = Math.round((agent.bankroll + pos.pnl) * 100) / 100;
          agent.dayPnl = Math.round((agent.dayPnl + pos.pnl) * 100) / 100;
          if (pos.pnl >= 0) agent.wins += 1;
          else agent.losses += 1;
          this.push({
            type: "settle",
            ts: now,
            agentId: agent.id,
            agentName: agent.name,
            pnl: pos.pnl,
            text: `${agent.name} graded ${pos.side} at close — ${pos.entryOdds.toFixed(2)}→${pos.exitOdds.toFixed(2)} · CLV ${(pos.clvReturn * 100).toFixed(1)}%`,
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
          // Frame identity — ties this bet to the exact real TxLINE market it was
          // taken on (joins to the captured-frame ledger for verification).
          fixtureId: p.market.fixtureId,
          superOddsType: p.market.superOddsType,
          marketParameters: p.market.marketParameters,
          sideIndex: p.market.sideIndex,
          entryProb: p.entryProb,
          side: p.side,
          direction: p.direction,
          odds: p.entryOdds,
          stake: p.stake,
          proofHash: p.proofHash,
          // Exit leg — present once settled, also fingerprinted to a real frame so
          // the closing price reconciles against TxLINE exactly like the entry.
          exitProb: p.exitProb ?? null,
          exitOdds: p.exitOdds ?? null,
          exitTs: p.exitTs ?? null,
          exitProofHash: p.exitProofHash ?? null,
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
