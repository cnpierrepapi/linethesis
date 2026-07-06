// SITE STATS — the headline numbers (reach rate, Kelly take-profit ROI, the resolution contrast,
// match count) read live from the pooled blob, so marketing copy on the homepage, the litepaper, and
// the PDF never drift from what /proof actually shows. Falls back to last-known values if the blob is
// briefly unavailable.

import { getPickoffs } from "@/lib/pickoff-source";

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
  resLossPct: number; // how much the SAME bets lost held to resolution at >=5pp (positive magnitude)
  res10LossPct: number; // same at >=10pp
  matchCount: number;
  matchWord: string;
  hasData: boolean;
}

const FALLBACK: SiteStats = {
  reachPct: 71, roiPct: 114, roi10Pct: 158, resLossPct: 80, res10LossPct: 42,
  matchCount: 10, matchWord: "ten", hasData: false,
};

export async function getSiteStats(): Promise<SiteStats> {
  const led = await getPickoffs();
  const p5 = led?.pooled?.["5"];
  const p10 = led?.pooled?.["10"];
  const matchCount = led?.matchCount ?? led?.matches?.length ?? 0;
  if (!led || !p5 || !p5.n) return { ...FALLBACK, matchCount: matchCount || FALLBACK.matchCount, matchWord: numWord(matchCount || FALLBACK.matchCount) };
  return {
    reachPct: Math.round(p5.reachRate * 100),
    roiPct: Math.round(p5.kellyRoi * 100),
    roi10Pct: p10 ? Math.round(p10.kellyRoi * 100) : FALLBACK.roi10Pct,
    resLossPct: Math.abs(Math.round((p5.kellyRoiRes ?? 0) * 100)),
    res10LossPct: p10 ? Math.abs(Math.round((p10.kellyRoiRes ?? 0) * 100)) : FALLBACK.res10LossPct,
    matchCount,
    matchWord: numWord(matchCount),
    hasData: true,
  };
}
