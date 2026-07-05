// GET /api/v1/track-record  (requires a valid API key: Authorization: Bearer <key>)
//   -> pooled reach / edge / confidence interval, plus per-match edge.
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getPickoffs } from "@/lib/pickoff-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiKey(req: Request): string {
  const a = req.headers.get("authorization") || "";
  return a.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
}

export async function GET(req: Request) {
  const rec = await validateKey(apiKey(req));
  if (!rec) return NextResponse.json({ error: "invalid or expired API key. Buy one at /api" }, { status: 401 });

  const led = await getPickoffs();
  return NextResponse.json({
    pooled: led?.pooled ?? {},
    matches: (led?.matches ?? []).map((m) => ({ fid: m.fid, teams: m.teams, edge: m.edge ?? {} })),
  });
}
