"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import LiveFrames from "@/components/LiveFrames";
import { fetchRemoteSnapshot, remoteConfigured, type RemoteSnapshot } from "@/lib/desk-remote";

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
  exitOdds: number | null;
  exitProofHash: string | null;
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
function sourceLabel(mode?: string): string {
  if (mode === "ec2-live") return "EC2 live worker — TxLINE live feed";
  if (mode === "ec2-recorded") return "EC2 recorded session — last live TxLINE matches";
  if (mode === "replay") return "TxLINE captured matches (replayed)";
  if (mode === "live") return "TxLINE live feed";
  return "synth (deterministic demo)";
}

export default function ProofBoard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
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

  // The EC2/Supabase mirror — the real live session the worker ingested (the
  // June 30 World Cup matches). Preferred over the in-app replay when present,
  // so /proof shows the real ingested matches and the agents' real calls.
  useEffect(() => {
    if (!remoteConfigured) return;
    let alive = true;
    const poll = async () => {
      const r = await fetchRemoteSnapshot();
      if (alive) setRemote(r);
    };
    poll();
    const iv = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const useRemote = !!remote && (remote.trades.length > 0 || remote.provenance.length > 0);
  const recorded = useRemote && !remote!.fresh;

  const proof = (useRemote ? remote!.proof : snap?.proof) as Proof | undefined;
  const prov = (useRemote ? remote!.provenance : snap?.provenance ?? []) as MatchProv[];
  const totalIngested = useRemote ? remote!.totalIngested : snap?.totalIngested ?? 0;
  const tradeCount = useRemote ? remote!.tradeCount : snap?.tradeCount ?? 0;
  const sourceMode = useRemote ? (remote!.fresh ? "ec2-live" : "ec2-recorded") : snap?.mode;

  // The EC2 mirror carries the closing leg once a call settles (its last real
  // quote before the market stopped trading + that frame's fingerprint), so the
  // ledger shows the same verifiable entry-quote → closing-quote pair as the
  // in-app path. Still-open calls carry null exit legs and read as "open".
  const trades: Trade[] = useRemote
    ? remote!.trades.map((t) => ({
        ts: t.ts,
        agentId: t.agentId,
        agent: t.agent,
        source: "ec2-live",
        kind: t.kind,
        match: t.match,
        side: t.side,
        direction: t.direction,
        odds: t.odds,
        stake: t.stake,
        proofHash: t.proofHash,
        exitOdds: t.exitOdds,
        exitProofHash: t.exitProofHash,
        status: t.status,
        clvReturn: t.clvReturn,
        pnl: t.pnl,
      }))
    : snap?.trades ?? [];
  const settled = trades.filter((t) => t.status === "settled");
  const avgClv = settled.length ? settled.reduce((s, t) => s + t.clvReturn, 0) / settled.length : 0;
  const capturedFrames = prov.reduce((s, m) => s + m.oddsFrames + m.scoreFrames, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">verification</p>
          <h1 className="serif mt-1 text-3xl">Verification</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Every signal below was computed from real TxLINE market data, and every call is fingerprinted to the exact
            frame it was taken on. This is the full record — the data ingested, and what the forecasters did with it.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${(useRemote ? remote!.fresh : connected) ? "bg-amber blink" : "bg-ink-500"}`} />
          {useRemote ? (remote!.fresh ? "LIVE · EC2" : "RECORDED · EC2") : connected ? "LIVE" : "connecting"}
        </span>
      </header>

      {recorded && (
        <p className="mb-6 rounded border border-ink-600 bg-ink-850 px-4 py-2.5 text-sm text-muted">
          Showing the <span className="text-fg">last live World Cup session</span> — {prov.length} real matches the EC2
          worker ingested off the TxLINE live feed ({totalIngested.toLocaleString()} frames), with{" "}
          {tradeCount.toLocaleString()} autonomous calls, each fingerprinted to the frame it fired on.
        </p>
      )}

      {/* headline evidence stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="data source" value={sourceLabel(sourceMode)} small />
        <Stat label="matches" value={prov.length.toLocaleString()} />
        <Stat label="frames on record" value={capturedFrames.toLocaleString()} />
        <Stat label="frames ingested" value={totalIngested.toLocaleString()} />
        <Stat label="total calls" value={tradeCount.toLocaleString()} />
        <Stat label="avg settled clv" value={`${(avgClv * 100).toFixed(1)}%`} tone={avgClv >= 0 ? "gain" : "loss"} />
      </div>

      {/* VERIFY-AGAINST-YOUR-DB — the CSV download */}
      <section className="panel mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="label mb-1">reconcile against your database</p>
          <p className="text-sm text-muted">
            Download every real TxLINE frame we ingested — original timestamp, market, and demargined prices — with each
            forecaster&apos;s calls tallied inline on the frames they fired on. Join on{" "}
            <code className="rounded border border-ink-600 bg-ink-800 px-1 text-xs text-fg">fixture_id</code> +{" "}
            <code className="rounded border border-ink-600 bg-ink-800 px-1 text-xs text-fg">frame_ts_ms</code> to confirm
            our prices match yours, and see exactly what each forecaster called on that frame. Every settled call carries{" "}
            <span className="text-fg">both legs</span> — entry and closing fair prob, each fingerprinted to a real frame —
            so the CLV is recomputable from your own data (
            <code className="rounded border border-ink-600 bg-ink-800 px-1 text-xs text-fg">clv_recomputed_pct</code>).
          </p>
          <p className="mt-1 text-xs text-faint">
            {capturedFrames.toLocaleString()} frames · {prov.length} matches · {tradeCount.toLocaleString()}{" "}
            forecaster calls fingerprinted to their source frame.
          </p>
          {recorded && (
            <p className="mt-1 text-xs text-faint">
              The CSV reconciles the bundled replay captures (Brazil v Japan, Germany v Paraguay). The live World Cup
              session above streamed through TxLINE in real time and isn&apos;t re-bundled as raw frames.
            </p>
          )}
        </div>
        <a
          href="/api/verify-csv"
          className="shrink-0 rounded border border-amber-dim bg-amber/10 px-4 py-2 text-center text-sm text-amber hover:bg-amber/20"
        >
          ↓ Download verification CSV
        </a>
      </section>

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

      {/* REAL-TIME — live frames polled by the deployed app */}
      <LiveFrames />

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

      {/* THE SIGNAL LEDGER */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <p className="label">signal ledger — every call, tied to a frame</p>
          <p className="text-xs text-faint">{trades.length} most recent</p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-xs text-faint">
                <Th>time</Th>
                <Th>agent</Th>
                <Th>signal</Th>
                <Th>match · market</Th>
                <Th>call</Th>
                <Th right>entry</Th>
                <Th right>close</Th>
                <Th>frame</Th>
                <Th right>clv</Th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {trades.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-faint">
                    waiting for the first call…
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.exitOdds != null ? (
                      <span title={`closing frame ⛓ ${t.exitProofHash ?? ""}`}>{t.exitOdds.toFixed(2)}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="amber" title="fingerprint of the real TxLINE frame this call was taken on">
                      ⛓ {t.proofHash}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${t.clvReturn >= 0 ? "gain" : "loss"}`}>
                    {t.status === "settled" ? `${(t.clvReturn * 100).toFixed(1)}%` : <span className="text-faint">open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">
          Watch them fire in real time on the{" "}
          <Link href="/desk" className="amber hover:text-fg">
            Signal Desk
          </Link>{" "}
          · standings on the{" "}
          <Link href="/leaderboard" className="amber hover:text-fg">
            Calibration Tournament
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
