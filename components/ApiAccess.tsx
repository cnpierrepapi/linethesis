"use client";

// FREE API KEY — a key is free to obtain but still required to pull the archival feed. No payment, no
// wallet connection, no KYC: request a key, save it, send it as `Authorization: Bearer <key>`. The key
// is the metering unit for the pricing models in the litepaper; today it is simply free.

import { useState } from "react";

export default function ApiAccess() {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key?: string; error?: string; expiresAt?: number | null } | null>(null);

  const request = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/keys/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
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
      <p className="serif text-lg text-paper">Get a free API key.</p>
      <p className="mt-1 text-xs text-muted">
        No payment, no KYC. The key gates the archival feed: every entry per settled match and the track
        record. Save it when it appears; it is shown once.
      </p>

      <div className="mt-4">
        <label className="text-xs text-faint">Optional label (for your own records)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. my-backtest"
          className="mt-1 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-fg"
        />
      </div>

      <button
        onClick={request}
        disabled={busy}
        className="mt-4 rounded border border-amber-dim bg-amber/10 px-4 py-1.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-40"
      >
        {busy ? "issuing…" : "Get my key"}
      </button>

      {result?.key && (
        <div className="mt-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="text-xs text-muted">Your API key (shown once, save it now):</p>
          <p className="mt-1 select-all break-all font-mono text-sm text-amber">{result.key}</p>
          <p className="mt-2 text-xs text-faint">
            send it as <span className="font-mono">Authorization: Bearer {"<key>"}</span>
          </p>
        </div>
      )}
      {result?.error && <p className="mt-4 text-sm text-loss">{result.error}</p>}
    </div>
  );
}
