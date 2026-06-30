// RECORD ODDS — capture LIVE TxLINE odds to captures/{fid}.json, KICKOFF-AWARE.
//
// Odds history is gated on TxLINE (/api/odds/updates is empty), so the
// demargined book MUST be recorded live. Scores ARE served historically and are
// backfilled from /api/scores/updates when a match finalizes (or later via
// scripts/backfill_scores.mjs).
//
// WHY THIS IS A STATE MACHINE, NOT A DUMB TAP
//   Each fixture AIRS on a schedule. For hours before kickoff the book streams
//   PRE-GAME odds that carry no in-play dynamics — sometimes a trickle, sometimes
//   (on the dev replay) a fast churn. Either way they'd only pad the file. The
//   book ACCELERATES toward kickoff, so per fixture we:
//     • HOLD   — far from kickoff: monitor only, buffer nothing.
//     • ARM    — book accelerates (>= ACCEL_PER_MIN) AND we're within LEAD_WINDOW
//                of StartTime: start buffering the run-up (rolling window so
//                pre-kickoff churn can't grow unbounded).
//     • inPlay — CONFIRMED by the SCORES stream clock (Clock.Running). This is the
//                ONLY trustworthy in-play signal: GameState and the odds
//                InRunning flag are both wrong on this feed (a real in-play match
//                streams GameState 'scheduled' / InRunning false).
//     • FINAL  — went in-play AND the book goes idle (match over): backfill
//                scores, write, freeze.
//   Armed but the clock never starts ⇒ STAND DOWN and discard (it was pre-game).
//
//   ⚠️ DEVNET CAVEAT: the replay's airing time is decoupled from the nominal
//   StartTime, so a match may air in-play far from its scheduled kickoff. There
//   the StartTime gate can miss it; raise LEAD_MIN or pass an explicit fid window.
//   On MAINNET (real matches) StartTime is accurate and this gating is correct.
//
// RESILIENT: both SSE sockets reconnect with backoff; a drop never ends a capture.
//
//   node --env-file=.env.local scripts/record_odds.mjs            # all fixtures
//   node --env-file=.env.local scripts/record_odds.mjs 18175397   # specific fids
//   LEAD_MIN=120 node --env-file=.env.local scripts/record_odds.mjs <fid>  # wider arm window
//
// Env: TXLINE_API_BASE, TXLINE_JWT, TXLINE_API_TOKEN.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const apiBase = process.env.TXLINE_API_BASE;
const jwt = process.env.TXLINE_JWT;
const apiToken = process.env.TXLINE_API_TOKEN;
if (!apiBase || !jwt || !apiToken) {
  console.error("Missing TXLINE_API_BASE / TXLINE_JWT / TXLINE_API_TOKEN (use --env-file=.env.local).");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken };

const DEMARGINED_BOOK = "TXLineStablePriceDemargined";
const OUT = path.resolve(process.cwd(), "captures");
await mkdir(OUT, { recursive: true });

// --- tunables ---------------------------------------------------------------
const LEAD_WINDOW_MS = (Number(process.env.LEAD_MIN) || 30) * 60_000; // arm this long before kickoff
const RATE_WINDOW_MS = 60_000;          // window for the frames/min rate
const ACCEL_PER_MIN = 18;               // book rate that signals the run-up (pre-game trickle is ~2–6/min)
const RUNUP_KEEP_MS = 30 * 60_000;      // pre-inPlay rolling buffer kept (bounds churn)
const IDLE_END_MS = 8 * 60_000;         // in-play book silent this long ⇒ match over
const MAX_ARMED_NO_INPLAY_MS = 45 * 60_000; // armed this long w/o clock ⇒ stand down (pre-game)
const POSTGAME_GRACE_MS = 5 * 60_000;   // clock stopped this long ⇒ match over (ignore settling book)
const MIN_ODDS = 200;                   // don't write a stub book
const TICK_MS = 30_000;

const argFids = process.argv.slice(2).map(Number).filter(Boolean);
const only = argFids.length ? new Set(argFids) : null;

// Keep only the fields the edge engine / replay feed consume.
const SLIM_ODDS = (r) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Bookmaker: r.Bookmaker, SuperOddsType: r.SuperOddsType,
  MarketParameters: r.MarketParameters, MarketPeriod: r.MarketPeriod, InRunning: r.InRunning,
  PriceNames: r.PriceNames, Prices: r.Prices,
});
const SLIM_SCORE = (r) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Clock: r.Clock, GameState: r.GameState, Score: r.Score, Action: r.Action,
});

