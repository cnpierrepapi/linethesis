// RUNTIME PICKOFF SOURCE — the real Polymarket-vs-TxLINE pickoff ledger the site reads.
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
  pm: number;       // Polymarket implied P(win) at the fill
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
export interface PickoffMatch {
  fid: string; slug: string; teams: string; kick: number; ft: number;
  all: PickoffStats; inplay: PickoffStats; top_pickoffs: PickoffFill[];
}
export interface PickoffLedger {
  generatedAt: number; matchCount: number;
  totals: { usd: number; ge5pp_usd: number; ge10pp_usd: number; fills: number };
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
