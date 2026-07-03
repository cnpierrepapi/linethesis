// /api/replay-frames — feed a RECORDED match back through the /live sandbox.
//
// /live is only alive during a real kickoff. To make the demo shootable 24/7, this serves
// one archived match's in-play, goals-market odds as a downsampled time-series the browser
// can play back on a virtual clock — feeding the SAME client-side classifier + policy the
// live path uses, so a replayed pickoff is detected identically to a live one.
//
//   GET /api/replay-frames                  -> { fixtures: [{ fid, label, frames }] }  (picker)
//   GET /api/replay-frames?fixtureId=<fid>  -> { fid, label, firstTs, lastTs, frames[], goals[] }
//
// Downsampled to ~1 frame / 2.5s per market (plus any large move), so the price PATH that
// triggers signals is preserved. ~1.8MB uncompressed of repetitive numbers → ~250KB gzipped.
import { NextResponse } from "next/server";
import { getReplays } from "@/lib/replays-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawFrame {
  FixtureId: number;
  Ts: number;
  SuperOddsType: string;
  MarketParameters: string;
  MarketPeriod: string;
  InRunning?: boolean;
  PriceNames: string[];
  Prices: number[];
}
interface RawScore {
  Ts: number;
  Score?: Record<string, unknown>;
  Clock?: { Seconds?: number };
}

// Goals for one participant, robust to both feed shapes seen in the wild:
//   Score.Participant1.Total.Goals   (participant-first — the captured/archived shape)
//   Score.Total.Participant1.Goals   (period-first — some snapshots)
function goalsOf(score: Record<string, unknown> | undefined, n: 1 | 2): number {
  if (!score) return 0;
  const part = score[`Participant${n}`] as { Total?: { Goals?: number } } | undefined;
  const pFirst = part?.Total?.Goals;
  if (pFirst != null) return Number(pFirst);
  const tot = score.Total as Record<string, { Goals?: number }> | undefined;
  const period = tot?.[`Participant${n}`]?.Goals;
  return period != null ? Number(period) : 0;
}
interface Match {
  fid: number | string;
  p1: string;
  p2: string;
  odds: RawFrame[];
  scores: RawScore[];
}

const SAMPLE_MS = 2_500;
// keep a frame off-cadence only on a LARGE move (still well below the 0.04 steam /
// 0.08 overreaction thresholds, so every signal-triggering swing survives the trim).
const MOVE_EPS = 0.02;

function fairProbs(prices: number[]): number[] {
  return prices.map((p) => (Number(p) > 0 ? Number((1000 / Number(p)).toFixed(4)) : 0));
}

export async function GET(req: Request) {
  const matches = (await getReplays()) as unknown as Match[];
  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId");

  if (!fixtureId) {
    // the picker: match list only
    const fixtures = matches
      .filter((m) => m.odds?.length)
      .map((m) => ({ fid: String(m.fid), label: `${m.p1} v ${m.p2}`, frames: m.odds.length }))
      .sort((a, b) => b.frames - a.frames);
    return NextResponse.json({ fixtures });
  }

  const m = matches.find((x) => String(x.fid) === String(fixtureId));
  if (!m) return NextResponse.json({ error: "unknown fixture" }, { status: 404 });

  // in-play goals markets only, chronological
  const goalsOdds = m.odds
    .filter((o) => /PARTICIPANT_GOALS/.test(o.SuperOddsType))
    .sort((a, b) => a.Ts - b.Ts);
  const firstTs = goalsOdds.length ? goalsOdds[0].Ts : 0;

  // downsample per market key: keep on a 2.5s cadence OR on a real move.
  const lastKept = new Map<string, { ts: number; probs: number[] }>();
  const frames = [];
  for (const o of goalsOdds) {
    const key = `${o.SuperOddsType}|${o.MarketParameters}|${o.MarketPeriod}`;
    const fp = fairProbs(o.Prices);
    const prev = lastKept.get(key);
    const moved =
      !prev ||
      o.Ts - prev.ts >= SAMPLE_MS ||
      fp.some((p, i) => Math.abs(p - (prev.probs[i] ?? p)) >= MOVE_EPS);
    if (!moved) continue;
    lastKept.set(key, { ts: o.Ts, probs: fp });
    frames.push({
      ts: o.Ts,
      market: o.SuperOddsType,
      line: String(o.MarketParameters ?? ""),
      period: String(o.MarketPeriod ?? ""),
      priceNames: o.PriceNames ?? [],
      fairProbs: fp,
    });
  }
  frames.sort((a, b) => a.ts - b.ts);

  // goal timeline: running-max goals with the ts at which each new goal appears.
  const goals: { ts: number; p1: number; p2: number }[] = [{ ts: firstTs, p1: 0, p2: 0 }];
  let p1 = 0;
  let p2 = 0;
  for (const s of m.scores.slice().sort((a, b) => a.Ts - b.Ts)) {
    if (!s.Score) continue;
    const n1 = Math.max(p1, goalsOf(s.Score, 1));
    const n2 = Math.max(p2, goalsOf(s.Score, 2));
    if (n1 > p1 || n2 > p2) {
      p1 = n1;
      p2 = n2;
      goals.push({ ts: s.Ts, p1, p2 });
    }
  }

  const lastTs = frames.length ? frames[frames.length - 1].ts : firstTs;
  return NextResponse.json({
    fid: String(m.fid),
    label: `${m.p1} v ${m.p2}`,
    firstTs,
    lastTs,
    frameCount: frames.length,
    goals,
    frames,
  });
}
