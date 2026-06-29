// RECORD ODDS — capture a LIVE TxLINE odds stream to captures/{fid}.json.
//
// Odds history is gated on TxLINE (/api/odds/updates is empty), so the
// demargined book MUST be recorded live as a match plays. Scores ARE served
// historically, so those are backfilled from /api/scores/updates at flush time.
// Output → captures/{fid}.json = { fid, p1, p2, odds:[…], scores:[…] }, which
// scripts/import_replays.mjs bundles into lib/replays.json.
//
// Self-contained: uses ONLY the env-supplied apiToken (the same token the app
// reads) over fetch — no Anchor, no keypair, no external workspace. Run during a
// live World Cup match:
//   node --env-file=.env.local scripts/record_odds.mjs           # all live fixtures
//   node --env-file=.env.local scripts/record_odds.mjs 18172469  # specific fids
//
// Env: TXLINE_API_BASE, TXLINE_JWT, TXLINE_API_TOKEN.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
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
mkdirSync(OUT, { recursive: true });

const argFids = process.argv.slice(2).map(Number).filter(Boolean);
const only = argFids.length ? new Set(argFids) : null;

// Keep only the fields the edge engine / replay feed consume.
const SLIM_ODDS = (r) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Bookmaker: r.Bookmaker, SuperOddsType: r.SuperOddsType,
  MarketParameters: r.MarketParameters, MarketPeriod: r.MarketPeriod, InRunning: r.InRunning,
  PriceNames: r.PriceNames, Prices: r.Prices,
});
const SLIM_SCORE = (r) => ({ FixtureId: r.FixtureId, Ts: r.Ts, Clock: r.Clock, Score: r.Score, Action: r.Action });

// Minimal SSE event parser (data: lines accumulate; heartbeats carry no data).
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

// /api/scores/updates returns SSE-framed text — pull the JSON records out.
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

// team names from the fixtures snapshot
const snap = await (await fetch(`${apiBase}/api/fixtures/snapshot`, { headers })).json();
const meta = new Map();
for (const f of Array.isArray(snap) ? snap : snap.fixtures || []) {
  meta.set(f.FixtureId, { p1: f.Participant1, p2: f.Participant2 });
}

const oddsBuf = new Map(); // fid -> odds[]

async function flush() {
  let wrote = 0;
  for (const [fid, odds] of oddsBuf) {
    if (odds.length < 50) continue;
    let scores = [];
    try {
      const text = await (await fetch(`${apiBase}/api/scores/updates/${fid}`, { headers })).text();
      scores = parseUpdates(text).map(SLIM_SCORE);
    } catch {}
    writeFileSync(path.join(OUT, `${fid}.json`), JSON.stringify({ fid, ...(meta.get(fid) || {}), odds, scores }));
    wrote++;
  }
  console.log(`[flush] ${wrote} fixture(s) saved → captures/ · tracking ${oddsBuf.size}`);
}

console.log(`Recording LIVE odds from ${apiBase}${only ? ` (fids ${[...only].join(",")})` : ""} … (Ctrl-C to save & exit)`);
process.on("SIGINT", async () => { await flush(); console.log("Saved. Bye."); process.exit(0); });
const timer = setInterval(() => { flush().catch((e) => console.error("flush err", e.message)); }, 30_000);

const res = await fetch(`${apiBase}/api/odds/stream`, {
  headers: { ...headers, Accept: "text/event-stream", "Cache-Control": "no-cache" },
});
if (!res.ok || !res.body) {
  console.error(`odds stream ${res.status}: ${await res.text().catch(() => "")}`);
  clearInterval(timer);
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
try {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const ev = parseSse(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      const r = ev.json;
      if (!r || ev.event === "heartbeat" || r.FixtureId == null || r.Bookmaker !== DEMARGINED_BOOK) continue;
      if (only && !only.has(r.FixtureId)) continue;
      if (!oddsBuf.has(r.FixtureId)) oddsBuf.set(r.FixtureId, []);
      oddsBuf.get(r.FixtureId).push(SLIM_ODDS(r));
    }
  }
} catch (e) {
  console.error("stream ended:", e.message);
} finally {
  clearInterval(timer);
  await flush();
}
