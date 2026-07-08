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
  gapPp: number; // how far past fair this fill printed, in prob points (>= 0 for exit fills)
  t?: number;    // unix seconds of the fill (from its block) — the replay clock
}
// A single verifiable on-chain leg: the real fill that anchors the entry or the exit, with its tx.
export interface LegFill { t: number; price: number; tx: string; usd?: number; gapPp?: number }
export interface DivergenceEntry {
  t: number; side: "yes" | "no"; entry: number; fair: number; gap: number; reached: boolean; win: number;
  usd: number; // $ that traded at/through fair during the window — the exitable size
  clv?: number; // closing-line value in prob points: (your side's implied at close) − (price paid)
  fills?: DivergenceFill[]; // the exit fills that summed to `usd` (closest-to-fair first, top 6)
  entryFill?: LegFill | null; // the real fill that SET the entry price (always present)
  exitFill?: LegFill | null;  // the real fill CLOSEST to fair — the canonical exit proof (present iff reached)
}
// Per-theta signal metrics. kellyRoi = the SURFACED metric: compounding return of Kelly-sized bets
// (f = gap/(1-entry)) exited at fair on reach, else at the close — never resolution. reachRate is
// the firm read. aggEdgePct/tpReturn/clvAvg kept for back-compat.
export interface EdgeStat { theta: number; n: number; reachRate: number; winRate: number; aggEdgePct: number; tpReturn: number; clvAvg: number; kellyRoi: number; usd: number }
// Pooled across matches. kellyRoiRes = the same Kelly bets HELD TO RESOLUTION (the losing contrast).
export interface PooledStat { theta: number; n: number; reachRate: number; aggEdgePct: number; tpReturn: number; clvAvg: number; kellyRoi: number; kellyRoiRes?: number; usd: number; ci90: [number, number] | null; tpCi90?: [number, number] | null; clvCi90?: [number, number] | null; kellyCi90?: [number, number] | null }
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
  // fill-based detector (live_edge.py): entry price + real entry/exit fills, so the live leg matches
  // /proof. `entry` is the bought-side price from the real entry fill; `pm` stays the CURRENT market
  // price (the bot settles convergence against it). Absent on the midpoint fallback.
  entry?: number; minute?: number; src?: "fill" | "midpoint";
  entryFill?: { t: number; price: number; tx: string } | null;
  exitFill?: { t: number; price: number; tx: string; gapPp?: number } | null;
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

// LIVE STREAM — the box's two-market tick tape (desk-archives/live-stream.json, ~52KB). Served ONLY
// through /api/live-stream so clients poll same-origin and Vercel's cache absorbs the reads. The
// revalidate window caps Supabase egress at ~one fetch per window no matter how many tabs are open;
// the old client fetched this blob DIRECTLY every 3s with a cache-buster, which blew the egress budget.
export interface LiveStreamBlob { fixtures: unknown[] }

export async function getLiveStream(): Promise<LiveStreamBlob> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (base) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/storage/v1/object/public/desk-archives/live-stream.json`, {
        next: { revalidate: 8 },
      });
      if (r.ok) {
        const d = (await r.json()) as LiveStreamBlob;
        if (d && Array.isArray(d.fixtures)) return d;
      }
    } catch {
      /* fall through */
    }
  }
  return { fixtures: [] };
}
