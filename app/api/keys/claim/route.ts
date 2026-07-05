// POST /api/keys/claim — redeem a Solana payment for an API key.
//   body: { txSig, tier: "month" | "lifetime", wallet? }
//   1 SOL = 28-day key, 7 SOL = lifetime key. Returns the raw key exactly once.
import { NextResponse } from "next/server";
import { verifyPayment } from "@/lib/solana-verify";
import { issueKey, txAlreadyRedeemed, type Tier } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICE: Record<Tier, number> = { month: 1_000_000_000, lifetime: 7_000_000_000 };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const txSig = String(body.txSig || "").trim();
  const tier = body.tier as Tier;
  const wallet = body.wallet ? String(body.wallet) : undefined;

  if (!txSig || (tier !== "month" && tier !== "lifetime")) {
    return NextResponse.json({ error: "txSig and tier ('month' or 'lifetime') are required" }, { status: 400 });
  }
  if (await txAlreadyRedeemed(txSig)) {
    return NextResponse.json({ error: "this transaction has already been redeemed" }, { status: 409 });
  }
  const v = await verifyPayment(txSig, PRICE[tier]);
  if (!v.ok) {
    return NextResponse.json({ error: v.error || "payment could not be verified" }, { status: 402 });
  }
  try {
    const { key, rec } = await issueKey(tier, txSig, wallet);
    return NextResponse.json({ key, tier, expiresAt: rec.expiresAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