function parseSse(raw) {
  const out = { event: "message", data: "" };
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    let val = i === -1 ? "" : line.slice(i + 1);
    if (val.startsWith(" ")) val = val.slice(1);
    if (field === "data") out.data += (out.data ? "\n" : "") + val;
    else if (field === "event") out.event = val;
  }
  if (!out.data) return out;
  try { out.json = JSON.parse(out.data); } catch {}
  return out;
}

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

// StartTime in the snapshot is epoch-MILLIS (a number), occasionally an ISO
// string — handle both (Date.parse(number) is NaN, which was the old bug).
function parseStart(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const p = Date.parse(v);
  return Number.isNaN(p) ? null : p;
}

const snap = await (await fetch(`${apiBase}/api/fixtures/snapshot`, { headers })).json();
const meta = new Map();
for (const f of Array.isArray(snap) ? snap : snap.fixtures || []) {
  meta.set(f.FixtureId, { p1: f.Participant1, p2: f.Participant2, startTime: parseStart(f.StartTime) });
}

// --- per-fixture state ------------------------------------------------------
// phase: "hold" | "armed" | "final"
const state = new Map();
function initState(fid) {
  const m = meta.get(fid) || {};
  const st = {
    fid, p1: m.p1 ?? "Home", p2: m.p2 ?? "Away", startTime: m.startTime ?? null,
    phase: "hold", odds: [], arrivals: [], lastFrameAt: 0, armedAt: 0, inPlay: false, clockSec: null, lastClockRunAt: 0,
  };
  state.set(fid, st);
  return st;
}
for (const [fid] of meta) if (!only || only.has(fid)) initState(fid);

function rate(st, now) {
  while (st.arrivals.length && now - st.arrivals[0] > RATE_WINDOW_MS) st.arrivals.shift();
  return st.arrivals.length;
}
const minsToKick = (st, now) => (st.startTime == null ? null : (st.startTime - now) / 60_000);
const nearKickoff = (st, now) => st.startTime == null || now >= st.startTime - LEAD_WINDOW_MS;

// ODDS frame
function onOdds(r) {
  if (r.Bookmaker !== DEMARGINED_BOOK) return;
  const fid = r.FixtureId;
  if (only && !only.has(fid)) return;
  const st = state.get(fid) || initState(fid);
  if (st.phase === "final") return;
  const now = Date.now();
  st.arrivals.push(now);
  st.lastFrameAt = now;

  if (st.phase === "hold" && rate(st, now) >= ACCEL_PER_MIN && nearKickoff(st, now)) {
    st.phase = "armed";
    st.armedAt = now;
    const mk = minsToKick(st, now);
    console.log(`[ARM] ${fid} ${st.p1} v ${st.p2} — book ${rate(st, now)}/min${mk == null ? "" : `, kickoff ${mk > 0 ? "in " + mk.toFixed(0) + "m" : "reached"}`}`);
  }

  if (st.phase === "armed") {
    // match over: the clock stopped a while ago ⇒ ignore the sparse post-game
    // settling book (it's as useless as pre-game — no events, prices collapsing).
    if (st.inPlay && st.lastClockRunAt && now - st.lastClockRunAt > POSTGAME_GRACE_MS) return;
    st.odds.push(SLIM_ODDS(r));
    if (!st.inPlay) {
      // rolling run-up window: drop pre-kickoff frames older than RUNUP_KEEP_MS
      const cut = now - RUNUP_KEEP_MS;
      while (st.odds.length && Number(st.odds[0].Ts) < cut) st.odds.shift();
    }
  }
}

// SCORES frame — the authoritative in-play gate
function onScore(r) {
  const fid = r.FixtureId;
  if (only && !only.has(fid)) return;
  const st = state.get(fid) || initState(fid);
  if (st.phase === "final") return;
  if (r.Clock && r.Clock.Running === true) {
    st.clockSec = r.Clock.Seconds ?? st.clockSec;
    st.lastClockRunAt = Date.now();
    if (!st.inPlay) {
      st.inPlay = true;
      if (st.phase === "hold") { st.phase = "armed"; st.armedAt = Date.now(); } // clock beat the book
      console.log(`[IN-PLAY] ${fid} ${st.p1} v ${st.p2} — clock running @ ${st.clockSec}s`);
    }
  }
}

async function writeCapture(st, scores) {
  await writeFile(
    path.join(OUT, `${st.fid}.json`),
    JSON.stringify({ fid: st.fid, p1: st.p1, p2: st.p2, odds: st.odds, scores: scores ?? [] }),
  );
}
async function finalize(st) {
  let scores = [];
  try {
    const text = await (await fetch(`${apiBase}/api/scores/updates/${st.fid}`, { headers })).text();
    scores = parseUpdates(text).map(SLIM_SCORE);
  } catch (e) { console.error(`  score backfill ${st.fid} failed: ${e.message}`); }
  await writeCapture(st, scores);
  st.phase = "final";
  console.log(`[FINAL] ${st.fid} ${st.p1} v ${st.p2} — ${st.odds.length} odds + ${scores.length} scores`);
}

