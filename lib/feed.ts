// FEED — the single upstream that powers the engine.
//
// Three sources:
//   • "replay" — REAL TxLINE matches that were captured live (odds history is
//                gated upstream, so the demargined book is recorded off the SSE
//                while the match plays), bundled into lib/replays.json and
//                replayed through the engine. All captured matches run AT ONCE
//                on one accelerated, looping timeline so the demo always shows
//                agents ingesting real data and trading fake-USD on it.
//   • "live"   — the real TxLINE odds + scores SSE streams (token held in env).
//   • "synth"  — a deterministic, seeded generator (steam jumps + a scripted
//                goal) for a self-contained demo with no data dependency.
//
// Default is replay if captures exist, else synth. live needs FEED_MODE=live +
// a token. One engine per process, stashed on globalThis so Next's HMR / route
// re-entry reuse it.

import { EdgeEngine } from "./edge/engine.mjs";
import { openStream, txlineCreds } from "./txline/stream";
import type { Edge } from "./edge/types";
import replaysData from "./replays.json";

export type FeedMode = "synth" | "live" | "replay";
export type FeedStatus = "idle" | "starting" | "live" | "error";

interface ReplayRecord {
  FixtureId: string | number;
  Ts: number;
  [k: string]: unknown;
}
interface ReplayMatch {
  fid: string | number;
  p1: string;
  p2: string;
  odds: ReplayRecord[];
  scores: ReplayRecord[];
}
const REPLAYS = replaysData as unknown as ReplayMatch[];

// Per-match ingestion tally — the provenance proof ("we ingested this data").
export interface MatchProvenance {
  fid: string;
  label: string;
  oddsFrames: number;
  scoreFrames: number;
  ingested: number; // frames actually fed so far (this run)
}

export interface EngineLike {
  on(ev: "edge" | "edgeClosed", cb: (e: Edge) => void): void;
  on(ev: "matchEvent", cb: (e: { fixtureId: string | number; label: string; ts: number }) => void): void;
  ingestOdds(rec: Record<string, unknown>): void;
  ingestScores(rec: Record<string, unknown>): void;
  stake(id: string, amt: number): { ok: boolean; accepted?: number; remaining?: number; reason?: string };
  openEdges(): Edge[];
  fairProbForMarket(meta: unknown): number | null;
  matchMinute(fid: string | number): number | null;
}

export interface FeedHandle {
  engine: EngineLike;
  mode: FeedMode;
  status: FeedStatus;
  startedAt: number;
  error?: string;
  labels: Map<string, string>; // fixtureId -> "P1 v P2"
  provenance: Map<string, MatchProvenance>; // fixtureId -> ingestion tally
}

const SYNTH_OPTS = {
  steamThreshold: 0.04,
  steamWindowMs: 8_000,
  overreactionThreshold: 0.08,
  overreactionWindowMs: 25_000,
  historyMs: 60_000,
  edgeTtlMs: 25_000,
  edgeCooldownMs: 12_000,
};

// REPLAY tuning. Detection windows/thresholds are in MATCH time (the engine reads
// them against each record's Ts, which we preserve from the capture). Real books
// move less cleanly than synth, so thresholds are lower. TTL/cooldown are WALL
// time (the engine uses Date.now for edge lifecycle) — kept short because the
// runner stakes synchronously the instant an edge fires.
const REPLAY_OPTS = {
  steamThreshold: 0.015, // 1.5pp fair-prob move (calibrated to real in-play books)…
  steamWindowMs: 90_000, // …within 90s of match time
  overreactionThreshold: 0.03, // 3pp post-event swing
  overreactionWindowMs: 150_000,
  quoteThreshold: 0.005, // baseline: ≥0.5pp drift surfaces a tradeable "quote"
  quoteWindowMs: 60_000,
  historyMs: 300_000,
  edgeTtlMs: 8_000, // wall: stake window
  edgeCooldownMs: 6_000, // wall: re-fire spacing per market+kind
};

// ---- deterministic PRNG (mulberry32) -----------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SynthFixture {
  id: string;
  p1: string;
  p2: string;
  pOver: number;
  seconds: number;
  goals1: number;
  goals2: number;
  reds1: number;
  reds2: number;
  momDir: number; // steam continuation: +1/-1 for a few ticks after a jump
  momTicks: number;
  revPer: number; // event reversion: per-tick drift back after an overshoot
  revTicks: number;
}

function emitOdds(engine: EngineLike, f: SynthFixture) {
  engine.ingestOdds({
    Ts: Date.now(),
    FixtureId: f.id,
    SuperOddsType: "OVERUNDER",
    MarketParameters: "2.5",
    MarketPeriod: "FT",
    InRunning: true,
    PriceNames: ["Over", "Under"],
    Prices: [Math.round(1000 / f.pOver), Math.round(1000 / (1 - f.pOver))],
  });
}

function emitScores(engine: EngineLike, f: SynthFixture, action: string) {
  engine.ingestScores({
    Ts: Date.now(),
    FixtureId: f.id,
    Action: action,
    Clock: { Seconds: f.seconds },
    GameState: "InPlay",
    Score: {
      Participant1: { Total: { Goals: f.goals1, RedCards: f.reds1 } },
      Participant2: { Total: { Goals: f.goals2, RedCards: f.reds2 } },
    },
  });
}

