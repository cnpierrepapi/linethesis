// GET /api/v1/divergences  (requires a valid API key: Authorization: Bearer <key>)
//   THE canonical trader signal feed. Every item is a canonical Signal (see lib/signals/feed.ts):
//   the cheap side to buy, the entry, the TxLINE fair take-profit target, the gap, a suggested Kelly
//   fraction, and the exit liquidity at fair.
//     ?match=<fixtureId>  -> every signal on a settled match      (&theta=5|10, default 5)
//     (no params)         -> the list of matches with signal counts
//   The live surface (?status=live) was retired when the tournament closed; it now returns 410.
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getPickoffs, getReplaySignals } from "@/lib/signals/feed";
import { gone } from "@/lib/retired";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiKey(req: Request): string {
  const a = req.headers.get("authorization") || "";
  return a.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
}

export async function GET(req: Request) {
  const rec = await validateKey(apiKey(req));
  if (!rec) return NextResponse.json({ error: "invalid API key. Get a free one at /api" }, { status: 401 });

  const url = new URL(req.url);

  // LIVE: retired with the tournament. The feed is archival now.
  if (url.searchParams.get("status") === "live") return gone();

  const led = await getPickoffs();

  // REPLAY: every signal on one settled match.
  const fid = url.searchParams.get("match");
  if (fid) {
    const themeParam = url.searchParams.get("theta") === "10" ? "10" : "5";
    const m = led?.matches.find((x) => String(x.fid) === fid);
    if (!m) return NextResponse.json({ error: "unknown match" }, { status: 404 });
    return NextResponse.json({
      mode: "replay",
      fid: String(m.fid),
      teams: m.teams,
      theta: themeParam,
      signals: getReplaySignals(led, fid, themeParam),
      winnerHint: (m as unknown as { winnerHint?: unknown }).winnerHint ?? null,
    });
  }

  // INDEX: matches with signal counts.
  return NextResponse.json({
    mode: "index",
    matches: (led?.matches ?? []).map((m) => ({
      fid: String(m.fid),
      teams: m.teams,
      signals5: (m.divergences?.["5"] ?? []).length,
      signals10: (m.divergences?.["10"] ?? []).length,
    })),
  });
}
