// SIGNAL POLICY — every divergence call counts, and the Kelly math used everywhere (site headline,
// /proof, /edge, the paper engine, the CLI, Telegram).
//
// There is NO exclusion filter: the record rolls on its own. Every call the detector fires — either
// side, any size, any minute — is published and scored. Sizing is the only risk control: Kelly on the
// gap, f = gap/(1-entry), CAPPED at KELLY_CAP so no single call can stake more than that fraction of the
// free balance. Full Kelly assumes the edge is known exactly; ours is estimated from a stale-price gap,
// so at extreme gaps it over-bets an overstated edge (one 56.7pp call staked 81% and cost 76% of the
// bankroll). Capping bounds any single-bet drawdown while keeping every call in the record — a Kelly
// refinement, not an exclusion. An earlier version instead cut giant and late buy-NO calls; that filter
// is retired: sides are named by team and the full, uncurated set is the track record.

import type { DivergenceEntry } from "@/lib/pickoff-source";

/** Max fraction of the free balance any single Kelly call may stake. Fractional Kelly = the standard
 *  fix for sizing on an estimated (overstated) edge. Applied identically on the box, site, CLI, bot. */
export const KELLY_CAP = 0.3;

/** Match minute of a call, or null when the kickoff time is unknown. */
export function entryMinute(kick: number | undefined, tSeconds: number): number | null {
  if (!kick) return null;
  return (tSeconds * 1000 - kick) / 60000;
}

/** How front-facing surfaces collapse same-minute duplicate fires.
 *  "side" (default): one call per minute PER SIDE — an opposite-side call in the same minute is a
 *  different trade and stays. "any": one call per minute regardless of side. */
export type DedupeMode = "side" | "any";

/** DISPLAY-ONLY dedupe: the detector can fire twice inside the same display minute on the same
 *  event (a second fill ticks in at a worse price), which double-counts the call and inflates the
 *  compounded ROI. Front-facing surfaces keep only the LOWEST entry price per group; the published
 *  data underneath is untouched. Ties keep the earlier fill. */
export function dedupeDivs(divs: DivergenceEntry[], kick: number | undefined, mode: DedupeMode = "side"): DivergenceEntry[] {
  if (!kick || divs.length < 2) return divs;
  const best = new Map<string, DivergenceEntry>();
  const order: string[] = [];
  for (const e of divs) {
    const min = Math.max(0, Math.floor((e.t * 1000 - kick) / 60000));
    const key = mode === "side" ? `${min}:${e.side}` : String(min);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, e);
      order.push(key);
    } else if (e.entry < cur.entry || (e.entry === cur.entry && e.t < cur.t)) {
      best.set(key, e);
    }
  }
  return order.map((k) => best.get(k) as DivergenceEntry);
}

/** Kelly bankroll multiplier for one call, take-profit at fair on reach else marked out at close. */
export function kmultTp(e: DivergenceEntry): number {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(KELLY_CAP, Math.abs(e.gap) / d)) : 0;
  const r = e.entry > 0 ? (e.reached ? Math.abs(e.gap) : e.clv ?? 0) / e.entry : 0;
  return 1 + f * r;
}

/** The same Kelly bet held to the final result (the losing contrast for the evidence callout). */
export function kmultRes(e: DivergenceEntry): number {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(KELLY_CAP, Math.abs(e.gap) / d)) : 0;
  const r = e.win ? (1 - e.entry) / e.entry : -1;
  return 1 + f * r;
}

/** Pooled stats over EVERY call of a match set at one theta. */
export function pooledStats(matchDivs: { divs: DivergenceEntry[]; kick?: number }[]) {
  let n = 0, reach = 0, size = 0, kTp = 1, kRes = 1;
  for (const { divs } of matchDivs)
    for (const e of divs) {
      n++; reach += e.reached ? 1 : 0; size += e.usd ?? 0;
      kTp *= kmultTp(e); kRes *= kmultRes(e);
    }
  return {
    n,
    reachRate: n ? reach / n : 0,
    kellyRoi: n ? kTp - 1 : 0,
    kellyRoiRes: n ? kRes - 1 : 0,
    usd: size,
  };
}

/** Per-match Kelly ROI over every call (null when the match has no calls). */
export function matchKellyRoi(divs: DivergenceEntry[]): number | null {
  return divs.length ? divs.reduce((p, e) => p * kmultTp(e), 1) - 1 : null;
}