function startSynth(engine: EngineLike, labels: Map<string, string>): void {
  const rng = mulberry32(0x9e3779b9);
  const fx: SynthFixture[] = [
    { id: "SYN-1", p1: "Brazil", p2: "Serbia", pOver: 0.52, seconds: 0, goals1: 0, goals2: 0, reds1: 0, reds2: 0, momDir: 0, momTicks: 0, revPer: 0, revTicks: 0 },
    { id: "SYN-2", p1: "Spain", p2: "Japan", pOver: 0.48, seconds: 0, goals1: 0, goals2: 0, reds1: 0, reds2: 0, momDir: 0, momTicks: 0, revPer: 0, revTicks: 0 },
  ];
  for (const f of fx) {
    labels.set(f.id, `${f.p1} v ${f.p2}`);
    emitScores(engine, f, "kickoff"); // seed prevTotals so deltas are detectable
  }

  // Each fixture demonstrates ONE thesis cleanly so the edges have real,
  // legible expectancy (continuation/reversion span the full 8-tick hold):
  //   • SYN-1 = STEAM — periodic sharp jumps that KEEP GOING → following pays.
  //   • SYN-2 = OVERREACTION — goals/red cards overshoot then REVERT → fading pays.
  const [steamFx, overFx] = fx;
  let tick = 0;
  const iv = setInterval(() => {
    tick++;
    for (const f of fx) {
      f.seconds += 45;
      f.pOver += (rng() - 0.5) * 0.004; // tiny base noise
    }

    // --- SYN-1: steam every 9 ticks (> the 8-tick cooldown), then continue ---
    if (tick % 9 === 0) {
      const dir = rng() < 0.5 ? -1 : 1;
      steamFx.pOver += dir * 0.06; // the jump fires the steam edge
      steamFx.momDir = dir;
      steamFx.momTicks = 8; // continuation spans the whole hold window
    }
    if (steamFx.momTicks > 0) {
      steamFx.pOver += steamFx.momDir * 0.009;
      steamFx.momTicks -= 1;
    }

    // --- SYN-2: recurring goals / red cards, each overshoot then reverts ---
    if (tick >= 8 && (tick - 8) % 16 === 0) {
      overFx.goals1 += 1;
      overFx.pOver = Math.min(0.9, overFx.pOver + 0.13);
      overFx.revPer = -0.013; // revert down → fading the over-spike pays
      overFx.revTicks = 8;
      emitScores(engine, overFx, "goal");
    }
    if (tick >= 16 && (tick - 16) % 16 === 0) {
      overFx.reds2 += 1;
      overFx.pOver = Math.max(0.1, overFx.pOver - 0.12);
      overFx.revPer = 0.012; // revert up → fading the under-spike pays
      overFx.revTicks = 8;
      emitScores(engine, overFx, "red_card");
    }
    if (overFx.revTicks > 0) {
      overFx.pOver += overFx.revPer;
      overFx.revTicks -= 1;
    }

    for (const f of fx) {
      f.pOver = Math.min(0.92, Math.max(0.08, f.pOver));
      emitOdds(engine, f);
      emitScores(engine, f, "tick");
    }
  }, 1500);
  iv.unref?.();
}

function startLive(engine: EngineLike, handle: FeedHandle): void {
  const creds = txlineCreds();
  if (!creds) {
    handle.status = "error";
    handle.error = "no TxLINE token in env (TXLINE_API_BASE/JWT/API_TOKEN)";
    return;
  }
  const run = async (path: string, kind: "odds" | "scores", ingest: (rec: Record<string, unknown>) => void) => {
    for (;;) {
      try {
        handle.status = "live";
        await openStream(path, creds, (ev) => {
          if (ev.event === "heartbeat" || !ev.json) return;
          const recs = Array.isArray(ev.json) ? ev.json : [ev.json];
          for (const r of recs) {
            const rec = r as Record<string, unknown>;
            ingest(rec);
            tallyLive(handle, rec, kind); // count REAL ingested frames (replay does this in startReplay)
          }
        });
      } catch (err) {
        handle.error = String(err);
        handle.status = "error";
      }
      await new Promise((r) => setTimeout(r, 2000)); // reconnect
    }
  };
  void run("/api/odds/stream", "odds", (r) => engine.ingestOdds(r));
  void run("/api/scores/stream", "scores", (r) => engine.ingestScores(r));
}