let running = true;
let ticks = 0;
async function tick() {
  const now = Date.now();
  ticks++;
  const writes = [];
  for (const st of state.values()) {
    if (st.phase === "final") continue;
    const mk = minsToKick(st, now);

    if (st.phase === "armed") {
      const idle = st.lastFrameAt ? now - st.lastFrameAt : Infinity;
      const sinceClock = st.lastClockRunAt ? now - st.lastClockRunAt : Infinity;
      // match over = book idle OR the clock has been stopped past the grace window
      if (st.inPlay && st.odds.length >= MIN_ODDS && (idle > IDLE_END_MS || sinceClock > POSTGAME_GRACE_MS)) { await finalize(st); continue; }
      if (!st.inPlay && now - st.armedAt > MAX_ARMED_NO_INPLAY_MS) {
        console.log(`[STAND-DOWN] ${st.fid} ${st.p1} v ${st.p2} — clock never started; discarding ${st.odds.length} pre-game frames`);
        st.phase = "hold"; st.odds = []; st.armedAt = 0;
        continue;
      }
      if (st.inPlay && st.odds.length >= MIN_ODDS) writes.push(writeCapture(st)); // crash-safe progress (in-play only)
      console.log(`  · ${st.fid} ${st.p1} v ${st.p2}: ${st.inPlay ? `IN-PLAY @${st.clockSec}s` : "run-up(pre-game)"} ${st.odds.length} odds (${rate(st, now)}/min)`);
    } else if (st.phase === "hold" && ticks % 10 === 1) {
      const when = mk == null ? "no StartTime" : mk > 0 ? `kickoff in ${(mk / 60).toFixed(1)}h` : "past start, awaiting airing";
      console.log(`  · ${st.fid} ${st.p1} v ${st.p2}: holding — ${when} (${rate(st, now)}/min)`);
    }
  }
  await Promise.all(writes);
  if (only && [...state.values()].every((s) => s.phase === "final")) {
    console.log("All targeted fixtures finalized. Done.");
    stop();
  }
}

// --- streams: two concurrent reconnecting SSE loops -------------------------
const controllers = new Set();
function stop() { running = false; for (const c of controllers) c.abort(); }
process.on("SIGINT", () => { console.log("\nStopping…"); stop(); });

async function streamOnce(streamPath, onRecord) {
  const ac = new AbortController();
  controllers.add(ac);
  try {
    const res = await fetch(`${apiBase}${streamPath}`, {
      headers: { ...headers, Accept: "text/event-stream", "Cache-Control": "no-cache" },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`${streamPath} ${res.status}: ${await res.text().catch(() => "")}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let frames = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const ev = parseSse(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        const r = ev.json;
        if (!r || ev.event === "heartbeat" || r.FixtureId == null) continue;
        onRecord(r);
        frames++;
      }
    }
    return frames;
  } finally {
    controllers.delete(ac);
  }
}

async function connectLoop(streamPath, onRecord) {
  let backoff = 1000;
  const MAX = 15000;
  while (running) {
    try {
      const frames = await streamOnce(streamPath, onRecord);
      if (frames > 0) backoff = 1000;
      if (running) console.log(`[reconnect ${streamPath}] closed after ${frames} frame(s); retry ${backoff / 1000}s`);
    } catch (e) {
      if (!running) break;
      console.error(`[reconnect ${streamPath}] ${e.message}; retry ${backoff / 1000}s`);
    }
    if (!running) break;
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, MAX);
  }
}

const targets = only ? `(fids ${[...only].join(",")})` : "(all fixtures)";
console.log(`Kickoff-aware recorder on ${apiBase} ${targets} … (Ctrl-C to save & exit)`);
for (const st of state.values()) {
  const mk = minsToKick(st, Date.now());
  console.log(`  seeded ${st.fid} ${st.p1} v ${st.p2}${mk == null ? " — no StartTime" : mk > 0 ? ` — kickoff in ${(mk / 60).toFixed(1)}h` : " — past start"}`);
}

const timer = setInterval(() => { tick().catch((e) => console.error("tick err", e.message)); }, TICK_MS);

await Promise.all([
  connectLoop("/api/odds/stream", onOdds),
  connectLoop("/api/scores/stream", onScore),
]);

clearInterval(timer);
for (const st of state.values()) {
  if (st.phase === "armed" && st.inPlay && st.odds.length >= MIN_ODDS) await finalize(st);
}
console.log("Saved. Bye.");
process.exit(0);
