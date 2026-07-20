// GET /api/replay-signals  (public) — every signal per settled match (unfiltered), for the paper terminal
// (web + CLI) and the Telegram bot to replay. Reads the same pickoffs.json blob that /proof and /edge
// read, so all four surfaces are one source of truth; the replay clock orders on the signal timestamps.
// Cached so it does not hammer the blob.
import { NextResponse } from "next/server";
import { getPickoffs, getReplaySignals } from "@/lib/signals/feed";

export const runtime = "nodejs";

function code(teams: string): string {
  const parts = teams.split(/\s+v\s+/i);
  if (parts.length !== 2) return teams.slice(0, 12);
  return parts.map((p) => p.trim().slice(0, 3).toUpperCase()).join("-");
}

export async function GET() {
  const led = await getPickoffs();
  const matches = (led?.matches ?? [])
    .map((m) => {
      const signals = getReplaySignals(led, String(m.fid), "5");
      // goal-imminent overlay: the high-danger pressure moments that preceded a goal (ledToGoal), so the
      // terminal can flag "watch this team's line" ahead of the post-goal fair jump.
      const gw = ((m as unknown as { goalWatch?: Array<{ min: number; ts: number; teamName: string; pressure: number; ledToGoal: boolean }> }).goalWatch ?? [])
        .filter((w) => w.ledToGoal)
        .map((w) => ({ min: w.min, ts: w.ts, team: w.teamName, pressure: w.pressure }));
      // volume-to-divergence winner hint (pilot n=12, in-sample) — a directional read on the match
      // winner, computed by the box in compute_edge.py; null when it abstains.
      const winnerHint = (m as unknown as { winnerHint?: unknown }).winnerHint ?? null;
      // kick/ft as unix SECONDS (ledger stores ms; signal.ts and exitFill.t are seconds) so the replay
      // clock is one unit — lets it place a no-reach mark-out at the real close.
      return { fid: String(m.fid), code: code(m.teams), teams: m.teams, count: signals.length, signals, goalWatch: gw, winnerHint, kick: Math.round(m.kick / 1000), ft: Math.round(m.ft / 1000) };
    })
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count);
  return NextResponse.json(
    { generatedAt: led?.generatedAt ?? Date.now(), matches },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
