// IMPORT REPLAYS — bundle captured real TxLINE matches into lib/replays.json.
//
// The recorder (scripts/record_odds.mjs) writes one file per match into
// captures/ as
//   { fid, p1, p2, odds:[…], scores:[…] }
// where `odds` is the live-captured demargined book (odds history is gated on
// TxLINE, so it MUST be captured live) and `scores` is backfilled from
// /api/scores/updates. This script reads those capture files, keeps only the
// fields the edge engine consumes, and writes a single bundled JSON the replay
// feed imports — so the deployed app ships with real, verifiable match data and
// needs no TxLINE token at runtime.
//
//   node scripts/import_replays.mjs [srcDir ...]
// Defaults to ./captures (the recorder's output dir) if no args are given.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_SRCS = [
  path.resolve(process.cwd(), "captures"), // record_odds.mjs default out
];
const srcs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SRCS;
const OUT = path.resolve(process.cwd(), "lib/replays.json");

const SLIM_ODDS = (r) => ({
  FixtureId: r.FixtureId,
  Ts: Number(r.Ts),
  SuperOddsType: r.SuperOddsType,
  MarketParameters: r.MarketParameters ?? null,
  MarketPeriod: r.MarketPeriod ?? null,
  InRunning: r.InRunning ?? true,
  PriceNames: r.PriceNames,
  Prices: r.Prices,
});
const SLIM_SCORE = (r) => ({
  FixtureId: r.FixtureId,
  Ts: Number(r.Ts),
  Clock: r.Clock ?? null,
  Score: r.Score ?? null,
  Action: r.Action ?? null,
});

const byFid = new Map();

for (const dir of srcs) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch {
      continue;
    }
    if (raw.fid == null || !Array.isArray(raw.odds)) continue;
    const odds = raw.odds
      .filter((o) => o && o.FixtureId != null && Array.isArray(o.Prices) && o.Prices.some((p) => Number(p) > 0))
      .map(SLIM_ODDS)
      .sort((a, b) => a.Ts - b.Ts);
    const scores = (raw.scores || [])
      .filter((s) => s && s.FixtureId != null)
      .map(SLIM_SCORE)
      .sort((a, b) => a.Ts - b.Ts);
    if (odds.length < 20) continue; // need enough of a book to be worth replaying
    // Keep the richer capture if we see the same fixture twice.
    const prev = byFid.get(raw.fid);
    if (prev && prev.odds.length >= odds.length) continue;
    byFid.set(raw.fid, { fid: raw.fid, p1: raw.p1 ?? "Home", p2: raw.p2 ?? "Away", odds, scores });
  }
}

const matches = [...byFid.values()].sort((a, b) => b.odds.length - a.odds.length);
writeFileSync(OUT, JSON.stringify(matches));

const kb = (JSON.stringify(matches).length / 1024).toFixed(0);
console.log(`Wrote ${matches.length} match(es) → lib/replays.json (${kb} KB)`);
for (const m of matches) {
  console.log(`  ${m.fid}  ${m.p1} v ${m.p2}  —  ${m.odds.length} odds, ${m.scores.length} scores`);
}
if (!matches.length) console.log("  (no captures found — is the recorder running / has a match been captured?)");
