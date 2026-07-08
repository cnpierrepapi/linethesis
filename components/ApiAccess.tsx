"use client";

// MANUAL USDC CHECKOUT — pay USDC to the Solana or EVM address, paste the transaction id, claim.
// No wallet connection, no KYC: the claim route verifies the transfer amount on-chain and issues a
// key. $97.99/month, $699.99 lifetime, on whichever rail (SVM or EVM) the buyer prefers.

import { useEffect, useState } from "react";

const PRICE: Record<"month" | "lifetime", string> = { month: "$97.99", lifetime: "$699.99" };

export default function ApiAccess({ svmRecipient, evmRecipient }: { svmRecipient: string; evmRecipient: string }) {
  const [tier, setTier] = useState<"month" | "lifetime">("month");
  const [chain, setChain] = useState<"svm" | "evm">("svm");
  const [txId, setTxId] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key?: string; error?: string; expiresAt?: number | null; chain?: string } | null>(null);

  // launch promo: first 20 keys free. Fetch how many are left; claim uses the same optional wallet field.
  const [free, setFree] = useState<{ remaining: number; limit: number } | null>(null);
  const [freeBusy, setFreeBusy] = useState(false);
  const [freeResult, setFreeResult] = useState<{ key?: string; error?: string; expiresAt?: number | null; remaining?: number } | null>(null);

  useEffect(() => {
    fetch("/api/keys/free").then((r) => r.json()).then(setFree).catch(() => {});
  }, []);

  const claimFree = async () => {
    setFreeBusy(true);
    setFreeResult(null);
    try {
      const r = await fetch("/api/keys/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.trim() || undefined }),
      });
      const j = await r.json();
      setFreeResult(j);
      if (typeof j.remaining === "number") setFree((f) => (f ? { ...f, remaining: j.remaining } : f));
    } catch {
      setFreeResult({ error: "network error, try again" });
    } finally {
      setFreeBusy(false);
    }
  };

  const address = chain === "svm" ? svmRecipient : evmRecipient;

  const claim = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/keys/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId: txId.trim(), tier, chain, wallet: wallet.trim() || undefined }),
      });
      setResult(await r.json());
    } catch {
      setResult({ error: "network error, try again" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      {/* launch promo: first 20 keys free */}
      {free && free.remaining > 0 && !freeResult?.key && (
        <div className="mb-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="serif text-lg text-paper">Launch offer: the first 20 keys are free.</p>
          <p className="mt-1 text-xs text-muted">
            <span className="text-amber">{free.remaining} of {free.limit}</span> free 30-day keys left. No payment, no KYC — full access to
            live divergences, every entry, and the track record.
          </p>
          <button
            onClick={claimFree}
            disabled={freeBusy}
            className="mt-3 rounded border border-amber-dim bg-amber/10 px-4 py-1.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-40"
          >
            {freeBusy ? "claiming…" : "Claim a free key"}
          </button>
        </div>
      )}
      {freeResult?.key && (
        <div className="mb-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="text-xs text-muted">Your free API key (shown once, save it now):</p>
          <p className="mt-1 select-all break-all font-mono text-sm text-amber">{freeResult.key}</p>
          <p className="mt-2 text-xs text-faint">
            {freeResult.expiresAt ? `expires ${new Date(freeResult.expiresAt).toISOString().slice(0, 10)}` : ""} · send it as{" "}
            <span className="font-mono">Authorization: Bearer {"<key>"}</span>
          </p>
        </div>
      )}
      {freeResult?.error && <p className="mb-4 text-sm text-loss">{freeResult.error}</p>}
      {free && free.remaining === 0 && !freeResult?.key && (
        <p className="mb-4 text-xs text-faint">The 20 free launch keys are all claimed — paid keys below.</p>
      )}

      {/* tier */}
      <div className="flex flex-wrap gap-3">
        {(["month", "lifetime"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`flex-1 rounded border p-4 text-left ${tier === t ? "border-amber-dim bg-amber/10" : "border-ink-600 hover:border-ink-500"}`}
          >
            <p className="serif text-2xl text-paper">{PRICE[t]}<span className="text-sm text-muted"> USDC</span></p>
            <p className="text-xs text-muted">{t === "month" ? "30-day access" : "lifetime access"}</p>
          </button>
        ))}
      </div>

      {/* chain */}
      <div className="mt-4">
        <p className="text-xs text-faint">pay USDC on</p>
        <div className="mt-1 flex gap-2">
          {([["svm", "Solana"], ["evm", "EVM (Ethereum / Base / Polygon / Arbitrum / Optimism)"]] as const).map(([c, label]) => (
            <button
              key={c}
              onClick={() => setChain(c)}
              className={`rounded border px-3 py-1.5 text-xs ${chain === c ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* manual steps */}
      <ol className="mt-4 space-y-3 text-sm text-muted">
        <li>
          <span className="text-faint">1.</span> Send exactly <span className="text-amber">{PRICE[tier]} USDC</span> to this{" "}
          {chain === "svm" ? "Solana" : "EVM"} address:
          <div className="mt-1 select-all break-all rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-xs text-fg">{address}</div>
        </li>
        <li>
          <span className="text-faint">2.</span> Paste the transaction {chain === "svm" ? "signature" : "hash"}:
          <input
            value={txId}
            onChange={(e) => setTxId(e.target.value)}
            placeholder={chain === "svm" ? "the Solana tx signature" : "0x… the EVM tx hash"}
            className="mt-1 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-fg"
          />
        </li>
        <li>
          <span className="text-faint">3.</span> Optionally, your wallet address (for your records):
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="optional"
            className="mt-1 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-fg"
          />
        </li>
        <li>
          <span className="text-faint">4.</span>{" "}
          <button
            onClick={claim}
            disabled={busy || !txId.trim()}
            className="rounded border border-amber-dim bg-amber/10 px-4 py-1.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-40"
          >
            {busy ? "verifying on-chain…" : "Claim my key"}
          </button>
        </li>
      </ol>

      {result?.key && (
        <div className="mt-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="text-xs text-muted">Your API key (shown once, save it now):</p>
          <p className="mt-1 select-all break-all font-mono text-sm text-amber">{result.key}</p>
          <p className="mt-2 text-xs text-faint">
            {result.expiresAt ? `expires ${new Date(result.expiresAt).toISOString().slice(0, 10)}` : "lifetime access"}
            {result.chain ? ` · paid on ${result.chain}` : ""} · send it as{" "}
            <span className="font-mono">Authorization: Bearer {"<key>"}</span>
          </p>
        </div>
      )}
      {result?.error && <p className="mt-4 text-sm text-loss">{result.error}</p>}
    </div>
  );
}
