// CANONICAL TRADER SIGNAL SCHEMA + FEED HELPERS.
//
// One shape for a divergence signal, shared by every surface: the /api/v1 endpoints, the paper-trading
// terminal, the npx CLI, and the Telegram bot. A signal is a moment a prediction market lagged TxLINE's
// vig-free fair, so the cheap side is underpriced. The trade is: take the cheap side at `entry`, take
// profit at `tpTarget` (= fair), sized by Kelly on the gap. Everything here is signal-only; no order is
// ever placed.

import { getPickoffs } from "@/lib/pickoff-source";
import type { PickoffLedger, PickoffMatch, DivergenceEntry } from "@/lib/pickoff-source";
import { entryMinute, KELLY_CAP } from "@/lib/signals/policy";

export interface Signal {
  fid: string;          // TxLINE fixture id (the market key; token-id mapping comes in a later phase)
  teams: string;        // "A v B"
  side: "yes" | "no";   // the cheap side to buy (yes = participant 2 / the second-named team, no = participant 1)
  team: string;         // the team whose side is cheap (a label, not an outcome bet: the edge is convergence to fair)
  entry: number;        // price paid on that side (side frame, 0..1)
  fair: number;         // TxLINE de-vig fair for that side (the take-profit target)
  tpTarget: number;     // == fair; where the paper trade exits on convergence
  gapPp: number;        // how far below fair the entry sits, in probability points (>= 0)
  suggestedKellyF: number; // Kelly fraction of bankroll: gap/(1-entry), capped at KELLY_CAP
  sizeAtFair: number;   // $ exit liquidity available at/through fair (0 if it never reached)
  ts: number;           // unix seconds of the entry
  minute?: number;      // match minute of the call (for display / late-NO policy)
  reached?: boolean;    // replay only: did the market travel to fair before FT
  clv?: number;         // replay only: closing-line value in prob (close - entry); marks out no-reach trades
  tx?: string;          // replay only: the exit fill's Polygon tx (back-compat; == exitFill.tx)
  entryFill?: { t: number; price: number; tx: string } | null; // replay: real on-chain fill at entry
  exitFill?: { t: number; price: number; tx: string; usd?: number; gapPp?: number } | null; // replay: real fill closest to fair (present iff reached)
}

// The team whose side is cheap: yes = the second-named team (participant 2), no = the first-named
// (participant 1). This is a label for WHICH price is underpriced, not a bet on who wins; the trade is
// the price converging to TxLINE fair, taken as profit before the match resolves.
export function sideTeam(teams: string, side: "yes" | "no"): string {
  const p = teams.split(/\s+v\s+/i);
  if (p.length !== 2) return teams;
  return (side === "yes" ? p[1] : p[0]).trim();
}

// Kelly fraction on the gap: f = gap / (1 - entry), CAPPED at KELLY_CAP (never stake more than that
// fraction on one call). `fair` and `entry` are in the SAME side frame (both the bought side's
// probability), so gap = fair - entry. This is the suggestedKellyF the CLI/bot/web terminal all size on.
export function kellyFraction(fair: number, entry: number): number {
  const gap = fair - entry;
  if (gap <= 0 || entry >= 1) return 0;
  return Math.min(KELLY_CAP, Math.max(0, gap / (1 - entry)));
}

// A settled-match divergence entry -> canonical Signal (replay mode). Entry/fair are already stored in
// the bought side's frame by the pipeline, so no reframing here.
export function entryToSignal(m: PickoffMatch, e: DivergenceEntry): Signal {
  // `e.entry` is the bought side's price, but `e.fair` is stored in the YES frame; for a NO bet those
  // are different frames, so the side-frame fair (the take-profit target) is entry + gap, where `e.gap`
  // is the abs side-frame edge. Using e.fair directly makes NO bets look like no-edge. Always derive the
  // side fair from the gap so entry, fair, and gap stay in one frame and reconcile with the box.
  const sideFair = e.entry + Math.abs(e.gap);
  return {
    fid: String(m.fid),
    teams: m.teams,
    side: e.side,
    team: sideTeam(m.teams, e.side),
    entry: e.entry,
    fair: sideFair,
    tpTarget: sideFair,
    gapPp: Math.round(Math.abs(e.gap) * 100 * 10) / 10,
    suggestedKellyF: kellyFraction(sideFair, e.entry),
    sizeAtFair: e.usd,
    ts: e.t,
    minute: entryMinute(m.kick, e.t) ?? undefined,
    reached: e.reached,
    clv: e.clv,
    entryFill: e.entryFill ?? null,
    exitFill: e.exitFill ?? null,
    tx: e.exitFill?.tx ?? e.fills?.[0]?.tx, // exit proof; closest-to-fair fill
  };
}

// Replay signals for one settled match at a theta ("5" | "10").
export function getReplaySignals(led: PickoffLedger | null, fid: string, theta: "5" | "10" = "5"): Signal[] {
  const m = led?.matches.find((x) => String(x.fid) === fid);
  if (!m) return [];
  // every call is a signal — the record rolls unfiltered
  return (m.divergences?.[theta] ?? []).map((e) => entryToSignal(m, e));
}

export { getPickoffs };
