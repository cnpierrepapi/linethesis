// RUNTIME REPLAY SOURCE — where the site gets its match data at REQUEST time.
//
// The EC2 harvester publishes a TINY replays-index.json plus one replays/<fid>.json blob
// per match. The site reads those here, so a newly-archived match shows up on /live replay
// and /proof WITHOUT a redeploy. Falls back to the bundled seed (first deploy, offline, or
// before the box's first publish) so nothing is ever empty.
//
// ⚠️ WHY split blobs (Jul 2026 cached-egress blowout): the old single replays.json grew to
// 46MB. Vercel's data cache silently rejects fetch entries over ~2MB, so `revalidate` did
// NOTHING and every route invocation re-downloaded the whole blob from Supabase — ~70GB of
// cached egress in one billing period. The rules now:
//   • only the SMALL index is fetched with `revalidate` (it fits the data cache);
//   • per-match blobs (~4MB) are fetched no-store + memoized in-process, and the ROUTES that
//     serve them send long s-maxage headers so Vercel's CDN absorbs repeat traffic;
//   • the full set is only assembled for /api/verify-csv, behind its own long CDN cache.
import seed from "./replays.json";

type Match = { fid: number | string; p1: string; p2: string; odds?: unknown[]; scores?: unknown[] };
export type ReplayIndexEntry = { fid: string; label: string; frames: number };

function baseUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  return base ? base.replace(/\/$/, "") : null;
}
const objUrl = (p: string) => `${baseUrl()}/storage/v1/object/public/desk-archives/${p}`;

function seedIndex(): ReplayIndexEntry[] {
  return (seed as unknown as Match[]).map((m) => ({
    fid: String(m.fid),
    label: `${m.p1} v ${m.p2}`,
    frames: Array.isArray(m.odds) ? m.odds.length : 0,
  }));
}

// ---- index: tiny, so Next's fetch data cache actually holds it ----------------
let IDX_CACHE: { at: number; data: ReplayIndexEntry[] } | null = null;
const IDX_TTL_MS = 60_000;

export async function getReplayIndex(): Promise<ReplayIndexEntry[]> {
  if (IDX_CACHE && Date.now() - IDX_CACHE.at < IDX_TTL_MS) return IDX_CACHE.data;
  if (baseUrl()) {
    try {
      const r = await fetch(objUrl("replays-index.json"), { next: { revalidate: 300 } });
      if (r.ok) {
        const data = (await r.json()) as ReplayIndexEntry[];
        if (Array.isArray(data) && data.length) {
          IDX_CACHE = { at: Date.now(), data };
          return data;
        }
      }
    } catch {
      /* fall through to the bundled seed */
    }
  }
  IDX_CACHE = { at: Date.now(), data: seedIndex() };
  return IDX_CACHE.data;
}

// ---- per-match: over the data-cache cap, so memoize in-process only ------------
// The route responses built from these carry long s-maxage headers (a finished match never
// changes), so a Supabase pull happens roughly once per instance per match, not per visitor.
const MATCH_CACHE = new Map<string, { at: number; m: Match }>();
const MATCH_TTL_MS = 60 * 60_000;
const MATCH_CACHE_MAX = 4; // ~4MB each; bound lambda memory

export async function getReplayMatch(fid: string): Promise<Match | null> {
  const key = String(fid);
  const hit = MATCH_CACHE.get(key);
  if (hit && Date.now() - hit.at < MATCH_TTL_MS) return hit.m;
  let m: Match | null = null;
  if (baseUrl()) {
    try {
      const r = await fetch(objUrl(`replays/${key}.json`), { cache: "no-store" });
      if (r.ok) {
        const data = (await r.json()) as Match;
        if (data && String(data.fid) === key) m = data;
      }
    } catch {
      /* fall through to the bundled seed */
    }
  }
  if (!m) m = (seed as unknown as Match[]).find((x) => String(x.fid) === key) ?? null;
  if (m) {
    if (MATCH_CACHE.size >= MATCH_CACHE_MAX && !MATCH_CACHE.has(key)) {
      const oldest = MATCH_CACHE.keys().next().value;
      if (oldest !== undefined) MATCH_CACHE.delete(oldest);
    }
    MATCH_CACHE.set(key, { at: Date.now(), m });
  }
  return m;
}

// ---- full set: /api/verify-csv only (needs every settled signal) ---------------
let ALL_CACHE: { at: number; data: Match[] } | null = null;
const ALL_TTL_MS = 10 * 60_000;

export async function getReplays(): Promise<Match[]> {
  if (ALL_CACHE && Date.now() - ALL_CACHE.at < ALL_TTL_MS) return ALL_CACHE.data;
  const index = await getReplayIndex();
  const fetched = await Promise.all(index.map((e) => getReplayMatch(e.fid)));
  const data = fetched.filter((m): m is Match => !!m);
  if (data.length) {
    ALL_CACHE = { at: Date.now(), data };
    return data;
  }
  ALL_CACHE = { at: Date.now(), data: seed as unknown as Match[] };
  return ALL_CACHE.data;
}
