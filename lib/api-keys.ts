// API KEY STORE — issued on Solana payment, gates the paid edge endpoints.
//
// Keys are stored HASHED (sha256) in desk-archives/api-keys.json, so the blob is safe even though
// the bucket is public-read: validation hashes the presented key and looks it up; only the claim
// route (server, service-role) can append. The raw key is shown to the buyer exactly once.

import crypto from "node:crypto";

const SUPA = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PUBLIC_URL = `${SUPA}/storage/v1/object/public/desk-archives/api-keys.json`;
const WRITE_URL = `${SUPA}/storage/v1/object/desk-archives/api-keys.json`;

export type Tier = "month" | "lifetime";
export interface KeyRec {
  keyHash: string;
  tier: Tier;
  createdAt: number;
  expiresAt: number | null; // null = lifetime
  txSig: string;            // the on-chain tx id the key was redeemed against
  wallet?: string;
  chain?: string;           // "svm" | "evm" — which rail the USDC was paid on
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function readKeys(): Promise<KeyRec[]> {
  try {
    const r = await fetch(`${PUBLIC_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d)) return d as KeyRec[];
    }
  } catch {
    /* empty */
  }
  return [];
}

async function writeKeys(keys: KeyRec[]): Promise<boolean> {
  if (!SRK) return false;
  const r = await fetch(WRITE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify(keys),
  });
  return r.ok;
}

export async function txAlreadyRedeemed(txSig: string): Promise<boolean> {
  const keys = await readKeys();
  return keys.some((k) => k.txSig === txSig);
}

// Issue a new key for a verified payment. Returns the RAW key (shown once) + the record.
export async function issueKey(tier: Tier, txSig: string, wallet?: string, chain?: string): Promise<{ key: string; rec: KeyRec }> {
  const keys = await readKeys();
  if (keys.some((k) => k.txSig === txSig)) throw new Error("tx already redeemed");
  const key = "las_" + crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const rec: KeyRec = {
    keyHash: sha(key),
    tier,
    createdAt: now,
    expiresAt: tier === "lifetime" ? null : now + 30 * 86400000,
    txSig,
    wallet,
    chain,
  };
  keys.push(rec);
  const ok = await writeKeys(keys);
  if (!ok) throw new Error("could not persist key");
  return { key, rec };
}

// Validate a presented key: exists and not expired. Reads the public (hashed) blob, no secret needed.
export async function validateKey(key?: string | null): Promise<KeyRec | null> {
  if (!key) return null;
  const h = sha(key);
  const keys = await readKeys();
  const rec = keys.find((k) => k.keyHash === h);
  if (!rec) return null;
  if (rec.expiresAt != null && Date.now() > rec.expiresAt) return null;
  return rec;
}
