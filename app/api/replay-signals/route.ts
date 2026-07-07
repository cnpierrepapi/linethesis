// GET /api/replay-signals  (public) — the included signal set per settled match, for the paper terminal
// (web + CLI) to replay. Live signals are the paid product (/api/v1/divergences?status=live); replay is
// the open demo. Cached so it does not hammer the blob.
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
      return { fid: String(m.fid), code: code(m.teams), teams: m.teams, count: signals.length, signals };
    })
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count);
  return NextResponse.json(
    { generatedAt: led?.generatedAt ?? Date.now(), matches },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
