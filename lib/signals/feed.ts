// CANONICAL TRADER SIGNAL SCHEMA + FEED HELPERS.
//
// One shape for a divergence signal, shared by every surface: the /api/v1 endpoints, the paper-trading
// terminal, the npx CLI, and the Telegram bot. A signal is a moment a prediction market lagged TxLINE's
// vig-free fair, so the cheap side is underpriced. The trade is: take the cheap side at `entry`, take
// profit at `tpTarget` (= fair), sized by Kelly on the gap. Everything here is signal-only; no order is
// ever placed.

import { getPickoffs, getLiveEdge, getLiveStream } from "@/lib/pickoff-source";
import type { PickoffLedger, PickoffMatch, DivergenceEntry, LiveSignal } from "@/lib/pickoff-source";

export interface Signal {
  fid: string;          // TxLINE fixture id (the market key; token-id mapping comes in a later phase)
  teams: string;        // "A v B"
  side: "yes" | "no";   // the cheap side to buy
  entry: number;        // price paid on that side (side frame, 0..1)
  fair: number;         // TxLINE de-vig fair for that side (the take-profit target)
  tpTarget: number;     // == fair; where the paper trade exits on convergence
  gapPp: number;        // how far below fair the entry sits, in probability points (>= 0)
  suggestedKellyF: number; // Kelly fraction of bankroll: gap/(1-entry), clamped [0,1]
  sizeAtFair: number;   // $ exit liquidity available at/through fair (0 if it never reached)
  ts: number;           // unix seconds of the entry
  reached?: boolean;    // replay only: did the market travel to fair before FT
  tx?: string;          // replay only: a Polygon fill tx that settled it (verifiable)
}

// Kelly fraction on the gap: f = gap / (1 - entry), clamped to [0,1]. `fair` and `entry` are in the
// SAME side frame (both the bought side's probability), so gap = fair - entry.
export function kellyFraction(fair: number, entry: number): number {
  const gap = fair - entry;
  if (gap <= 0 || entry >= 1) return 0;
  return Math.min(1, Math.max(0, gap / (1 - entry)));
}

// A settled-match divergence entry -> canonical Signal (replay mode). Entry/fair are already stored in
// the bought side's frame by the pipeline, so no reframing here.
export function entryToSignal(m: PickoffMatch, e: DivergenceEntry): Signal {
  return {
    fid: String(m.fid),
    teams: m.teams,
    side: e.side,
    entry: e.entry,
    fair: e.fair,
    tpTarget: e.fair,
    gapPp: Math.round(e.gap * 100 * 10) / 10,
    suggestedKellyF: kellyFraction(e.fair, e.entry),
    sizeAtFair: e.usd,
    ts: e.t,
    reached: e.reached,
    tx: e.fills?.[0]?.tx,
  };
}

// A live detector signal -> canonical Signal (live mode). Put entry/fair in the bought side's frame.
export function liveToSignal(s: LiveSignal): Signal {
  const entry = s.side === "yes" ? s.pm : 1 - s.pm;
  const fair = s.side === "yes" ? s.fair : 1 - s.fair;
  return {
    fid: String(s.fid),
    teams: s.teams,
    side: s.side,
    entry,
    fair,
    tpTarget: fair,
    gapPp: Math.abs(Math.round(s.gapPp * 10) / 10),
    suggestedKellyF: kellyFraction(fair, entry),
    sizeAtFair: 0, // live: exit liquidity is only known after convergence
    ts: s.ts,
  };
}

// Fair passthrough (D1: we hold the TxLINE token). Current de-vig fair per live fixture, from the box's
// live-stream blob. Returns [] when no match is live.
export interface FairQuote { fid: string; teams: string; fair: number; ts: number }

interface StreamFixture { fid?: string | number; teams?: string; txline?: [number, number][] }

export async function getFairSnapshot(): Promise<{ generatedAt: number; live: boolean; fixtures: FairQuote[] }> {
  const blob = await getLiveStream();
  const now = Date.now();
  const FRESH_MS = 10 * 60 * 1000;
  const fixtures: FairQuote[] = [];
  for (const raw of (blob.fixtures ?? []) as StreamFixture[]) {
    const tx = raw.txline ?? [];
    const last = tx[tx.length - 1];
    if (!raw.fid || !last) continue;
    const ts = last[0];
    if (now - ts > FRESH_MS) continue; // stale fixture, not live
    fixtures.push({ fid: String(raw.fid), teams: raw.teams ?? "", fair: last[1], ts });
  }
  return { generatedAt: now, live: fixtures.length > 0, fixtures };
}

// Live signal feed, gated (D2/task 5): only returns signals while a match is in play.
export async function getLiveSignals(): Promise<{ generatedAt: number; live: boolean; signals: Signal[] }> {
  const live = await getLiveEdge();
  const diverged = (live?.signals ?? []).filter((s) => s.diverged);
  const isLive = (live?.liveCount ?? 0) > 0;
  return {
    generatedAt: live?.generatedAt ?? Date.now(),
    live: isLive,
    signals: isLive ? diverged.map(liveToSignal) : [],
  };
}

// Replay signals for one settled match at a theta ("5" | "10").
export function getReplaySignals(led: PickoffLedger | null, fid: string, theta: "5" | "10" = "5"): Signal[] {
  const m = led?.matches.find((x) => String(x.fid) === fid);
  if (!m) return [];
  return (m.divergences?.[theta] ?? []).map((e) => entryToSignal(m, e));
}

export { getPickoffs };
