// BACKFILL SCORES — repair a capture's `scores[]` from TxLINE history.
//
// Odds are live-only (the /api/odds/updates history is empty), but SCORES are
// served in full historically via /api/scores/updates/{fid}. A capture recorded
// live early in a match only holds the score events that had fired by flush
// time; once the match ends the full sequence is available. This re-pulls it and
// rewrites ONLY the `scores[]` field — odds[] are left exactly as captured.
//
//   node --env-file=.env.local scripts/backfill_scores.mjs            # every capture
//   node --env-file=.env.local scripts/backfill_scores.mjs 18172280   # specific fids
//
// Env: TXLINE_API_BASE, TXLINE_JWT, TXLINE_API_TOKEN.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const apiBase = process.env.TXLINE_API_BASE;
const jwt = process.env.TXLINE_JWT;
const apiToken = process.env.TXLINE_API_TOKEN;
if (!apiBase || !jwt || !apiToken) {
  console.error("Missing TXLINE_API_BASE / TXLINE_JWT / TXLINE_API_TOKEN (use --env-file=.env.local).");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken };

const CAP = path.resolve(process.cwd(), "captures");

// Keep the fields lib/edge/engine.mjs#ingestScores actually consumes.
const SLIM_SCORE = (r) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Clock: r.Clock, GameState: r.GameState,
  Score: r.Score, Action: r.Action,
});

// /api/scores/updates is SSE-framed text — pull JSON out of every `data:` line.
function parseUpdates(text) {
  const recs = [];
  for (const l of text.split("\n")) {
    if (!l.startsWith("data:")) continue;
    let v = l.slice(5);
    if (v.startsWith(" ")) v = v.slice(1);
    try { const o = JSON.parse(v); if (o && o.FixtureId != null) recs.push(o); } catch {}
  }
  return recs;
}

const argFids = process.argv.slice(2).map(Number).filter(Boolean);
const fids = argFids.length
  ? argFids
  : readdirSync(CAP).filter((f) => f.endsWith(".json")).map((f) => Number(path.basename(f, ".json")));

for (const fid of fids) {
  const file = path.join(CAP, `${fid}.json`);
  let cap;
  try { cap = JSON.parse(readFileSync(file, "utf8")); }
  catch { console.error(`  ✗ ${fid}: no capture file`); continue; }

  let scores = [];
  try {
    const text = await (await fetch(`${apiBase}/api/scores/updates/${fid}`, { headers })).text();
    scores = parseUpdates(text).map(SLIM_SCORE);
  } catch (e) { console.error(`  ✗ ${fid}: fetch failed — ${e.message}`); continue; }

  const before = cap.scores?.length ?? 0;
  const withGoals = scores.filter((s) => s.Score).length;
  cap.scores = scores;
  writeFileSync(file, JSON.stringify(cap));
  console.log(`  ✓ ${fid} ${cap.p1 ?? "?"} v ${cap.p2 ?? "?"}: scores ${before} → ${scores.length} (${withGoals} carry Score)`);
}
console.log("Done. Re-run scripts/import_replays.mjs to rebundle lib/replays.json.");
