// GET /api/v1/fair  (requires a valid API key: Authorization: Bearer <key>)
//   -> the current TxLINE de-vig (vig-free) fair per live fixture.
//
// D1: we hold the TxLINE token and stream the fair, so a trader never needs their own TxLINE access.
// Returns { live:false, fixtures:[] } when no match is in play.
import { NextResponse } from "next/server";
import { validateKey } from "@/lib/api-keys";
import { getFairSnapshot } from "@/lib/signals/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiKey(req: Request): string {
  const a = req.headers.get("authorization") || "";
  return a.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
}

export async function GET(req: Request) {
  const rec = await validateKey(apiKey(req));
  if (!rec) return NextResponse.json({ error: "invalid or expired API key. Buy one at /api" }, { status: 401 });

  const snap = await getFairSnapshot();
  return NextResponse.json(snap);
}
