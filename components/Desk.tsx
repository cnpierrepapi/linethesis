"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchRemoteSnapshot,
  sendRemoteControl,
  remoteConfigured,
  type RemoteSnapshot,
} from "@/lib/desk-remote";

interface Activity {
  type: "trade" | "settle" | "matchEvent";
  ts: number;
  agentId?: string;
  agentName?: string;
  text: string;
  pnl?: number;
}

interface AgentView {
  id: string;
  name: string;
  title: string;
  edgeKinds: string[];
  status: "running" | "paused" | "stopped";
  bankroll: number;
  startBankroll: number;
  dayPnl: number;
  bets: number;
  wins: number;
  losses: number;
  openPositions: number;
  unrealized: number;
}

interface Proof {
  signedOnSolana: boolean;
  cluster: string;
  signupTx: string | null;
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
  exitOdds?: number | null; // closing quote, present once settled
  exitProofHash?: string | null;
}

interface Snapshot {
  mode: string;
  status: string;
  proof?: Proof;
  provenance?: MatchProv[];
  totalIngested?: number;
  trades?: Trade[];
  agents: AgentView[];
}

// Rebuild a feed line from a persisted trade row, so the log shows recent
// history on (re)connect instead of starting blank every time you return.
function tradeToActivity(t: Trade): Activity {
  if (t.status === "settled") {
    // Show the entry-quote → closing-quote move when the closing leg is present,
    // so the log reads as a true "beat the close" grade rather than a bare number.
    const move = t.exitOdds != null ? ` — ${Number(t.odds).toFixed(2)}→${Number(t.exitOdds).toFixed(2)}` : "";
    return {
      type: "settle",
      ts: t.ts,
      agentId: t.agentId,
      agentName: t.agent,
      pnl: t.pnl,
      text: `${t.agent} graded ${t.side} at close${move} · CLV ${(t.clvReturn * 100).toFixed(1)}%`,
    };
  }
  return {
    type: "trade",
    ts: t.ts,
    agentId: t.agentId,
    agentName: t.agent,
    text: `${t.agent} flagged ${t.side} mispriced @ ${Number(t.odds).toFixed(2)} on ${t.match} (${t.kind}) · frame ${t.proofHash}`,
  };
}

