"use client";

// REPLAY-WITH-EDGE — see the divergence signal in play on a real match.
// Grades the SIGNAL, not a trader's P&L: TxLINE's vig-free fair leads, the prediction market book lags,
// and when the gap opens past θ the cheap side is underpriced. We show whether that divergence
// CLOSES (reach rate — PM travels to TxLINE) and the aggregate directional edge at resolution.
// Sizing and slippage are the consumer's problem, so there is no stake/P&L here by design.
// Metrics are computed on the FULL-resolution fills (published in the blob), not the coarse tape.

import { useMemo, useState } from "react";
import type { PickoffMatch, DivergenceEntry, PooledStat } from "@/lib/pickoff-source";
import EdgeChart, { type ChartFrame, type ChartEntry } from "@/components/EdgeChart";

const pct = (n: number) => (n * 100).toFixed(0) + "%";
const signed = (n: number) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
const usd = (n: number) => "$" + Math.round(n).toLocaleString();

export default function ReplayEdge({ matches, pooled: pub }: { matches: PickoffMatch[]; pooled?: Record<string, PooledStat> }) {
  const withEdge = matches.filter((m) => m.edge && Object.keys(m.edge).length);
  const [fid, setFid] = useState(withEdge[0]?.fid ?? "");
  const [theta, setTheta] = useState<"5" | "10">("5");

  const m = withEdge.find((x) => x.fid === fid) ?? withEdge[0];
  const edge = m?.edge?.[theta];
  const divs: DivergenceEntry[] = m?.divergences?.[theta] ?? [];
  const kickSec = m ? Math.floor(m.kick / 1000) : 0;

  const frames: ChartFrame[] = useMemo(
    () => (m?.series ?? []).filter((p) => p[1] != null).map((p) => ({ ts: p[0], fair: p[1] as number, pm: p[2] })),
    [m],
  );
  const entries: ChartEntry[] = useMemo(
    () => divs.map((e) => ({ ts: e.t - kickSec, side: e.side, gap: e.gap, reached: e.reached, fair: e.fair })),
    [divs, kickSec],
  );

  // pooled across every match at the chosen θ — prefer the published stat (carries the bootstrap
  // CI); fall back to a client-side pool if the blob predates it.
  const pooled = useMemo(() => {
    if (pub?.[theta]) return pub[theta];
    let n = 0, reach = 0, cost = 0, win = 0, size = 0;
    for (const mm of withEdge) for (const e of mm.divergences?.[theta] ?? []) {
      n++; reach += e.reached ? 1 : 0; cost += e.entry; win += e.win; size += e.usd ?? 0;
    }
    return { theta: Number(theta) / 100, n, reachRate: n ? reach / n : 0, aggEdgePct: cost ? (win - cost) / cost : 0, usd: size, ci90: null as [number, number] | null };
  }, [withEdge, theta, pub]);

  if (!m || !edge) {
    return <div className="card p-5 text-sm text-faint">The edge metrics publish after the pipeline runs. Check back shortly.</div>;
  }

  return (
    <div className="space-y-5">
      {/* POOLED HEADLINE — the signal graded across all matches */}
      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="label">the signal, across {withEdge.length} matches · θ = {theta}pp divergence</p>
          <div className="flex gap-1 text-xs">
            {(["5", "10"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheta(t)}
                className={`rounded px-2 py-0.5 ${theta === t ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}
              >
                ≥{t}pp
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="serif text-3xl text-amber">{pct(pooled.reachRate)}</p>
            <p className="text-xs text-muted">reached TxLINE (the delay closes)</p>
          </div>
          <div>
            <p className={`serif text-3xl ${pooled.aggEdgePct >= 0 ? "text-amber" : "text-muted"}`}>{signed(pooled.aggEdgePct)}</p>
            <p className="text-xs text-muted">aggregate edge{pooled.ci90 ? ` · 90% CI ${signed(pooled.ci90[0])}…${signed(pooled.ci90[1])}` : ""}</p>
          </div>
          <div>
            <p className="serif text-3xl text-fg">{pooled.n}</p>
            <p className="text-xs text-muted">entries · {usd(pooled.usd)} size available</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          Reach = did the prediction market price travel to TxLINE&apos;s line before full time. Aggregate edge = the
          cheap side&apos;s realized win-rate minus the price paid, pooled. The CI is a match-level bootstrap:
          it still spans zero at this N, so the edge is a pilot; reach is the firmer read, and both tighten as
          matches accrue. Size available = the book that sat at the stale price; how much to take is yours.
        </p>
      </div>

      {/* PER-MATCH REPLAY */}
      <div className="card p-5">
        <label className="flex w-fit flex-col gap-1">
          <span className="label">match</span>
          <select value={fid} onChange={(e) => setFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-sm text-fg">
            {withEdge.map((mm) => (
              <option key={mm.fid} value={mm.fid} className="bg-ink-800">{mm.teams}</option>
            ))}
          </select>
        </label>

        <div className="mt-4">
          <EdgeChart frames={frames} entries={entries} theta={Number(theta) / 100} />
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-faint">
            <span><span className="text-amber">—</span> TxLINE fair</span>
            <span><span className="text-muted">—</span> market price</span>
            <span><span className="text-amber opacity-50">▮</span> divergence</span>
            <span>● entry (faded = never reached fair)</span>
            <span className="ml-auto">hover to read any tick · reach {pct(edge.reachRate)} · edge {signed(edge.aggEdgePct)} · n {edge.n}</span>
          </div>
        </div>

        {divs.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="py-1 font-normal">side</th>
                  <th className="py-1 font-normal">entry price</th>
                  <th className="py-1 font-normal">TxLINE fair</th>
                  <th className="py-1 font-normal">gap</th>
                  <th className="py-1 font-normal">size avail.</th>
                  <th className="py-1 font-normal">reached</th>
                  <th className="py-1 font-normal">won</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {divs.map((e, i) => (
                  <tr key={i} className="border-t border-ink-700">
                    <td className="py-1.5 text-fg">{e.side === "yes" ? "buy YES" : "buy NO"}</td>
                    <td className="py-1.5 text-muted">{e.entry.toFixed(3)}</td>
                    <td className="py-1.5 text-fg">{(e.side === "yes" ? e.fair : 1 - e.fair).toFixed(3)}</td>
                    <td className="py-1.5 text-muted">{(e.gap * 100).toFixed(1)}pp</td>
                    <td className="py-1.5 text-muted">{usd(e.usd ?? 0)}</td>
                    <td className={`py-1.5 ${e.reached ? "text-amber" : "text-faint"}`}>{e.reached ? "✓" : "✗"}</td>
                    <td className={`py-1.5 ${e.win ? "text-amber" : "text-faint"}`}>{e.win ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
