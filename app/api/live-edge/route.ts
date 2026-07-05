// /api/live-edge — the real-time divergence detector's latest read (box cron */1 publishes it).
import { NextResponse } from "next/server";
import { getLiveEdge } from "@/lib/pickoff-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const d = await getLiveEdge();
  return NextResponse.json(d ?? { generatedAt: Date.now(), liveCount: 0, theta: 0.05, signals: [] });
}
