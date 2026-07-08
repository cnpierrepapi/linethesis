// API KEY STORE — issued on USDC payment, gates the paid edge endpoints.
//
// Records live in the PRIVATE desk-private bucket (service-role reads/writes only). Keys are stored
// sha256-hashed, but the records also carry buyer metadata (txSig, wallet, tier) that must not be
// publicly enumerable, so nothing about the store is world-readable. The raw key is shown to the
// buyer exactly once, at claim time.
//
// The store is one JSON array in object storage, which has no compare-and-swap: two simultaneous
// claims could read the same array and the later write would drop the earlier record. Claims are
// therefore serialized in-instance (one queue) and every write is read back and verified, retrying
// the append if it lost a cross-instance race.

import crypto from "node:crypto";

const SUPA = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const READ_URL = `${SUPA}/storage/v1/object/authenticated/desk-private/api-keys.json`;
const WRITE_URL = `${SUPA}/storage/v1/object/desk-private/api-keys.json`;

export type Tier = "month" | "lifetime";
export interface KeyRec {
  keyHash: string;
  tier: Tier;
  createdAt: number;
  expiresAt: number | null; // null = lifetime
  txSig: string;            // the on-chain tx id the key was redeemed against ("free20:…" for promo keys)
  wallet?: string;
  chain?: string;           // "svm" | "evm" — which rail the USDC was paid on
  promo?: string;           // set to "free20" for the launch free-tier keys (no payment)
}

// Launch promo: the first 20 keys are free (30-day access, no payment). Hard-capped so it can never
// give away more than 20 — the cap is enforced against the same append-serialized store as paid keys.
export const FREE_PROMO = "free20";
export const FREE_LIMIT = 20;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function readKeys(): Promise<KeyRec[]> {
  if (!SRK) return [];
  try {
    const r = await fetch(READ_URL, {
      headers: { Authorization: `Bearer ${SRK}`, apikey: SRK },
      cache: "no-store",
    });
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

// Validation cache: authed endpoints hash-and-look-up on every request, and the key set changes
// only when a key is claimed, so a short TTL saves a storage round-trip per API call.
const CACHE_MS = 60_000;
let cache: { keys: KeyRec[]; at: number } | null = null;

async function cachedKeys(): Promise<KeyRec[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.keys;
  const keys = await readKeys();
  cache = { keys, at: Date.now() };
  return keys;
}

export async function txAlreadyRedeemed(txSig: string): Promise<boolean> {
  const keys = await readKeys(); // fresh read — this guards a payment, never trust the cache
  return keys.some((k) => k.txSig === txSig);
}

// Serialize claims within this instance; cross-instance races are caught by the read-back below.
let claimQueue: Promise<unknown> = Promise.resolve();

// Issue a new key for a verified payment. Returns the RAW key (shown once) + the record.
export async function issueKey(tier: Tier, txSig: string, wallet?: string, chain?: string): Promise<{ key: string; rec: KeyRec }> {
  const run = async (): Promise<{ key: string; rec: KeyRec }> => {
    for (let attempt = 0; attempt < 3; attempt++) {
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
      if (!(await writeKeys(keys))) throw new Error("could not persist key");
      const check = await readKeys();
      if (check.some((k) => k.keyHash === rec.keyHash)) {
        cache = null;
        return { key, rec };
      }
      // a concurrent writer clobbered the append — re-read and try again
    }
    throw new Error("could not persist key (storage contention) — your payment is safe, retry the claim");
  };
  const p = claimQueue.then(run, run);
  claimQueue = p.catch(() => {});
  return p;
}

// How many free-promo keys remain (0..FREE_LIMIT). Fresh read — this gates a giveaway, never the cache.
export async function freeRemaining(): Promise<number> {
  const keys = await readKeys();
  const used = keys.filter((k) => k.promo === FREE_PROMO).length;
  return Math.max(0, FREE_LIMIT - used);
}

// Issue a FREE 30-day key (launch promo), hard-capped at FREE_LIMIT. Same serialized append + read-back
// as issueKey so the cap holds under concurrent claims. One free key per wallet when a wallet is given.
export async function issueFreeKey(wallet?: string): Promise<{ key: string; rec: KeyRec; remaining: number }> {
  const run = async (): Promise<{ key: string; rec: KeyRec; remaining: number }> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const keys = await readKeys();
      const promoKeys = keys.filter((k) => k.promo === FREE_PROMO);
      if (promoKeys.length >= FREE_LIMIT) throw new Error("the free launch tier is fully claimed (20/20) — grab a paid key instead");
      if (wallet && promoKeys.some((k) => k.wallet && k.wallet.toLowerCase() === wallet.toLowerCase())) {
        throw new Error("this wallet already claimed a free key");
      }
      const key = "las_" + crypto.randomBytes(24).toString("hex");
      const now = Date.now();
      const rec: KeyRec = {
        keyHash: sha(key),
        tier: "month",
        createdAt: now,
        expiresAt: now + 30 * 86400000,
        txSig: "free20:" + crypto.randomBytes(8).toString("hex"), // unique sentinel — no payment
        wallet,
        promo: FREE_PROMO,
      };
      keys.push(rec);
      if (!(await writeKeys(keys))) throw new Error("could not persist key");
      const check = await readKeys();
      if (check.some((k) => k.keyHash === rec.keyHash)) {
        cache = null;
        return { key, rec, remaining: Math.max(0, FREE_LIMIT - check.filter((k) => k.promo === FREE_PROMO).length) };
      }
      // a concurrent writer clobbered the append — re-read and try again (also re-checks the cap)
    }
    throw new Error("could not persist key (storage contention) — try again");
  };
  const p = claimQueue.then(run, run);
  claimQueue = p.catch(() => {});
  return p;
}

// Validate a presented key: exists and not expired.
export async function validateKey(key?: string | null): Promise<KeyRec | null> {
  if (!key) return null;
  const h = sha(key);
  const keys = await cachedKeys();
  let rec = keys.find((k) => k.keyHash === h);
  if (!rec) {
    // could be a key claimed seconds ago through another instance — one fresh look before rejecting
    const fresh = await readKeys();
    cache = { keys: fresh, at: Date.now() };
    rec = fresh.find((k) => k.keyHash === h);
  }
  if (!rec) return null;
  if (rec.expiresAt != null && Date.now() > rec.expiresAt) return null;
  return rec;
}
