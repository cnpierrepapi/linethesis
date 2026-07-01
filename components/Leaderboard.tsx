"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRemoteSnapshot, remoteConfigured, type RemoteSnapshot } from "@/lib/desk-remote";

interface AgentView {
  id: string;
  name: string;
  title: string;
  edgeKinds: string[];
  status: string;
  bets: number;
  wins: number;
  losses: number;
}

interface TradeRow {
  agentId: string;
  status: string;
  clvReturn: number;
}

export default function Leaderboard() {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Primary source: the EC2 worker mirror (foil Supabase, read direct) — the SAME
  // data the Signal Desk shows, so the tournament and the desk never disagree.
  // Poll is instant; no serverless function sits in the data path.
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

  // Fallback: in-app SSE replay, used only when the mirror has no data at all.
  useEffect(() => {
    const es = new EventSource("/api/feed");
    esRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.addEventListener("snapshot", (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data);
        setAgents(s.agents ?? []);
        setTrades(s.trades ?? []);
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, []);

  // Prefer the mirror whenever it carries agents/trades; otherwise fall back to SSE.
  const useRemote = !!remote && (remote.agents.length > 0 || remote.trades.length > 0);
  const remoteLive = !!remote?.fresh;
  const srcAgents: AgentView[] = useRemote
    ? remote!.agents.map((a) => ({
        id: a.id,
        name: a.name,
        title: a.title,
        edgeKinds: a.edgeKinds,
        status: a.status,
        bets: a.bets,
        wins: a.wins,
        losses: a.losses,
      }))
    : agents;
  const srcTrades: TradeRow[] = useRemote
    ? remote!.trades.map((t) => ({ agentId: t.agentId, status: t.status, clvReturn: t.clvReturn }))
    : trades;
  const connected = useRemote ? remoteLive : sseConnected;

  // Rank on closing-line value, the only honest skill metric here: average CLV
  // captured per settled call, with hit-rate (share of calls the line moved
  // toward) and sample size as tie-breakers. No P&L, no reward pool — a
  // calibration tournament, not a casino.
  const ranked = useMemo(() => {
    const clv = new Map<string, { sum: number; n: number }>();
    for (const t of srcTrades) {
      if (t.status !== "settled") continue;
      const e = clv.get(t.agentId) ?? { sum: 0, n: 0 };
      e.sum += t.clvReturn;
      e.n += 1;
      clv.set(t.agentId, e);
    }
    return [...srcAgents]
      .map((a) => {
        const c = clv.get(a.id);
        const avgClv = c && c.n ? c.sum / c.n : 0;
        const settledN = a.wins + a.losses;
        const hitRate = settledN ? a.wins / settledN : 0;
        return { ...a, avgClv, hitRate, sampleN: c?.n ?? settledN };
      })
      .sort((a, b) => b.avgClv - a.avgClv || b.hitRate - a.hitRate || b.sampleN - a.sampleN);
  }, [srcAgents, srcTrades]);

  const podium = ranked.slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">calibration tournament</p>
          <h1 className="serif mt-1 text-3xl">Calibration Tournament</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Forecasters ranked by <span className="amber">closing-line value</span> — average CLV captured per
            call, with hit-rate and sample size. CLV resolves from odds alone, so skill is graded on every call,
            not once per match.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-amber blink" : "bg-ink-500"}`} />
          {useRemote ? (remoteLive ? "LIVE · EC2" : "RECORDED · EC2") : connected ? "LIVE" : "connecting"}
        </span>
      </header>

      {/* podium */}
      {podium.length > 0 && (
        <div className="mb-8 flex items-end justify-center gap-3 sm:gap-5">
          {([podium[1], podium[0], podium[2]] as (typeof podium[number] | undefined)[]).map((a, i) => {
            if (!a) return <div key={i} className="w-28 sm:w-36" />;
            const place = a.id === podium[0]?.id ? 1 : a.id === podium[1]?.id ? 2 : 3;
            const h = place === 1 ? "h-32" : place === 2 ? "h-24" : "h-20";
            const first = place === 1;
            return (
              <div key={a.id} className="flex w-28 flex-col items-center sm:w-36">
                <p className={`serif truncate text-center text-sm ${first ? "text-paper" : "text-muted"}`}>{a.name}</p>
                <p className={`tabular-nums text-sm ${a.avgClv >= 0 ? "gain" : "loss"}`}>
                  {a.sampleN ? `${(a.avgClv * 100).toFixed(1)}%` : "—"}
                </p>
                <div className={`mt-2 flex w-full ${h} flex-col items-center justify-start rounded-t-lg border-t border-x ${first ? "border-amber-dim bg-amber/10" : "border-ink-600 bg-ink-700"} pt-3`}>
                  <span className={`font-mono text-2xl font-bold ${first ? "amber" : "text-muted"}`}>{place}</span>
                  {a.sampleN > 0 && (
                    <span className="mt-1 px-1 text-center text-[10px] text-faint">
                      {(a.hitRate * 100).toFixed(0)}% hit · {a.sampleN} calls
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* full table */}
      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-ink-600 px-4 py-2.5 text-xs sm:grid-cols-[2rem_1.4fr_1fr_auto_auto]">
          <span className="label">#</span>
          <span className="label">forecaster</span>
          <span className="label hidden sm:block">avg clv</span>
          <span className="label hidden text-right sm:block">hit-rate</span>
          <span className="label text-right">calls</span>
        </div>
        {ranked.length === 0 && <p className="px-4 py-6 text-sm text-faint">waiting for forecasters…</p>}
        {ranked.map((a, i) => (
          <div
            key={a.id}
            className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-ink-600 px-4 py-3 last:border-0 sm:grid-cols-[2rem_1.4fr_1fr_auto_auto]"
          >
            <span className={`font-mono ${i === 0 ? "amber" : "text-faint"}`}>{i + 1}</span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{a.name}</p>
              <p className="truncate text-xs text-faint">
                {(a.edgeKinds ?? []).join("·")} · {a.wins} hit/{a.losses} miss
              </p>
            </div>
            <span className={`hidden tabular-nums sm:block ${a.avgClv >= 0 ? "gain" : "loss"}`}>
              {a.sampleN ? `${(a.avgClv * 100).toFixed(1)}%` : "—"}
            </span>
            <span className="hidden text-right text-sm text-muted tabular-nums sm:block">
              {a.wins + a.losses ? `${(a.hitRate * 100).toFixed(0)}%` : "—"}
            </span>
            <span className="text-right text-sm tabular-nums text-muted">{a.bets}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
