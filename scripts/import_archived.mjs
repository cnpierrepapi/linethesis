// IMPORT ARCHIVED — fold live-archived match blobs (desk-archives bucket, downloaded
// to a dir) into lib/replays.json, filtered to in-play and DOWNSAMPLED so the bundle
// stays lean. Raw archives are ~14-17MB each (full pre-game run-up + every rapid quote);
// the engine only needs the in-play window and detects moves over 60-90s, so keeping
// ~1 frame / 1.5s per market (plus every price change) preserves all signal at a
// fraction of the size. Merges with the existing replays (keeps the richer capture).
//
//   node scripts/import_archived.mjs [srcDir=captures_live]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import existing from "../lib/replays.json" with { type: "json" };

const SRC = path.resolve(process.cwd(), process.argv[2] || "captures_live");
const OUT = path.resolve(process.cwd(), "lib/replays.json");
const MIN_GAP_MS = 2500; // keep at most ~1 frame / 2.5s per market (still 36x finer than the 90s window)
const NEAR_BEFORE_MS = 2 * 60 * 60_000;
const NEAR_AFTER_MS = 10 * 60_000;
const TAIL_GRACE_MS = 10 * 60_000;
const MIN_VIABLE = 200;

const SLIM_ODDS = (r) => ({
  FixtureId: r.FixtureId, Ts: Number(r.Ts), SuperOddsType: r.SuperOddsType,
  MarketParameters: r.MarketParameters ?? null, MarketPeriod: r.MarketPeriod ?? null,
  InRunning: r.InRunning ?? true, PriceNames: r.PriceNames, Prices: r.Prices,
});
const SLIM_SCORE = (r) => ({
  FixtureId: r.FixtureId, Ts: Number(r.Ts), Clock: r.Clock ?? null, Score: r.Score ?? null, Action: r.Action ?? null,
});

// in-play window = span of clock-running scores near these odds (mirrors filter_inplay)
function inPlayWindow(odds, scores) {
  const oMin = odds[0].Ts, oMax = odds[odds.length - 1].Ts;
  const running = scores
    .filter((s) => s.Clock && s.Clock.Running && s.Ts >= oMin - NEAR_BEFORE_MS && s.Ts <= oMax + NEAR_AFTER_MS)
    .map((s) => s.Ts)
    .sort((a, b) => a - b);
  if (!running.length) return null;
  return { tStart: running[0], tEnd: running[running.length - 1] };
}

// Pure time-bucket per market+line: keep at most one frame per MIN_GAP_MS. The demargined
// book ticks every frame, so a price-change escape keeps everything; the engine only needs
// move resolution far coarser than 2.5s (steam window 90s, overreaction 150s), so bucketing
// preserves every detectable move. Signals are goals-scoped, so we also drop non-goals
// markets (1X2 etc.) the classifier never emits on.
function downsample(odds) {
  const lastTs = new Map();
  const out = [];
  for (const o of odds) {
    if (!/PARTICIPANT_GOALS/.test(String(o.SuperOddsType))) continue; // scope: goals markets only
    const key = `${o.SuperOddsType}|${o.MarketParameters}|${o.MarketPeriod}`;
    if (o.Ts - (lastTs.get(key) ?? -Infinity) < MIN_GAP_MS) continue;
    out.push(o);
    lastTs.set(key, o.Ts);
  }
  return out;
}

const byFid = new Map();
for (const m of existing) byFid.set(String(m.fid), m); // seed with what we already bundle

if (existsSync(SRC)) {
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith(".json")) continue;
    let raw;
    try { raw = JSON.parse(readFileSync(path.join(SRC, file), "utf8")); } catch { continue; }
    if (raw.fid == null || !Array.isArray(raw.odds)) continue;

    const odds = raw.odds
      .filter((o) => o && o.FixtureId != null && Array.isArray(o.Prices) && o.Prices.some((p) => Number(p) > 0))
      .map(SLIM_ODDS)
      .sort((a, b) => a.Ts - b.Ts);
    const scores = (raw.scores || []).filter((s) => s && s.FixtureId != null).map(SLIM_SCORE).sort((a, b) => a.Ts - b.Ts);
    if (!odds.length) continue;

    const win = inPlayWindow(odds, scores);
    if (!win) { console.log(`• ${raw.fid} ${raw.p1} v ${raw.p2}: no in-play clock — skipped`); continue; }
    const inPlay = odds.filter((o) => o.Ts >= win.tStart && o.Ts <= win.tEnd);
    if (inPlay.length < MIN_VIABLE) { console.log(`• ${raw.fid}: only ${inPlay.length} in-play odds — skipped`); continue; }
    const ds = downsample(inPlay);
    const keepScores = scores.filter((s) => s.Ts >= win.tStart && s.Ts <= win.tEnd + TAIL_GRACE_MS);

    const cur = byFid.get(String(raw.fid));
    if (cur && cur.odds.length >= ds.length) { console.log(`• ${raw.fid}: existing richer (${cur.odds.length}≥${ds.length}) — kept`); continue; }
    byFid.set(String(raw.fid), { fid: raw.fid, p1: raw.p1 ?? "Home", p2: raw.p2 ?? "Away", odds: ds, scores: keepScores });
    console.log(`✓ ${raw.fid} ${raw.p1} v ${raw.p2}: ${raw.odds.length} raw → ${inPlay.length} in-play → ${ds.length} downsampled (${keepScores.length} scores)`);
  }
}

const matches = [...byFid.values()].sort((a, b) => b.odds.length - a.odds.length);
writeFileSync(OUT, JSON.stringify(matches));
const kb = (JSON.stringify(matches).length / 1024 / 1024).toFixed(1);
console.log(`\nWrote ${matches.length} matches → lib/replays.json (${kb} MB)`);
for (const m of matches) console.log(`  ${m.fid}  ${m.p1} v ${m.p2}  —  ${m.odds.length} odds, ${m.scores.length} scores`);
