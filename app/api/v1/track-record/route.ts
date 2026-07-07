// GET /api/v1/track-record  (requires a valid API key: Authorization: Bearer <key>)
//   -> pooled reach / edge / confidence interval, plus per-match edge.
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getPickoffs } from "@/lib/pickoff-source";
import { pooledStats, matchKellyRoi, KELLY_CAP } from "@/lib/signals/policy";

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
  const matches = led?.matches ?? [];
  // recomputed over EVERY call (no exclusion filter), so it matches /proof and the paper terminal exactly.
  const pooled = {
    "5": pooledStats(matches.map((m) => ({ divs: m.divergences?.["5"] ?? [], kick: m.kick }))),
    "10": pooledStats(matches.map((m) => ({ divs: m.divergences?.["10"] ?? [], kick: m.kick }))),
  };
  return NextResponse.json({
    policy: { kelly: "capped", kellyCap: KELLY_CAP, exclusions: "none" },
    pooled,
    matches: matches.map((m) => ({ fid: String(m.fid), teams: m.teams, kellyRoi5: matchKellyRoi(m.divergences?.["5"] ?? []) })),
  });
}
