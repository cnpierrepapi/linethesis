"use client";

import { useEffect, useRef, useState } from "react";

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
  paperTitle: string;
  edgeKind: string;
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

interface Snapshot {
  mode: string;
  status: string;
  agents: AgentView[];
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function money(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
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
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "control", id, op }),
    });
  }

  const agents = snap?.agents ?? [];
  const realized = agents.reduce((s, a) => s + a.bankroll, 0);
  const dayPnl = agents.reduce((s, a) => s + a.dayPnl, 0);
  const running = agents.filter((a) => a.status === "running").length;
  const open = agents.reduce((s, a) => s + a.openPositions, 0);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      {/* aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="realized" value={`$${realized.toFixed(2)}`} />
        <Stat label="day p&l" value={money(dayPnl)} tone={dayPnl >= 0 ? "gain" : "loss"} />
        <Stat label="agents" value={`${running} running`} />
        <Stat label="open" value={`${open}`} />
        <div className="card flex items-center justify-between px-4 py-3">
          <span className="label">feed</span>
          <span className="flex items-center gap-2 text-sm">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-amber" : "bg-ink-500"}`} />
            {snap?.mode ?? "…"}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* HERO — live autonomous activity */}
        <section className="panel order-2 flex min-h-[60vh] flex-col lg:order-1 lg:col-span-8">
          <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
            <div>
              <p className="label">live activity</p>
              <p className="text-sm text-muted">agents trading autonomously — no human in the loop</p>
            </div>
            <span className="flex items-center gap-2 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-amber blink" : "bg-ink-500"}`} />
              {connected ? "LIVE" : "connecting"}
            </span>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 font-mono text-sm">
            <p className="prompt mb-3 text-faint">
              tail -f desk.log<span className="blink ml-1 amber">_</span>
            </p>
            {feed.length === 0 && (
              <p className="text-faint">waiting for the first edge to fire…</p>
            )}
            <ul className="space-y-1.5">
              {feed.map((a, i) => (
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
          {agents.map((a) => (
            <div key={a.id} className="card p-4">
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
                  <p className="serif mt-0.5 truncate text-sm text-muted">{a.paperTitle}</p>
                </div>
                <span className="label shrink-0 rounded border border-ink-600 px-1.5 py-0.5">{a.edgeKind}</span>
              </div>

              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="label">bankroll</p>
                  <p className="text-lg tabular-nums">${a.bankroll.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="label">day p&l</p>
                  <p className={`tabular-nums ${a.dayPnl >= 0 ? "gain" : "loss"}`}>{money(a.dayPnl)}</p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-faint">
                <span>
                  {a.wins}W / {a.losses}L · {a.bets} bets
                </span>
                <span>
                  open {a.openPositions}
                  {a.unrealized !== 0 && (
                    <span className={a.unrealized >= 0 ? "gain" : "loss"}> ({money(a.unrealized)})</span>
                  )}
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                {a.status === "running" ? (
                  <button onClick={() => control(a.id, "pause")} className="flex-1 rounded border border-ink-600 py-1 text-xs text-muted hover:text-fg">
                    pause
                  </button>
                ) : a.status === "paused" ? (
                  <button onClick={() => control(a.id, "resume")} className="flex-1 rounded border border-ink-600 py-1 text-xs text-amber hover:text-fg">
                    resume
                  </button>
                ) : (
                  <span className="flex-1 py-1 text-center text-xs text-faint">stopped</span>
                )}
                {a.status !== "stopped" && (
                  <button onClick={() => control(a.id, "stop")} className="rounded border border-ink-600 px-3 py-1 text-xs text-muted hover:text-loss">
                    stop
                  </button>
                )}
              </div>
            </div>
          ))}
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
