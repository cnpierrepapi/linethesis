// BACKUP ARCHIVES — a durable, redundant copy of every archived match's RAW blob.
//
// The archiver's source-of-record is Supabase Storage (`desk-archives/{session}/{fid}.json`)
// + the `desk_archived` index. TxLINE odds are LIVE-ONLY (they cannot be backfilled), so those
// per-match raw blobs are irreplaceable — and today they exist in exactly ONE place (the bucket).
// This script pulls a SECOND copy to a permanent directory so a bucket loss can't erase history.
//
// It is idempotent and NEVER deletes: already-present blobs are skipped, so re-running only
// fetches what's new. Unlike `captures_live/` (scratch, cron-deleted >120min), the target dir
// here is meant to persist.
//
//   node scripts/backup_archives.mjs                       mirror to ./match-archive
//   node scripts/backup_archives.mjs --dir ~/match-archive  mirror to a chosen dir (recommend on the 20GB box)
//   node scripts/backup_archives.mjs --force               re-download even blobs already saved
//   node scripts/backup_archives.mjs --cluster mainnet     only this cluster (default: all)
//
// Discovery needs a Supabase REST key (NEXT_PUBLIC_SUPABASE_ANON_KEY — public-safe — or the
// SERVICE_ROLE key; the worker box's worker/.env already has the latter). Blob DOWNLOAD needs
// no key (the bucket is public-read). Run it where a key exists: the box, or locally with the
// anon key in .env.local.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// tolerate a local .env.local for creds without adding a dotenv dep (same as harvest)
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
const RESTKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "desk-archives";
const FORCE = has("--force");
const CLUSTER = val("--cluster", null);
// ~ expands to home so `--dir ~/match-archive` works when invoked without a shell that expands it
const rawDir = val("--dir", "match-archive");
const DEST = path.resolve(rawDir.startsWith("~") ? path.join(os.homedir(), rawDir.slice(1)) : rawDir);

const publicBlobUrl = (storagePath) => `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

// Discover EVERY archived match (paginated — the REST default caps a page at 1000 rows).
async function discoverAll() {
  if (!RESTKEY) {
    console.error("✗ no Supabase REST key (NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY).");
    console.error("  Run on the worker box (worker/.env has the service-role key) or set the anon key in .env.local.");
    process.exit(1);
  }
  const cols = "fixture_id,p1,p2,session,cluster,storage_path,odds_frames,score_frames,first_ts,last_ts,finished_at";
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let url = `${SUPA_URL}/rest/v1/desk_archived?select=${cols}&order=finished_at.desc`;
    if (CLUSTER) url += `&cluster=eq.${encodeURIComponent(CLUSTER)}`;
    const r = await fetch(url, {
      headers: { apikey: RESTKEY, Authorization: `Bearer ${RESTKEY}`, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!r.ok) {
      console.error(`✗ desk_archived query failed: HTTP ${r.status}`);
      process.exit(1);
    }
    const page = await r.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const rows = await discoverAll();
  console.log(`• ${rows.length} archived match(es) in desk_archived${CLUSTER ? ` (cluster=${CLUSTER})` : ""}.`);
  mkdirSync(DEST, { recursive: true });

  let saved = 0, skipped = 0, failed = 0, bytes = 0;
  const manifest = [];
  for (const row of rows) {
    const fid = String(row.fixture_id);
    const storagePath = row.storage_path || `${row.session || "live"}/${fid}.json`;
    // namespace the local copy by cluster so devnet/mainnet fids can never collide
    const localRel = path.join(String(row.cluster || "unknown"), storagePath);
    const localAbs = path.join(DEST, localRel);
    let localBytes = 0;

    if (!FORCE && existsSync(localAbs) && statSync(localAbs).size > 0) {
      localBytes = statSync(localAbs).size;
      skipped++;
    } else {
      try {
        const res = await fetch(publicBlobUrl(storagePath));
        if (!res.ok) throw new Error(`blob HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(path.dirname(localAbs), { recursive: true });
        writeFileSync(localAbs, buf);
        localBytes = buf.length;
        saved++;
        console.log(`  ✓ ${fid} ${row.p1} v ${row.p2} [${row.cluster}] — ${(buf.length / 1e6).toFixed(1)}MB`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${fid} ${row.p1} v ${row.p2}: ${e.message}`);
        continue;
      }
    }
    bytes += localBytes;
    manifest.push({
      fixture_id: row.fixture_id, teams: `${row.p1} v ${row.p2}`, cluster: row.cluster, session: row.session,
      storage_path: storagePath, local_path: localRel, bytes: localBytes,
      odds_frames: row.odds_frames, score_frames: row.score_frames,
      first_ts: row.first_ts, last_ts: row.last_ts, finished_at: row.finished_at,
    });
  }

  writeFileSync(path.join(DEST, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n${DEST}`);
  console.log(`  ${manifest.length} matches on disk — ${(bytes / 1e6).toFixed(1)}MB total (+${saved} new, ${skipped} already had, ${failed} failed).`);
  console.log(`  manifest.json written. Nothing was deleted.`);

  // Report free space on the target so a fill-up never silently starves the worker box.
  try {
    const df = execSync(`df -Pk ${JSON.stringify(DEST)}`, { encoding: "utf8" }).trim().split("\n").pop();
    const availKb = Number(df.split(/\s+/)[3]);
    if (Number.isFinite(availKb)) console.log(`  disk free at target: ${(availKb / 1e6).toFixed(1)}GB`);
  } catch { /* df not available (e.g. Windows) — skip the courtesy check */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
