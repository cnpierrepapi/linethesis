// Verify a Solana payment: the tx must be confirmed and must have increased the recipient's SOL
// balance by at least the tier amount. Checking pre/post balances is robust to how the transfer
// was built (system transfer, wallet UI, etc.).

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
export const RECIPIENT = process.env.SOLANA_RECIPIENT || "vRgXLq8hScnbDzuGG6d6bzC21uVpyRkqNnXh75arVn5";

export async function verifyPayment(txSig: string, minLamports: number): Promise<{ ok: boolean; lamports?: number; error?: string }> {
  let j: {
    result?: {
      meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[] };
      transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } };
    } | null;
  };
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [txSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
      }),
    });
    j = await r.json();
  } catch {
    return { ok: false, error: "could not reach Solana RPC" };
  }
  const tx = j?.result;
  if (!tx) return { ok: false, error: "transaction not found or not yet confirmed" };
  if (tx.meta?.err) return { ok: false, error: "transaction failed on-chain" };
  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k.pubkey));
  const idx = keys.indexOf(RECIPIENT);
  if (idx < 0) return { ok: false, error: "payment recipient not found in this transaction" };
  const pre = tx.meta?.preBalances?.[idx] ?? 0;
  const post = tx.meta?.postBalances?.[idx] ?? 0;
  const delta = post - pre;
  if (delta < minLamports) return { ok: false, lamports: delta, error: "payment amount is below the tier price" };
  return { ok: true, lamports: delta };
}
