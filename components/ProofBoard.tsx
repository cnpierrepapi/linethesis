"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Proof {
  signedOnSolana: boolean;
  cluster: string;
  signupTx: string | null;
  apiBase: string | null;
  explorerUrl: string | null;
}
interface MatchProv {
  fid: string;
  label: string;
  oddsFrames: number;
  scoreFrames: number;
  ingested: number;
}
interface Trade {
  ts: number;
  agentId: string;
  agent: string;
  source: string;
  kind: string;
  match: string;
  side: string;
  direction: string;
  odds: number;
  stake: number;
  proofHash: string;
  status: string;
  clvReturn: number;
  pnl: number;
}
interface Snapshot {
  mode: string;
  status: string;
  proof?: Proof;
  provenance?: MatchProv[];
  totalIngested?: number;
  tradeCount?: number;
  trades?: Trade[];
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function money(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}
function sourceLabel(mode?: string): string {
  if (mode === "replay") return "TxLINE captured matches (replayed)";
  if (mode === "live") return "TxLINE live feed";
  return "synth (deterministic demo)";
}

export default function ProofBoard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/feed");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("snapshot", (e) => {
      try {
        setSnap(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, []);

  const proof = snap?.proof;
  const trades = snap?.trades ?? [];
  const prov = snap?.provenance ?? [];
  const settled = trades.filter((t) => t.status === "settled");
  const netPnl = settled.reduce((s, t) => s + t.pnl, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">audit trail</p>
          <h1 className="serif mt-1 text-3xl">Proof &amp; Evidence</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Every signal below was computed from real TxLINE market data, and every trade is fingerprinted to the exact
            frame it was taken on. This is the full record — the data ingested, and what the agents did with it.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-amber blink" : "bg-ink-500"}`} />
          {connected ? "LIVE" : "connecting"}
        </span>
      </header>

      {/* headline evidence stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="data source" value={sourceLabel(snap?.mode)} small />
        <Stat label="frames ingested" value={(snap?.totalIngested ?? 0).toLocaleString()} />
        <Stat label="total trades" value={(snap?.tradeCount ?? 0).toLocaleString()} />
        <Stat label="net settled p&l" value={money(netPnl)} tone={netPnl >= 0 ? "gain" : "loss"} />
      </div>

      {/* SOLANA PROOF OF ACCESS */}
      <section className="panel mt-6 p-5">
        <p className="label mb-3">on-chain proof of access (Solana)</p>
        {proof?.signedOnSolana ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted">
              Access to the TxLINE feed was minted by a real <span className="text-fg">SUBSCRIBE</span> transaction
              signed with a Solana wallet — &quot;sign up through Solana.&quot; The signature is a public, verifiable hash.
            </p>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="label">cluster</span>
              <span className="amber">{proof.cluster}</span>
              <span className="text-ink-500">·</span>
              <span className="label">api</span>
              <span className="text-muted">{proof.apiBase}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">signup tx</span>
              <code className="break-all rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-fg">
                {proof.signupTx}
              </code>
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-amber-dim bg-amber/10 px-3 py-1 text-xs text-amber hover:bg-amber/20"
              >
                verify on Solana Explorer ↗
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-faint">no on-chain proof configured.</p>
        )}
      </section>

      {/* INGESTION EVIDENCE — captured matches */}
      <section className="mt-6">
        <p className="label mb-3">captured TxLINE matches — proof of ingestion</p>
        {prov.length === 0 ? (
          <p className="card px-4 py-3 text-sm text-faint">no matches loaded.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {prov.map((m) => (
              <div key={m.fid} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="serif text-paper">{m.label}</p>
                  <span className="inline-block h-2 w-2 rounded-full bg-amber" />
                </div>
                <p className="label mt-1 tabular-nums text-faint">fixture {m.fid}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Mini label="odds" value={m.oddsFrames.toLocaleString()} />
                  <Mini label="scores" value={m.scoreFrames.toLocaleString()} />
                  <Mini label="ingested" value={m.ingested.toLocaleString()} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-faint">
          Odds history is gated on TxLINE, so the demargined price book was captured live off the SSE stream while each
          match played, then bundled and replayed through the engine.
        </p>
      </section>

      {/* THE TRADE LEDGER */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <p className="label">trade ledger — every bet, tied to a frame</p>
          <p className="text-xs text-faint">{trades.length} most recent</p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-xs text-faint">
                <Th>time</Th>
                <Th>agent</Th>
                <Th>signal</Th>
                <Th>match · market</Th>
                <Th>bet</Th>
                <Th right>odds</Th>
                <Th right>stake</Th>
                <Th>frame</Th>
                <Th right>clv</Th>
                <Th right>p&l</Th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {trades.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-faint">
                    waiting for the first trade…
                  </td>
                </tr>
              )}
              {trades.map((t, i) => (
                <tr key={`${t.proofHash}-${t.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 text-faint tabular-nums">{clock(t.ts)}</td>
                  <td className="px-3 py-2 text-fg">{t.agent}</td>
                  <td className="px-3 py-2">
                    <span className="rounded border border-ink-600 px-1.5 py-0.5 text-muted">{t.kind}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{t.match}</td>
                  <td className="px-3 py-2">
                    <span className={t.direction === "back" ? "gain" : "loss"}>{t.direction}</span> {t.side}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.odds.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">${t.stake.toFixed(0)}</td>
                  <td className="px-3 py-2">
                    <span className="amber" title="fingerprint of the real TxLINE frame this trade was taken on">
                      ⛓ {t.proofHash}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${t.clvReturn >= 0 ? "gain" : "loss"}`}>
                    {t.status === "settled" ? `${(t.clvReturn * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.status === "settled" ? (
                      <span className={t.pnl >= 0 ? "gain" : "loss"}>{money(t.pnl)}</span>
                    ) : (
                      <span className="text-faint">open</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">
          Watch them fire in real time on the{" "}
          <Link href="/desk" className="amber hover:text-fg">
            Desk
          </Link>{" "}
          · standings on the{" "}
          <Link href="/leaderboard" className="amber hover:text-fg">
            Leaderboard
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: "gain" | "loss"; small?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 ${small ? "text-sm" : "text-lg"} tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-ink-700 py-1.5">
      <p className="tabular-nums text-sm text-fg">{value}</p>
      <p className="label text-faint">{label}</p>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
