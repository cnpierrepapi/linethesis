// /api/live-stream — same-origin proxy for the box's live tick tape (desk-archives/live-stream.json).
// Clients poll THIS, never Supabase directly: getLiveStream is fetch-cached (revalidate 8s) and the
// response carries s-maxage so Vercel's CDN serves repeat polls without re-hitting Supabase. This caps
// storage egress at ~one upstream fetch per window regardless of how many tabs are open.
import { NextResponse } from "next/server";
import { getLiveStream } from "@/lib/pickoff-source";

export const runtime = "nodejs";

export async function GET() {
  const d = await getLiveStream();
  return NextResponse.json(d, {
    headers: { "Cache-Control": "public, s-maxage=8, stale-while-revalidate=20" },
  });
}
