// HARVEST ARCHIVES — the automatic "ended match → signals" pipeline.
//
// The EC2 worker's archiver already auto-persists every FINISHED live match to the public
// `desk-archives` Storage bucket and indexes it in the `desk_archived` table. This script
// closes the loop hands-free: discover finished matches, download the new blobs, and fold
// them into lib/replays.json (via import_archived). Once replays.json is pushed, /desk and
// /proof AUTO-SELECT the calls that played out at read time (proof-reel.selectBelievable) —
// so "generate the signals + pick the ones that played out" needs no extra step.
//
//   node scripts/harvest_archives.mjs              discover finished matches, fetch NEW ones, import
//   node scripts/harvest_archives.mjs --fid 18176123   fetch one match by id (public bucket, no key)
//   node scripts/harvest_archives.mjs --all        re-fetch even matches already bundled
//   node scripts/harvest_archives.mjs --limit 20   how many recent finished matches to consider
//   node scripts/harvest_archives.mjs --publish    upload the merged replays to Supabase (NO redeploy)
//   node scripts/harvest_archives.mjs --max-matches 12   cap the PUBLISHED set to the N most-recent matches (default 12)
//
// Discovery needs Supabase creds (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY —
// the anon key is public-safe). Blob download does NOT (the bucket is public). --publish needs
// the SERVICE ROLE key (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — box-only, same as the
// archiver). With no creds and no --fid, the script just imports whatever is in captures_live/.
//
// ⚠️ We NO LONGER commit replays.json growth to git. The site reads the published Supabase
// blob at runtime (lib/replays-source.ts), so --publish makes a new match appear on /desk,
// /proof and the sandbox within ~2 minutes with NO deploy and NO git bloat. Run this on the
// EC2 box (it has the service key + is where the archiver already writes).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// tolerate a local .env.local for creds without adding a dotenv dep
function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co").replace(/\/$/, "");
// REST key for the desk_archived discovery query: prefer the public anon key, but fall back
// to the service-role key (the box has this and it reads desk_archived just the same — either
// works as a Supabase REST `apikey`).
const RESTKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "desk-archives";
const SRC_DIR = path.resolve(process.cwd(), "captures_live");
const REPLAYS = path.resolve(process.cwd(), "lib/replays.json");

// The RUNTIME blob the site fetches (lib/replays-source.ts) is parsed into memory inside every
// data route, so it must stay bounded — the box-local replays.json + per-match bucket blobs keep
// the FULL history, but we publish only the N most-recent matches (a rolling window). N matches
// still carry thousands of settled signals for the calibration ledger, and "recent" is the more
// relevant track record. Override with --max-matches; 0 = uncapped (publish the whole file).
// 12 matches ≈ a ~36MB runtime blob (safe to parse per-lambda) and still thousands of settled
// signals for the ledger — raise it later if the function has headroom + you want a longer window.
const MAX_MATCHES = Number(val("--max-matches", "12"));

// Recency = the match's last observed frame (odds are Ts-ascending; fall back to scores). Newest
// activity ranks first. Robust + self-contained: no dependency on desk_archived timestamps.
function matchRecency(m) {
  const lastOdds = Array.isArray(m.odds) && m.odds.length ? Number(m.odds[m.odds.length - 1].Ts) || 0 : 0;
  const lastScore = Array.isArray(m.scores) && m.scores.length ? Number(m.scores[m.scores.length - 1].Ts) || 0 : 0;
  return Math.max(lastOdds, lastScore);
}

// Keep the MAX_MATCHES most-recent matches, but PRESERVE the file's original order (import sorts
// by odds-count, which some surfaces treat as "featured") so the only behavioural change is that
// the oldest matches drop out of the runtime set.
function capRecent(all, max) {
  if (!Array.isArray(all) || !max || all.length <= max) return all;
  const keep = new Set(
    [...all].sort((a, b) => matchRecency(b) - matchRecency(a)).slice(0, max).map((m) => String(m.fid)),
  );
  return all.filter((m) => keep.has(String(m.fid)));
}

const publicBlobUrl = (fidOrPath) =>
  /\//.test(String(fidOrPath))
    ? `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${fidOrPath}`
    : `${SUPA_URL}/storage/v1/object/public/${BUCKET}/live/${fidOrPath}.json`;

function existingFids() {
  try {
    return new Set(JSON.parse(readFileSync(REPLAYS, "utf8")).map((m) => String(m.fid)));
  } catch {
    return new Set();
  }
}