function sourceLabel(mode?: string): string {
  if (mode === "ec2-live") return "EC2 live worker — TxLINE live feed";
  if (mode === "ec2-recorded") return "EC2 recorded session — last live TxLINE World Cup matches";
  if (mode === "replay") return "TxLINE captured matches (replay)";
  if (mode === "live") return "TxLINE live feed";
  return "synth (deterministic demo)";
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function glyph(a: Activity): string {
  if (a.type === "trade") return "⚡";
  if (a.type === "matchEvent") return "⚽";
  return (a.pnl ?? 0) >= 0 ? "✓" : "✕";
}

function lineColor(a: Activity): string {
  if (a.type === "trade") return "text-amber";
  if (a.type === "matchEvent") return "text-muted";
  return (a.pnl ?? 0) >= 0 ? "gain" : "loss";
}

export default function Desk() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // Read in control() without re-creating the callback each render.
  const remoteLiveRef = useRef(false);

  // EC2 worker mirror (foil Supabase, read direct). When it's pushing fresh
  // data we render from it; otherwise we fall back to the in-app SSE replay.
  useEffect(() => {
    if (!remoteConfigured) return;
    let alive = true;
    const poll = async () => {
      const r = await fetchRemoteSnapshot();
      if (alive) setRemote(r);
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/feed");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("snapshot", (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        setSnap(s);
        // Seed the log from persisted history the first time only, so returning
        // to the page shows recent trades instead of an empty "waiting…" screen.
        setFeed((prev) => {
          if (prev.length || !s.trades?.length) return prev;
          return s.trades.slice(0, 100).map(tradeToActivity);
        });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("activity", (e) => {
      try {
        const a = JSON.parse((e as MessageEvent).data) as Activity;
        setFeed((prev) => [a, ...prev].slice(0, 100));
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, []);

  async function control(id: string, op: "pause" | "resume" | "stop") {
    // Optimistically reflect the new status immediately; the next snapshot/poll
    // reconciles. Without this the button feels dead until the next refresh.
    const next = op === "pause" ? "paused" : op === "resume" ? "running" : "stopped";
    setSnap((prev) =>
      prev
        ? { ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, status: next as AgentView["status"] } : a)) }
        : prev,
    );
    setRemote((prev) =>
      prev
        ? { ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, status: next as AgentView["status"] } : a)) }
        : prev,
    );
    try {
      if (remoteLiveRef.current) {
        // Runner lives on EC2 → queue the intent; the worker applies it.
        await sendRemoteControl(id, op);
      } else {
        await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "control", id, op }),
        });
      }
    } catch {
      /* the next snapshot/poll will restore the true state */
    }
  }

  // Source selection. Prefer the EC2/Supabase mirror whenever it has data:
  // `fresh` (worker pushing now) renders as LIVE; a stale mirror is the last
  // recorded session (the June 30 World Cup matches the live worker ingested)
  // and renders as RECORDED. Fall back to the in-app SSE replay only when no
  // mirror exists at all.
  const remoteLive = !!remote?.fresh;
  const useRemote = !!remote && (remote.agents.length > 0 || remote.trades.length > 0);
  remoteLiveRef.current = remoteLive; // control() only reaches the worker when truly live

  const agents: AgentView[] = useRemote ? remote!.agents : snap?.agents ?? [];
  const baseFeed: Activity[] = useRemote ? remote!.trades.map(tradeToActivity) : feed;
  const sourceMode = useRemote ? (remoteLive ? "ec2-live" : "ec2-recorded") : snap?.mode;
  const totalIngested = useRemote ? remote!.totalIngested : snap?.totalIngested;
  const proof = (useRemote ? remote!.proof : snap?.proof) as Snapshot["proof"];
  const provenance = (useRemote ? remote!.provenance : snap?.provenance) as Snapshot["provenance"];
  const isLive = remoteLive || (!useRemote && connected);

  const selectedName = selected ? agents.find((a) => a.id === selected)?.name ?? null : null;
  // When an agent is selected, show only its calls/grades — plus match events,
  // which are shared context (a goal is why an overreaction call fired).
  const shownFeed = selected ? baseFeed.filter((a) => a.agentId === selected || a.type === "matchEvent") : baseFeed;

  // CLV is the only scorecard. Per-agent average CLV comes from the settled calls
  // in the current snapshot window; hit/miss counts come from each agent's complete
  // tally. No dollars are surfaced anywhere on the desk.
  const rawTrades = remoteLive ? remote!.trades : snap?.trades ?? [];
  const settled = rawTrades.filter((t) => t.status === "settled");
  const clvByAgent = new Map<string, { sum: number; n: number }>();
  for (const t of settled) {
    const e = clvByAgent.get(t.agentId) ?? { sum: 0, n: 0 };
    e.sum += t.clvReturn;
    e.n += 1;
    clvByAgent.set(t.agentId, e);
  }
  const avgClvAll = settled.length ? settled.reduce((s, t) => s + t.clvReturn, 0) / settled.length : 0;
  const totWins = agents.reduce((s, a) => s + a.wins, 0);
  const totLosses = agents.reduce((s, a) => s + a.losses, 0);
  const hitRateAll = totWins + totLosses ? totWins / (totWins + totLosses) : 0;
  const running = agents.filter((a) => a.status === "running").length;
  const open = agents.reduce((s, a) => s + a.openPositions, 0);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      {/* aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="avg clv" value={`${(avgClvAll * 100).toFixed(1)}%`} tone={avgClvAll >= 0 ? "gain" : "loss"} />
        <Stat label="clv hit-rate" value={`${(hitRateAll * 100).toFixed(0)}%`} />
        <Stat label="agents" value={`${running} running`} />
        <Stat label="open calls" value={`${open}`} />
        <div className="card flex items-center justify-between px-4 py-3">
          <span className="label">feed</span>
          <span className="flex items-center gap-2 text-sm">
            <span className={`inline-block h-2 w-2 rounded-full ${isLive ? "bg-amber" : "bg-ink-500"}`} />
            {remoteLive ? "ec2 live" : useRemote ? "ec2 recorded" : sourceMode ?? "…"}
          </span>
        </div>
      </div>

      {/* provenance — proof of ingestion + on-chain proof of access */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
        <span className="label">data source</span>
        <span className="text-muted">{sourceLabel(sourceMode)}</span>
        {typeof totalIngested === "number" && totalIngested > 0 && (
          <>
            <span className="text-ink-500">·</span>
            <span className="text-muted tabular-nums">{totalIngested.toLocaleString()} frames ingested</span>
          </>
        )}
        {proof?.signedOnSolana && (
          <>
            <span className="text-ink-500">·</span>
            <span className="amber">✓ access signed on Solana</span>
            <a
              href={proof.explorerUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-ink-500 underline-offset-2 hover:text-fg"
            >
              tx {proof.signupTx?.slice(0, 6)}…{proof.signupTx?.slice(-4)} ({proof.cluster})
            </a>
          </>
        )}
      </div>

      {/* per-match ingestion tallies — the "we ingested this real data" proof */}
      {!!provenance?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {provenance.map((m) => (
            <span
              key={m.fid}
              className="card flex items-center gap-2 px-3 py-1.5 text-xs"
              title={`${m.oddsFrames} odds + ${m.scoreFrames} score frames captured live from TxLINE`}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" />
              <span className="text-fg">{m.label}</span>
              <span className="text-faint tabular-nums">{m.ingested.toLocaleString()} frames</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* HERO — live autonomous activity */}
        <section className="panel order-2 flex min-h-[60vh] flex-col lg:order-1 lg:col-span-8">
          <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
            <div>
              <p className="label">live activity</p>
              <p className="text-sm text-muted">
                {selectedName ? (
                  <>
                    filtered to <span className="text-fg">{selectedName}</span> —{" "}
                    <button onClick={() => setSelected(null)} className="amber underline underline-offset-2 hover:text-fg">
                      show all
                    </button>
                  </>
                ) : useRemote && !remoteLive ? (
                  "last live session — World Cup matches the EC2 worker ingested"
                ) : (
                  "agents forecasting autonomously — no human in the loop"
                )}
              </p>
            </div>
            <span className="flex items-center gap-2 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${isLive ? "bg-amber blink" : "bg-ink-500"}`} />
              {remoteLive ? "LIVE · EC2" : useRemote ? "RECORDED · EC2" : isLive ? "LIVE" : "connecting"}
            </span>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 font-mono text-sm">
            <p className="prompt mb-3 text-faint">
              tail -f {selectedName ? `desk.log | grep '${selectedName}'` : "desk.log"}
              <span className="blink ml-1 amber">_</span>
            </p>
            {shownFeed.length === 0 && (
              <p className="text-faint">
                {selected ? "no activity for this agent yet…" : "waiting for the first edge to fire…"}
              </p>
            )}
            <ul className="space-y-1.5">
              {shownFeed.map((a, i) => (
                <li key={`${a.ts}-${i}`} className="flex gap-3">
                  <span className="shrink-0 text-faint tabular-nums">{clock(a.ts)}</span>
                  <span className={`shrink-0 ${lineColor(a)}`}>{glyph(a)}</span>
                  <span className={a.type === "matchEvent" ? "text-muted" : "text-fg"}>
                    {a.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* SIDEBAR — agents */}
        <aside className="order-1 space-y-3 lg:order-2 lg:col-span-4">
          <p className="label px-1">running agents</p>
          {agents.length === 0 && <p className="card px-4 py-3 text-sm text-faint">no agents yet</p>}
          {agents.map((a) => {
            const cs = clvByAgent.get(a.id);
            const avgClv = cs && cs.n ? cs.sum / cs.n : 0;
            const settledN = a.wins + a.losses;
            const hitRate = settledN ? a.wins / settledN : 0;
            return (
            <div
              key={a.id}
              onClick={() => setSelected((cur) => (cur === a.id ? null : a.id))}
              className={`card cursor-pointer p-4 transition-colors ${
                selected === a.id ? "ring-1 ring-amber" : "hover:border-ink-500"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        a.status === "running" ? "bg-amber" : a.status === "paused" ? "bg-ink-500" : "bg-loss"
                      }`}
                    />
                    {a.name}
                  </p>
                  <p className="serif mt-0.5 truncate text-sm text-muted">{a.title}</p>
                </div>
                <span className="label shrink-0 rounded border border-ink-600 px-1.5 py-0.5">
                  {(a.edgeKinds ?? []).join("·")}
                </span>
              </div>

              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="label">avg clv</p>
                  <p className={`text-lg tabular-nums ${avgClv >= 0 ? "gain" : "loss"}`}>
                    {cs && cs.n ? `${(avgClv * 100).toFixed(1)}%` : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="label">hit-rate</p>
                  <p className="tabular-nums">{settledN ? `${(hitRate * 100).toFixed(0)}%` : "—"}</p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-faint">
                <span>
                  {a.wins} hit / {a.losses} miss · {a.bets} calls
                </span>
                <span>open {a.openPositions}</span>
              </div>

              <div className="mt-3 flex gap-2">
                {a.status === "running" ? (
                  <button onClick={(e) => { e.stopPropagation(); control(a.id, "pause"); }} className="flex-1 rounded border border-ink-600 py-1 text-xs text-muted hover:text-fg">
                    pause
                  </button>
                ) : a.status === "paused" ? (
                  <button onClick={(e) => { e.stopPropagation(); control(a.id, "resume"); }} className="flex-1 rounded border border-ink-600 py-1 text-xs text-amber hover:text-fg">
                    resume
                  </button>
                ) : (
                  <span className="flex-1 py-1 text-center text-xs text-faint">stopped</span>
                )}
                {a.status !== "stopped" && (
                  <button onClick={(e) => { e.stopPropagation(); control(a.id, "stop"); }} className="rounded border border-ink-600 px-3 py-1 text-xs text-muted hover:text-loss">
                    stop
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-lg tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
