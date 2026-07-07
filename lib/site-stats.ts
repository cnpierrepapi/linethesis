// SITE STATS — the headline numbers (reach rate, Kelly take-profit ROI, the resolution contrast,
// match count). Recomputed live from the ledger over EVERY call (no exclusion filter — the record rolls
// unfiltered; Kelly is capped at 30% per call, lib/signals/policy.ts), so the homepage, litepaper, and
// PDF show exactly what /proof shows. Falls back to last-known values if the blob is briefly unavailable.

import { getPickoffs } from "@/lib/pickoff-source";
import { pooledStats } from "@/lib/signals/policy";

const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
export function numWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export interface SiteStats {
  reachPct: number; // pooled reach rate at >=5pp, whole %
  roiPct: number; // pooled Kelly take-profit ROI at >=5pp, whole %
  roi10Pct: number; // same at >=10pp
  resPct: number; // pooled Kelly ROI of the SAME bets held to resolution at >=5pp (SIGNED, the contrast)
  res10Pct: number; // same at >=10pp
  matchCount: number;
  matchWord: string;
  // volume-to-divergence winner hint, graded dynamically against the regulation result. A regulation
  // draw (extra time / penalties) stays PENDING until the outcome confirms, so nothing is hardcoded.
  whFired: number;   // matches where the hint fired (>=4x, real volume)
  whGraded: number;  // of those, decisively resolved (no draw)
  whCorrect: number; // of the graded, called the winner
  whPending: number; // fired but awaiting a shootout / extra-time outcome
  hasData: boolean;
}

const FALLBACK: SiteStats = {
  reachPct: 72, roiPct: 52, roi10Pct: 66, resPct: -87, res10Pct: -54,
  matchCount: 13, matchWord: "thirteen",
  whFired: 7, whGraded: 5, whCorrect: 5, whPending: 2, hasData: false,
};

export async function getSiteStats(): Promise<SiteStats> {
  const led = await getPickoffs();
  const matches = led?.matches ?? [];
  const matchCount = led?.matchCount ?? matches.length ?? 0;
  const s5 = pooledStats(matches.map((m) => ({ divs: m.divergences?.["5"] ?? [], kick: m.kick })));
  const s10 = pooledStats(matches.map((m) => ({ divs: m.divergences?.["10"] ?? [], kick: m.kick })));
  if (!led || !s5.n) return { ...FALLBACK, matchCount: matchCount || FALLBACK.matchCount, matchWord: numWord(matchCount || FALLBACK.matchCount) };
  // winner-hint tally, dynamic and penalty-honest (correct === null means pending a shootout / ET)
  let whFired = 0, whGraded = 0, whCorrect = 0;
  for (const m of matches) {
    const wh = (m as unknown as { winnerHint?: { correct?: boolean | null } }).winnerHint;
    if (!wh) continue;
    whFired++;
    if (wh.correct === true) { whGraded++; whCorrect++; }
    else if (wh.correct === false) { whGraded++; }
  }
  return {
    reachPct: Math.round(s5.reachRate * 100),
    roiPct: Math.round(s5.kellyRoi * 100),
    roi10Pct: s10.n ? Math.round(s10.kellyRoi * 100) : Math.round(s5.kellyRoi * 100),
    resPct: Math.round(s5.kellyRoiRes * 100),
    res10Pct: s10.n ? Math.round(s10.kellyRoiRes * 100) : Math.round(s5.kellyRoiRes * 100),
    matchCount,
    matchWord: numWord(matchCount),
    whFired, whGraded, whCorrect, whPending: whFired - whGraded,
    hasData: true,
  };
}
