// GET  /api/keys/free  → { remaining, limit }        how many launch free keys are left
// POST /api/keys/free  → { key, expiresAt, remaining } claim one of the first 20 free keys (no payment)
//   body: { wallet? }   — one free key per wallet when a wallet is supplied
import { NextResponse } from "next/server";
import { issueFreeKey, freeRemaining, FREE_LIMIT } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP limiter — a free claim is cheaper than a paid one but still a giveaway, so cap the hot loop.
// The real backstop is the hard 20-key cap in issueFreeKey; this just slows single-client scripting.
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

export async function GET() {
  const remaining = await freeRemaining();
  return NextResponse.json({ remaining, limit: FREE_LIMIT });
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "too many claim attempts — try again later" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const wallet = body.wallet ? String(body.wallet).trim() : undefined;
  try {
    const { key, rec, remaining } = await issueFreeKey(wallet);
    return NextResponse.json({ key, tier: rec.tier, expiresAt: rec.expiresAt, remaining });
  } catch (e) {
    // exhausted / duplicate-wallet → 409 conflict; everything else → 500
    const msg = (e as Error).message;
    const status = /claimed|fully claimed|already/.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
