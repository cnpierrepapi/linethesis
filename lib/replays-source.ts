// RUNTIME REPLAY SOURCE — where the site gets its match data at REQUEST time.
//
// The EC2 harvester publishes the merged, downsampled replay set to the public
// `desk-archives/replays.json` blob after every finished match. The site reads THAT here,
// so a newly-archived match shows up on /desk, /proof and the sandbox WITHOUT a redeploy —
// the whole point of the automation. Falls back to the bundled seed (first deploy, offline,
// or before the box's first publish) so nothing is ever empty.
//
// Cached two ways: Next's fetch data-cache (revalidate) across requests + a short in-process
// memo, so a new match appears within a minute or two of being published, no deploy involved.
import seed from "./replays.json";

type Match = unknown;

function blobUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/desk-archives/replays.json` : null;
}

let CACHE: { at: number; data: Match[] } | null = null;
const TTL_MS = 60_000;

export async function getReplays(): Promise<Match[]> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.data;
  const url = blobUrl();
  if (url) {
    try {
      const r = await fetch(url, { next: { revalidate: 120 } });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length) {
          CACHE = { at: Date.now(), data };
          return data;
        }
      }
    } catch {
      /* fall through to the bundled seed */
    }
  }
  CACHE = { at: Date.now(), data: seed as Match[] };
  return seed as Match[];
}
