// POST /api/keys/claim — redeem a USDC payment for an API key.
//   body: { txId, tier: "month" | "lifetime", chain: "svm" | "evm", wallet? }
//   $69.99 USDC = 30-day key, $349.99 USDC = lifetime key. Returns the raw key exactly once.
import { NextResponse } from "next/server";
import { verifyPayment, type Chain } from "@/lib/payments";
import { issueKey, txAlreadyRedeemed, type Tier } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const txId = String(body.txId || body.txSig || "").trim();
  const tier = body.tier as Tier;
  const chain = body.chain as Chain;
  const wallet = body.wallet ? String(body.wallet) : undefined;

  if (!txId || (tier !== "month" && tier !== "lifetime") || (chain !== "svm" && chain !== "evm")) {
    return NextResponse.json({ error: "txId, tier ('month' | 'lifetime') and chain ('svm' | 'evm') are required" }, { status: 400 });
  }
  if (await txAlreadyRedeemed(txId)) {
    return NextResponse.json({ error: "this transaction has already been redeemed" }, { status: 409 });
  }
  const v = await verifyPayment(chain, txId, tier);
  if (!v.ok) {
    return NextResponse.json({ error: v.error || "payment could not be verified" }, { status: 402 });
  }
  try {
    const { key, rec } = await issueKey(tier, txId, wallet, chain);
    return NextResponse.json({ key, tier, expiresAt: rec.expiresAt, chain: v.chain });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
