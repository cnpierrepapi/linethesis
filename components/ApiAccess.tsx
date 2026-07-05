"use client";

import { useState } from "react";

export default function ApiAccess({ recipient }: { recipient: string }) {
  const [tier, setTier] = useState<"month" | "lifetime">("month");
  const [txSig, setTxSig] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key?: string; error?: string; expiresAt?: number | null } | null>(null);

  const price = tier === "month" ? "1 SOL" : "7 SOL";
  const claim = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/keys/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txSig: txSig.trim(), tier, wallet: wallet.trim() || undefined }),
      });
      setResult(await r.json());
    } catch {
      setResult({ error: "network error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      {/* tier */}
      <div className="flex flex-wrap gap-3">
        {(["month", "lifetime"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`flex-1 rounded border p-4 text-left ${tier === t ? "border-amber-dim bg-amber/10" : "border-ink-600 hover:border-ink-500"}`}
          >
            <p className="serif text-2xl text-paper">{t === "month" ? "1 SOL" : "7 SOL"}</p>
            <p className="text-xs text-muted">{t === "month" ? "28-day access" : "lifetime access"}</p>
          </button>
        ))}
      </div>

      {/* steps */}
      <ol className="mt-5 space-y-3 text-sm text-muted">
        <li>
          <span className="text-faint">1.</span> Send <span className="text-amber">{price}</span> to this address:
          <div className="mt-1 select-all break-all rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-xs text-fg">{recipient}</div>
        </li>
        <li>
          <span className="text-faint">2.</span> Paste the transaction signature:
          <input
            value={txSig}
            onChange={(e) => setTxSig(e.target.value)}
            placeholder="5x…the Solana tx signature"
            className="mt-1 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-fg"
          />
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="your wallet (optional, for your records)"
            className="mt-2 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-muted"
          />
        </li>
        <li>
          <span className="text-faint">3.</span>{" "}
          <button
            onClick={claim}
            disabled={busy || !txSig.trim()}
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 font-semibold text-amber hover:bg-amber/20 disabled:opacity-40"
          >
            {busy ? "verifying payment…" : "Claim my key"}
          </button>
        </li>
      </ol>

      {result?.key && (
        <div className="mt-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="text-xs text-muted">Your API key (shown once, save it now):</p>
          <p className="mt-1 select-all break-all font-mono text-sm text-amber">{result.key}</p>
          <p className="mt-2 text-xs text-faint">
            {result.expiresAt ? `expires ${new Date(result.expiresAt).toISOString().slice(0, 10)}` : "lifetime access"} · send it as{" "}
            <span className="font-mono">Authorization: Bearer {"<key>"}</span>
          </p>
        </div>
      )}
      {result?.error && <p className="mt-4 text-sm text-loss">{result.error}</p>}
    </div>
  );
}
