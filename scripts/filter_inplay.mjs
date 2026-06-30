// FILTER IN-PLAY — strip pre-game and post-game frames from a capture.
//
// A capture is only useful where in-play ODDS overlap an in-play SCORES clock.
// Pre-game odds (market churn before kickoff) and post-game odds (the sparse
// settling book after full-time) carry no events and poison every edge, so we
// keep ONLY frames inside the match's clock-running window.
//
// The window = the span of SCORES with Clock.Running near the odds capture time
// (the scores history can contain several re-airings; we take the one aligned
// with these odds). Odds and scores outside it are dropped. If almost no odds
// fall inside, the capture is pre/post-game only ⇒ flagged NOT VIABLE and left
// untouched so you can re-record it properly at kickoff.
//
//   node scripts/filter_inplay.mjs                 # report every capture
//   node scripts/filter_inplay.mjs 18172469        # specific fids
//   node scripts/filter_inplay.mjs --apply 18172469  # write the filtered file
//
// (No network — works purely on the local capture files.)

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const CAP = path.resolve(process.cwd(), "captures");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fidArgs = args.map(Number).filter(Boolean);

const NEAR_BEFORE_MS = 2 * 60 * 60_000; // clock-running scores up to 2h before first odds
const NEAR_AFTER_MS = 10 * 60_000;      // …to 10min after last odds count as "this airing"
const TAIL_GRACE_MS = 10 * 60_000;      // keep scores up to 10min past clock end (final whistle)
const MIN_VIABLE = 200;                 // fewer in-play odds than this ⇒ not a usable match

const iso = (t) => new Date(t).toISOString().slice(5, 19).replace("T", " ");
const fids = fidArgs.length
  ? fidArgs
  : readdirSync(CAP).filter((f) => f.endsWith(".json")).map((f) => Number(path.basename(f, ".json")));

for (const fid of fids) {
  const file = path.join(CAP, `${fid}.json`);
  let cap;
  try { cap = JSON.parse(readFileSync(file, "utf8")); } catch { console.error(`✗ ${fid}: no capture`); continue; }

  const odds = (cap.odds || []).map((o) => ({ o, ts: Number(o.Ts) })).filter((x) => x.ts).sort((a, b) => a.ts - b.ts);
  const scores = (cap.scores || []).map((s) => ({ s, ts: Number(s.Ts) })).filter((x) => x.ts);
  if (!odds.length) { console.log(`• ${fid} ${cap.p1} v ${cap.p2}: no odds`); continue; }

  const oMin = odds[0].ts, oMax = odds[odds.length - 1].ts;
  // clock-running scores belonging to THIS airing (near the odds capture window)
  const running = scores
    .filter((x) => x.s.Clock && x.s.Clock.Running && x.ts >= oMin - NEAR_BEFORE_MS && x.ts <= oMax + NEAR_AFTER_MS)
    .map((x) => x.ts)
    .sort((a, b) => a - b);

  console.log(`\n==== ${cap.p1} v ${cap.p2} (${fid}) ====`);
  console.log(`  odds Ts        : ${iso(oMin)} → ${iso(oMax)}  (${odds.length})`);
  if (!running.length) {
    console.log(`  in-play clock  : NONE overlaps these odds`);
    console.log(`  ⚠ NOT VIABLE — capture is entirely pre/post-game; re-record at kickoff. (left untouched)`);
    continue;
  }
  const tStart = running[0], tEnd = running[running.length - 1];
  const keepOdds = odds.filter((x) => x.ts >= tStart && x.ts <= tEnd).map((x) => x.o);
  const keepScores = scores.filter((x) => x.ts >= tStart && x.ts <= tEnd + TAIL_GRACE_MS).map((x) => x.s);
  const pre = odds.filter((x) => x.ts < tStart).length;
  const post = odds.filter((x) => x.ts > tEnd).length;

  console.log(`  in-play window : ${iso(tStart)} → ${iso(tEnd)}`);
  console.log(`  odds → pre:${pre}  in-play:${keepOdds.length}  post:${post}`);
  console.log(`  scores → ${scores.length} → ${keepScores.length} (this airing only)`);

  if (keepOdds.length < MIN_VIABLE) {
    console.log(`  ⚠ NOT VIABLE — only ${keepOdds.length} in-play odds; left untouched.`);
    continue;
  }
  if (APPLY) {
    writeFileSync(file, JSON.stringify({ fid, p1: cap.p1, p2: cap.p2, odds: keepOdds, scores: keepScores }));
    console.log(`  ✓ APPLIED — wrote ${keepOdds.length} odds + ${keepScores.length} scores`);
  } else {
    console.log(`  (dry run — pass --apply to write)`);
  }
}
console.log(APPLY ? "\nDone. Re-run scripts/import_replays.mjs to rebundle." : "\nDry run. Add --apply to write.");