// Per-fixture ingestion tally for LIVE mode — without this `totalIngested` stays
// 0 (it was only populated by startReplay), which made the health check read a
// busy live feed as "0 frames / stale". Also best-effort-labels the fixture from
// participant names on the record so the desk shows teams, not a raw id.
function tallyLive(handle: FeedHandle, rec: Record<string, unknown>, kind: "odds" | "scores"): void {
  const fid = String(rec.FixtureId ?? rec.fixtureId ?? "?");
  if (fid === "?") return;
  if (!handle.labels.has(fid)) {
    const p1 = rec.Participant1Name ?? rec.HomeName ?? rec.Home ?? rec.Participant1;
    const p2 = rec.Participant2Name ?? rec.AwayName ?? rec.Away ?? rec.Participant2;
    if (typeof p1 === "string" && typeof p2 === "string") handle.labels.set(fid, `${p1} v ${p2}`);
  }
  let prov = handle.provenance.get(fid);
  if (!prov) {
    prov = { fid, label: handle.labels.get(fid) || `#${fid}`, oddsFrames: 0, scoreFrames: 0, ingested: 0 };
    handle.provenance.set(fid, prov);
  } else if (prov.label.startsWith("#") && handle.labels.has(fid)) {
    prov.label = handle.labels.get(fid)!; // upgrade id → names once known
  }
  prov.ingested += 1;
  if (kind === "odds") prov.oddsFrames += 1;
  else prov.scoreFrames += 1;
}

// ---- replay: all captured real matches at once, looping ----------------
interface ReplayEvent {
  offset: number; // ms from this match's first odds frame
  kind: "odds" | "scores";
  rec: ReplayRecord;
  prov: MatchProvenance;
}

function startReplay(engine: EngineLike, handle: FeedHandle): void {
  const events: ReplayEvent[] = [];

  for (const m of REPLAYS) {
    if (!m.odds?.length) continue;
    const fid = String(m.fid);
    const label = `${m.p1} v ${m.p2}`;
    handle.labels.set(fid, label);
    const prov: MatchProvenance = { fid, label, oddsFrames: m.odds.length, scoreFrames: m.scores.length, ingested: 0 };
    handle.provenance.set(fid, prov);

    // Anchor the timeline to the in-play odds window; drop stale pre-match
    // coverage records (their Ts can be days before kickoff).
    const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
    const windowStart = firstOdds - 5 * 60_000;
    const push = (rec: ReplayRecord, kind: "odds" | "scores") => {
      if (rec.Ts < windowStart) return;
      events.push({ offset: rec.Ts - firstOdds, kind, rec, prov });
    };
    for (const o of m.odds) push(o, "odds");
    for (const s of m.scores) push(s, "scores");
  }

  events.sort((a, b) => a.offset - b.offset);
  if (!events.length) {
    handle.status = "error";
    handle.error = "no replay data bundled (run scripts/import_replays.mjs)";
    return;
  }

  const SPEED = Number(process.env.REPLAY_SPEED) || 30; // match-seconds per wall-second
  const span = events[events.length - 1].offset; // match-ms of the longest timeline
  const LOOP_GAP = 90_000; // match-ms of quiet between loops
  const loopLen = span + LOOP_GAP;

  const t0wall = Date.now();
  const t0virtual = Date.now(); // virtual match clock base (monotonic across loops)
  let i = 0;
  let loop = 0;

  const tick = () => {
    const matchElapsed = (Date.now() - t0wall) * SPEED; // total match-ms since start
    let guard = 0;
    for (;;) {
      if (i >= events.length) {
        i = 0;
        loop += 1;
      }
      const e = events[i];
      const absOffset = loop * loopLen + e.offset;
      if (absOffset > matchElapsed) break;
      // Rewrite Ts onto the monotonic virtual timeline so the engine's match-time
      // windows stay correct and self-trim across loops.
      const rec = { ...e.rec, Ts: t0virtual + absOffset };
      if (e.kind === "odds") engine.ingestOdds(rec);
      else engine.ingestScores(rec);
      e.prov.ingested += 1;
      i += 1;
      if (++guard > 4000) break; // batch cap per tick
    }
  };

  const iv = setInterval(tick, 200);
  (iv as { unref?: () => void }).unref?.();
}

// ---- singleton ---------------------------------------------------------
const KEY = "__agenthesis_feed__";

export function getFeed(): FeedHandle {
  const g = globalThis as unknown as Record<string, FeedHandle | undefined>;
  if (g[KEY]) return g[KEY]!;

  // Mode resolution: explicit FEED_MODE wins; otherwise prefer real captured
  // matches (replay) when bundled, else fall back to synth.
  const want = process.env.FEED_MODE as FeedMode | undefined;
  const hasCaptures = REPLAYS.length > 0;
  let mode: FeedMode;
  if (want === "live" && txlineCreds()) mode = "live";
  else if (want === "synth") mode = "synth";
  else if (want === "replay" || hasCaptures) mode = "replay";
  else mode = "synth";

  const opts = mode === "synth" ? SYNTH_OPTS : mode === "replay" ? REPLAY_OPTS : {};
  const engine = new EdgeEngine(opts) as unknown as EngineLike;

  const handle: FeedHandle = {
    engine,
    mode,
    status: "starting",
    startedAt: Date.now(),
    labels: new Map(),
    provenance: new Map(),
  };

  if (mode === "synth") startSynth(engine, handle.labels);
  else if (mode === "replay") startReplay(engine, handle);
  else startLive(engine, handle);
  handle.status = "live";

  g[KEY] = handle;
  return handle;
}