// discover finished matches from desk_archived (needs a Supabase REST key)
async function discover(limit) {
  if (!RESTKEY) {
    console.log("• no Supabase REST key (NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) — skipping discovery.");
    console.log("  Set one in env (the box's worker/.env has the service-role key), or pass --fid <id>.");
    return [];
  }
  const url = `${SUPA_URL}/rest/v1/desk_archived?select=fixture_id,p1,p2,storage_path,finished_at&order=finished_at.desc&limit=${limit}`;
  const r = await fetch(url, { headers: { apikey: RESTKEY, Authorization: `Bearer ${RESTKEY}` } });
  if (!r.ok) {
    console.log(`• desk_archived query failed: HTTP ${r.status}`);
    return [];
  }
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fid: String(row.fixture_id),
    label: `${row.p1} v ${row.p2}`,
    storagePath: row.storage_path || `live/${row.fixture_id}.json`,
  }));
}

async function fetchBlob(fid, storagePath) {
  const url = publicBlobUrl(storagePath || fid);
  const r = await fetch(url);
  if (!r.ok) {
    console.log(`  ✗ ${fid}: blob HTTP ${r.status}`);
    return false;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(SRC_DIR, { recursive: true });
  writeFileSync(path.join(SRC_DIR, `${fid}.json`), buf);
  console.log(`  ✓ ${fid}: ${(buf.length / 1e6).toFixed(1)}MB → captures_live/${fid}.json`);
  return true;
}

async function main() {
  const limit = Number(val("--limit", "50"));
  const bundled = existingFids();

  // 1) decide which fixtures to fetch
  let targets = [];
  const fid = val("--fid", null);
  if (fid) {
    targets = [{ fid: String(fid), label: `fixture ${fid}`, storagePath: null }];
  } else {
    const found = await discover(limit);
    console.log(`• discovered ${found.length} finished match(es) in desk_archived.`);
    targets = has("--all") ? found : found.filter((m) => !bundled.has(m.fid));
    console.log(`• ${targets.length} to fetch${has("--all") ? " (--all)" : ` (new — ${found.length - targets.length} already bundled)`}.`);
  }

  // 2) download blobs
  let fetched = 0;
  for (const t of targets) {
    if (await fetchBlob(t.fid, t.storagePath)) fetched++;
  }
  // Skip the re-import only when there's nothing new AND we're not being asked to (re)publish
  // the current set — otherwise --force-publish must still be able to seed the blob.
  const wantPublish = has("--publish") || has("--force-publish");
  if (!fetched && !existsSync(SRC_DIR) && !wantPublish) {
    console.log("nothing to import.");
    return;
  }

  // 3) fold into replays.json (reuses the tested downsample/merge importer)
  console.log("\n— importing —");
  execSync("node scripts/import_archived.mjs", { stdio: "inherit" });

  // 4) did replays.json gain a match?
  const after = existingFids();
  const added = [...after].filter((f) => !bundled.has(f));
  console.log(`\n${added.length ? `＋ added ${added.length} match(es): ${added.join(", ")}` : "no new matches added (already bundled / not viable)."}`);

  // 5) publish to Supabase → the site reads it at runtime, so it shows up with NO redeploy.
  // --force-publish always publishes (seeding); --publish publishes only when a match was added.
  if (has("--force-publish") || (has("--publish") && added.length)) {
    try {
      const { uploadStorage } = await import("../worker/supabase.mjs");
      const all = JSON.parse(readFileSync(REPLAYS, "utf8"));
      const capped = capRecent(all, MAX_MATCHES);
      const body = Buffer.from(JSON.stringify(capped));
      await uploadStorage("desk-archives", "replays.json", body, "application/json");
      const onDisk = readFileSync(REPLAYS).length;
      console.log(`published ${capped.length}/${all.length} most-recent match(es) — ${(body.length / 1e6).toFixed(1)}MB runtime blob (of ${(onDisk / 1e6).toFixed(1)}MB on disk) → desk-archives/replays.json`);
      if (capped.length < all.length) {
        console.log(`  rolling window: capped to --max-matches ${MAX_MATCHES}; the ${all.length - capped.length} older match(es) stay in the local file + per-match bucket blobs, just not in the runtime set.`);
      }
      console.log("  /desk + /proof + sandbox pick it up within ~2min at runtime — NO deploy, NO git commit.");
    } catch (e) {
      console.log(`publish skipped: ${e.message} (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — run on the box)`);
    }
  } else if (added.length) {
    console.log("  (run with --publish to push the merged set to Supabase so the site updates with no redeploy.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
