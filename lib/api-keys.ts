// API KEY STORE — free to obtain, still required to pull the archival feed.
//
// A key gates the programmatic endpoints (/api/v1/divergences, /api/v1/track-record) so usage stays
// attributable per key. That is the metering rail for the pricing models described in the litepaper:
// a key is free to claim today, but billing can be attached to a key tier later with no re-architecture.
// The paid USDC checkout was retired when the tournament closed.
//
// Records live in the PRIVATE desk-private bucket (service-role reads/writes only). Keys are stored
// sha256-hashed; the raw key is shown to the caller exactly once, at claim time.
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

export interface KeyRec {
  keyHash: string;
  createdAt: number;
  expiresAt: number | null; // null = no expiry (free keys don't lapse)
  source: string;           // "free" for self-serve keys; legacy records carry a paid txSig/promo instead
  wallet?: string;          // optional, for the caller's own records
  label?: string;           // optional caller-supplied note
}

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

// Serialize claims within this instance; cross-instance races are caught by the read-back below.
let claimQueue: Promise<unknown> = Promise.resolve();

// Issue a free key (no payment, no cap — the /api/keys/free route rate-limits per IP). Returns the
// RAW key (shown once) + the record. Non-expiring, so a claimed key keeps working.
export async function issueKey(opts: { wallet?: string; label?: string } = {}): Promise<{ key: string; rec: KeyRec }> {
  const run = async (): Promise<{ key: string; rec: KeyRec }> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const keys = await readKeys();
      const key = "las_" + crypto.randomBytes(24).toString("hex");
      const rec: KeyRec = {
        keyHash: sha(key),
        createdAt: Date.now(),
        expiresAt: null,
        source: "free",
        wallet: opts.wallet,
        label: opts.label,
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
