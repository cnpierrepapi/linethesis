// /api/v1/control-room — the read-only boundary, made queryable (D).
//
// For the strongest in-play match, the timeline: each signal, the NAIVE-FOLLOW book's
// stale price + pickoff gap (pWatched / gapBps), and the action the OPERATOR'S policy
// chose. Agenthesis computes the decision; the operator's rule-set owns the action — we
// never touch the book. Params: ?fixtureId, ?lagMs (naive-book latency in ms).
//
// Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>` (demo key ag_demo_2026).
import { NextResponse } from "next/server";
import { computeControlRoom } from "@/lib/operator-feed.mjs";
import { getReplays } from "@/lib/replays-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_KEY = "ag_demo_2026";
function validKey(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const supplied = bearer || req.headers.get("x-api-key")?.trim() || null;
  if (!supplied) return false;
  const keys = new Set((process.env.OPERATOR_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean));
  keys.add(DEMO_KEY);
  return keys.has(supplied);
}

export async function GET(req: Request) {
  if (!validKey(req)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Provide an API key via 'Authorization: Bearer <key>' or 'X-Api-Key'." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId") || undefined;
  const lagMs = Number(url.searchParams.get("lagMs")) || undefined;
  const cr = computeControlRoom(
    (await getReplays()) as unknown as Parameters<typeof computeControlRoom>[0],
    { fixtureId, lagMs },
  );
  return NextResponse.json({ version: "1", generatedAt: Date.now(), source: "txline-capture-replay", ...cr });
}
