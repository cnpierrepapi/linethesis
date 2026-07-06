// GET /api/v1/divergences  (requires a valid API key: Authorization: Bearer <key>)
//   THE canonical trader signal feed. Every item is a canonical Signal (see lib/signals/feed.ts):
//   the cheap side to buy, the entry, the TxLINE fair take-profit target, the gap, a suggested Kelly
//   fraction, and the exit liquidity at fair.
//     ?status=live        -> signals open right now (only while a match is in play; else no matches live)
//     ?match=<fixtureId>  -> every signal on a settled match      (&theta=5|10, default 5)
//     (no params)         -> the list of matches with signal counts
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getPickoffs, getLiveSignals, getReplaySignals } from "@/lib/signals/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiKey(req: Request): string {
  const a = req.headers.get("authorization") || "";
  return a.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
}

export async function GET(req: Request) {
  const rec = await validateKey(apiKey(req));
  if (!rec) return NextResponse.json({ error: "invalid or expired API key. Buy one at /api" }, { status: 401 });

  const url = new URL(req.url);

  // LIVE: gated to a match actually in play.
  if (url.searchParams.get("status") === "live") {
    const { generatedAt, live, signals } = await getLiveSignals();
    return NextResponse.json(
      live
        ? { mode: "live", generatedAt, live: true, signals }
        : { mode: "live", generatedAt, live: false, signals: [], message: "no matches live" },
    );
  }

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
