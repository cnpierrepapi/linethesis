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

// FAIR PROOFS — the TxLINE side of the two-sided proof. For each divergence leg (an entry or
// exit fill's second) we recover the demargined odds record in force from TxLINE's historical
// API, fetch its Merkle proof, and LAND a mainnet `validate_odds` transaction. The program only
// lets that transaction succeed if the record hashes into the daily Merkle root TxODDS committed
// on Solana, so the confirmed signature IS the proof that TxLINE's fair was that price at that
// second. Published as a sidecar blob keyed "fid:fillT" (unix seconds of the Polygon fill).
export interface FairProof {
  status: "anchored" | "pending";
  reason?: string;      // why a pending leg is pending (root not posted, no frame, ...)
  messageId?: string;   // TxLINE's odds update id (recoverable from their public API)
  frameTs?: number;     // ms timestamp of the odds record that was in force at the fill
  prices?: number[];    // demargined [part1, draw, part2] decimal odds x1000
  fairYes?: number;     // implied P(second-named team wins) from those prices
  day?: number;         // epoch day of the on-chain root account
  pda?: string;         // the daily_batch_roots root account the proof verified against
  sig?: string | null;  // the landed validate_odds transaction signature (Solscan)
}
export interface FairProofsBlob {
  generatedAt: number; cluster: string; program: string;
  proofs: Record<string, FairProof>; // key = `${fid}:${fillT}`
}

let FP_CACHE: { at: number; data: FairProofsBlob | null } | null = null;

export async function getFairProofs(): Promise<FairProofsBlob | null> {
  if (FP_CACHE && Date.now() - FP_CACHE.at < TTL_MS) return FP_CACHE.data;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (base) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/storage/v1/object/public/desk-archives/fair-proofs.json`, {
        next: { revalidate: 120 },
      });
      if (r.ok) {
        const data = (await r.json()) as FairProofsBlob;
        if (data && data.proofs) {
          FP_CACHE = { at: Date.now(), data };
          return data;
        }
      }
    } catch {
      /* fall through */
    }
  }
  FP_CACHE = { at: Date.now(), data: null };
  return null;
}

// Solana explorer link for a landed validate_odds proof transaction.
export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

// NOTE: the real-time surface (live-edge.json / live-stream.json readers, the /live page, the live
// signal feed) was retired when the tournament closed. The product is now archival: the published
// track record and the replay paper-trading pipeline. See lib/signals/feed.ts (getReplaySignals).
