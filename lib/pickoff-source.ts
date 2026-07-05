// RUNTIME PICKOFF SOURCE — the real prediction-market-vs-TxLINE pickoff ledger the site reads.
//
// The EC2 backfiller publishes the merged per-match pickoff surfaces to the public
// `desk-archives/pickoffs.json` blob after every match (nightly cron + on demand). /proof
// and the landing evidence read THAT here, so a newly-settled match appears with NO redeploy.
// Falls back to null (callers render an empty state) when the blob isn't published yet.
//
// Each match carries summary stats (in-play $ volume, median gap, $ traded >=5pp / >=10pp off
// fair) plus `top_pickoffs`: the biggest in-play gaps, each with the Polygon tx hash that
// settled it on-chain, so the ledger is verifiable, not asserted.

export interface PickoffFill {
  t: number;        // unix seconds of the fill
  pm: number;       // prediction market implied P(win) at the fill
  fair: number;     // TxLINE demargined fair at that instant
  gap_pp: number;   // (pm - fair) * 100, signed
  usd: number;      // notional of the fill
  tx: string;       // Polygon transaction hash (explorer-verifiable)
}
export interface PickoffStats {
  fills: number; usd: number; mean_pp: number; median_pp: number;
  ge2pp_usd: number; ge2pp_fills: number;
  ge5pp_usd: number; ge5pp_fills: number;
  ge10pp_usd: number; ge10pp_fills: number;
}
// one downsampled replay point: [secondsFromKick, txlineFair, bookImplied|null]
export type ReplayPoint = [number, number, number | null];
// A full-resolution divergence entry (computed on the real fills, not the coarse series):
// PM lagged the fair by >=theta on the cheap side. `reached` = PM later travelled to TxLINE's
// price (Test 1); `win` = the bought side won at resolution (Test 2). t = unix seconds.
export interface DivergenceFill {
  tx: string;    // Polygon transaction hash (explorer-verifiable)
  price: number; // implied P(win) the cheap side traded at
  usd: number;   // notional of this fill
  gapPp: number; // (fair - price) * 100 at the fill, signed
}
export interface DivergenceEntry {
  t: number; side: "yes" | "no"; entry: number; fair: number; gap: number; reached: boolean; win: number;
  usd: number; // $ that traded at the stale price during the window — the size available to take
  fills?: DivergenceFill[]; // the actual Polygon fills that summed to `usd` (top 6 by size)
}
// Per-theta signal metrics: the reach/convergence rate + aggregate directional edge.
export interface EdgeStat { theta: number; n: number; reachRate: number; winRate: number; aggEdgePct: number; usd: number }
// Pooled across matches, with a MATCH-LEVEL bootstrap 90% CI on the aggregate edge (honest N).
export interface PooledStat { theta: number; n: number; reachRate: number; aggEdgePct: number; usd: number; ci90: [number, number] | null }
export interface PickoffMatch {
  fid: string; slug: string; teams: string; kick: number; ft: number;
  all: PickoffStats; inplay: PickoffStats; top_pickoffs: PickoffFill[];
  series: ReplayPoint[];
  divergences?: Record<string, DivergenceEntry[]>; // keyed by theta*100 ("5" | "10")
  edge?: Record<string, EdgeStat>;
}
export interface PickoffLedger {
  generatedAt: number; matchCount: number;
  totals: { usd: number; ge5pp_usd: number; ge10pp_usd: number; fills: number };
  pooled?: Record<string, PooledStat>; // keyed "5" | "10"
  matches: PickoffMatch[];
}

function blobUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/desk-archives/pickoffs.json` : null;
}

let CACHE: { at: number; data: PickoffLedger | null } | null = null;
const TTL_MS = 60_000;

export async function getPickoffs(): Promise<PickoffLedger | null> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.data;
  const url = blobUrl();
  if (url) {
    try {
      const r = await fetch(url, { next: { revalidate: 120 } });
      if (r.ok) {
        const data = (await r.json()) as PickoffLedger;
        if (data && Array.isArray(data.matches)) {
          CACHE = { at: Date.now(), data };
          return data;
        }
      }
    } catch {
      /* fall through to null */
    }
  }
  CACHE = { at: Date.now(), data: null };
  return null;
}

// Polygon explorer link for a pickoff's settling transaction.
export function polygonTx(tx: string): string {
  return `https://polygonscan.com/tx/${tx}`;
}

// LIVE EDGE — the real-time divergence detector's latest read (box cron */1 → live-edge.json).
export interface LiveSignal {
  fid: string; teams: string; fair: number; pm: number; gapPp: number; diverged: boolean; side: "yes" | "no"; ts: number;
}
export interface LiveEdge { generatedAt: number; liveCount: number; theta: number; signals: LiveSignal[] }

export async function getLiveEdge(): Promise<LiveEdge | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return null;
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/storage/v1/object/public/desk-archives/live-edge.json`, {
      cache: "no-store",
    });
    if (r.ok) return (await r.json()) as LiveEdge;
  } catch {
    /* fall through */
  }
  return null;
}
