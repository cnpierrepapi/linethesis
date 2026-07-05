// GET /api/v1/divergences  (requires a valid API key: Authorization: Bearer <key>)
//   ?status=live        -> the divergences open right now (from the live detector)
//   ?match=<fixtureId>  -> every divergence entry on a settled match
//   (no params)         -> the list of matches with entry counts
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getPickoffs, getLiveEdge } from "@/lib/pickoff-source";

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
  if (url.searchParams.get("status") === "live") {
    const live = await getLiveEdge();
    return NextResponse.json({
      generatedAt: live?.generatedAt ?? Date.now(),
      live: (live?.liveCount ?? 0) > 0,
      divergences: (live?.signals ?? []).filter((s) => s.diverged),
    });
  }

  const led = await getPickoffs();
  const fid = url.searchParams.get("match");
  if (fid) {
    const m = led?.matches.find((x) => String(x.fid) === fid);
    if (!m) return NextResponse.json({ error: "unknown match" }, { status: 404 });
    return NextResponse.json({ fid: m.fid, teams: m.teams, divergences: m.divergences ?? {} });
  }
  return NextResponse.json({
    matches: (led?.matches ?? []).map((m) => ({ fid: m.fid, teams: m.teams, entries5: (m.divergences?.["5"] ?? []).length })),
  });
}
