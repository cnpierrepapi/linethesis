// /api/live-signals — live odds + goals + minute per in-play fixture, for the /test
// live line-integrity page. Same snapshot-poll trick as /api/live-frames (serverless
// can't hold an SSE open), but it also returns the current goal counts and match minute
// so the browser-side detector can mark overreaction windows (goal → overshoot → fade).
// The classifier + naive book run in the browser, which holds history across polls.
import { NextResponse } from "next/server";
import { txlineCreds } from "@/lib/txline/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const FRESH_MS = 240_000; // the demargined feed is bursty (silent up to ~3min); don't drop a live match early
const MAX_FIXTURES = 6;

interface FrameOut {
  market: string;
  line: string;
  period: string;
  priceNames: string[];
  fairProbs: number[];
  ts: number;
  ageSec: number;
}
interface FixtureOut {
  fid: number | string;
  label: string;
  minute: number | null;
  goals: { p1: number; p2: number };
  latestAgeSec: number;
  frames: FrameOut[];
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Running-max goals + latest minute from the scores snapshot (latest record per action
// type). Max is robust to sparse frames; a VAR-disallowed goal can briefly inflate it
// (acceptable for a live view — the odds tell the real story).
function readScores(recs: Array<Record<string, unknown>>): { p1: number; p2: number; minute: number | null } {
  let p1 = 0;
  let p2 = 0;
  let minute: number | null = null;
  let clockTs = -1;
  for (const r of recs) {
    const total = (r.Score as { Total?: { Participant1?: { Goals?: number }; Participant2?: { Goals?: number } } })?.Total;
    if (total) {
      p1 = Math.max(p1, Number(total.Participant1?.Goals ?? 0));
      p2 = Math.max(p2, Number(total.Participant2?.Goals ?? 0));
    }
    const clock = r.Clock as { Seconds?: number } | undefined;
    if (clock?.Seconds != null && Number(r.Ts) > clockTs) {
      clockTs = Number(r.Ts);
      minute = Math.floor(Number(clock.Seconds) / 60);
    }
  }
  return { p1, p2, minute };
}

export async function GET() {
  const creds = txlineCreds();
  if (!creds) return NextResponse.json({ configured: false, note: "no TxLINE token in env (live signals unavailable)" });
  const headers = { Authorization: `Bearer ${creds.jwt}`, "X-Api-Token": creds.apiToken };
  const now = Date.now();

  const snap = await getJson(`${creds.apiBase}/api/fixtures/snapshot`, headers);
  const fixtures = (Array.isArray(snap) ? snap : ((snap as { fixtures?: unknown[] })?.fixtures ?? [])) as Array<
    Record<string, unknown>
  >;
  const candidates = fixtures
    .map((f) => ({
      fid: f.FixtureId as number,
      label: `${f.Participant1 ?? "Home"} v ${f.Participant2 ?? "Away"}`,
      start: Number(f.StartTime) || 0,
    }))
    .filter((f) => f.fid != null && f.start && f.start <= now && now - f.start <= LIVE_WINDOW_MS)
    .slice(0, MAX_FIXTURES + 4);

  const results = await Promise.all(
    candidates.map(async (c) => {
      const [od, sc] = await Promise.all([
        getJson(`${creds.apiBase}/api/odds/snapshot/${c.fid}`, headers),
        getJson(`${creds.apiBase}/api/scores/snapshot/${c.fid}`, headers),
      ]);
      const recs = (Array.isArray(od) ? od : ((od as { records?: unknown[] })?.records ?? [])) as Array<
        Record<string, unknown>
      >;
      const byMarket = new Map<string, Record<string, unknown>>();
      for (const r of recs) {
        if (r.Bookmaker !== "TXLineStablePriceDemargined") continue;
        if (!Array.isArray(r.Prices) || !(r.Prices as number[]).some((p) => Number(p) > 0)) continue;
        const key = `${r.SuperOddsType}|${r.MarketParameters ?? ""}`;
        const prev = byMarket.get(key);
        if (!prev || Number(r.Ts) > Number(prev.Ts)) byMarket.set(key, r);
      }
      const frames: FrameOut[] = [...byMarket.values()]
        .sort((a, b) => Number(b.Ts) - Number(a.Ts))
        .map((r) => {
          const prices = r.Prices as number[];
          return {
            market: String(r.SuperOddsType ?? ""),
            line: String(r.MarketParameters ?? ""),
            period: String(r.MarketPeriod ?? ""),
            priceNames: (r.PriceNames as string[]) ?? [],
            fairProbs: prices.map((p) => (Number(p) > 0 ? Number((1000 / Number(p)).toFixed(4)) : 0)),
            ts: Number(r.Ts),
            ageSec: Number(((now - Number(r.Ts)) / 1000).toFixed(1)),
          };
        });
      if (!frames.length) return null;
      const latestAgeSec = Math.min(...frames.map((f) => f.ageSec));
      if (latestAgeSec * 1000 > FRESH_MS) return null;
      const scRecs = (Array.isArray(sc) ? sc : ((sc as { records?: unknown[] })?.records ?? [])) as Array<
        Record<string, unknown>
      >;
      const { p1, p2, minute } = readScores(scRecs);
      return { fid: c.fid, label: c.label, minute, goals: { p1, p2 }, latestAgeSec, frames } as FixtureOut;
    }),
  );

  const live = results.filter((r): r is FixtureOut => r != null).slice(0, MAX_FIXTURES);
  return NextResponse.json({
    configured: true,
    polledAt: new Date(now).toISOString(),
    source: creds.apiBase,
    liveCount: live.length,
    fixtures: live,
    note: live.length === 0 ? "No WC match is in-play right now — frames appear when a match kicks off." : undefined,
  });
}
