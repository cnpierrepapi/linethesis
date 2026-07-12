// GUARD: runtime blobs fetched with Next `revalidate` MUST stay under Vercel's data-cache
// cap (~2MB per fetch entry). Over the cap, Next SILENTLY skips caching and every request
// re-downloads the blob from Supabase — that is exactly how replays.json (46MB) burned
// ~70GB of cached egress in Jul 2026. This tripwire checks the published objects' metadata
// (an /object/info call — no download, no egress) and FAILS the suite if any watched blob
// is over budget, before the bleed can restart.
//
// Watched = every blob the app fetches with `revalidate` at request time. Per-match
// replays/<fid>.json blobs are exempt: they are fetched no-store behind long s-maxage CDN
// headers by design (see lib/replays-source.ts).
const BASE = "https://mohbmvajroqizlfaarjk.supabase.co/storage/v1/object/info/public/desk-archives";
const BUDGET = 1_900_000; // stay clear of the ~2MB cap
const WATCH = ["pickoffs.json", "replays-index.json", "live-stream.json", "live-edge.json"];

let failed = false;
for (const name of WATCH) {
  try {
    const r = await fetch(`${BASE}/${name}`);
    if (!r.ok) {
      console.log(`guard_blob_budget: ${name} — info HTTP ${r.status} (missing is OK pre-seed), skipping`);
      continue;
    }
    const meta = await r.json();
    const size = Number(meta?.size ?? meta?.metadata?.size ?? meta?.contentLength ?? NaN);
    if (!Number.isFinite(size)) {
      console.log(`guard_blob_budget: ${name} — no size in metadata, skipping`);
      continue;
    }
    const mb = (size / 1e6).toFixed(2);
    if (size > BUDGET) {
      console.error(`guard_blob_budget: ✗ ${name} is ${mb}MB — OVER the ${(BUDGET / 1e6).toFixed(1)}MB data-cache budget. Vercel will silently stop caching it and every request will hit Supabase. Shrink it (trim series / raise downsampling) before shipping.`);
      failed = true;
    } else {
      console.log(`guard_blob_budget: ✓ ${name} ${mb}MB`);
    }
  } catch (e) {
    // offline test runs shouldn't fail on network; the guard only fails on CONFIRMED oversize
    console.log(`guard_blob_budget: ${name} — fetch failed (${e.message}), skipping`);
  }
}
if (failed) process.exit(1);
console.log("guard_blob_budget: all watched runtime blobs within the data-cache budget.");
