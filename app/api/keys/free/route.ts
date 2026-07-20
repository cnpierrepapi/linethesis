// POST /api/keys/free  → { key, expiresAt }   issue a free API key (no payment).
//   body: { wallet?, label? }   — optional, stored for the caller's own records
// A key is free but still required: it gates the archival feed so usage stays attributable per key
// (the metering rail for the litepaper pricing models). Per-IP rate-limited to slow scripted minting.
import { NextResponse } from "next/server";
import { issueKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP limiter — a free key is cheap to issue but still a giveaway, so cap the hot loop.
const WINDOW_MS = 3_600_000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) { attempts.set(ip, hits); return true; }
  hits.push(now);
  attempts.set(ip, hits);
  if (attempts.size > 5000) attempts.clear();
  return false;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "too many key requests — try again later" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const wallet = body.wallet ? String(body.wallet).trim() : undefined;
  const label = body.label ? String(body.label).trim().slice(0, 80) : undefined;
  try {
    const { key, rec } = await issueKey({ wallet, label });
    return NextResponse.json({ key, expiresAt: rec.expiresAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
