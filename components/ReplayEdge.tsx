"use client";

// SIGNAL FEED — every divergence call across all matches, as a sortable feed.
// Grades the SIGNAL, not a trader's P&L: TxLINE's vig-free fair leads, the prediction market lags,
// and when the gap opens past theta the cheap side is underpriced. Each row is one call: when it
// fired, which side was cheap, how big the gap, the price you paid vs fair, the size that sat there,
// and whether the gap CLOSED (reached fair). The headline metric is the Kelly-sized, take-profit-at-
// fair ROI. Computed on the FULL-resolution fills published in the blob, not a coarse tape.

import { useMemo, useState } from "react";
import type { PickoffMatch, DivergenceEntry, PooledStat } from "@/lib/pickoff-source";

const pct = (n: number) => (n * 100).toFixed(0) + "%";
const roiFmt = (n: number) => (n >= 0 ? "+" : "") + (n * 100).toFixed(0) + "%";
const usd = (n: number) => "$" + Math.round(n).toLocaleString();

// Kelly-sized bankroll multipliers: f = gap/(1-entry); take-profit exits at fair on reach, else the
// close; the resolution variant holds to the final result (the losing contrast).
const kmult = (e: DivergenceEntry) => {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, e.gap / d)) : 0;
  const r = e.entry > 0 ? (e.reached ? e.gap : e.clv ?? 0) / e.entry : 0;
  return 1 + f * r;
};
const kmres = (e: DivergenceEntry) => {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, e.gap / d)) : 0;
  const r = e.win ? (1 - e.entry) / e.entry : -1;
  return 1 + f * r;
};

// "Portugal v Croatia" -> "POR v CRO"
function code(teams: string): string {
  const parts = teams.split(/\s+v\s+/i);
  if (parts.length !== 2) return teams.slice(0, 12);
  return parts.map((p) => p.trim().slice(0, 3).toUpperCase()).join(" v ");
}

type Sort = "gap" | "size" | "match" | "outcome";

interface Call {
  key: string;
  fid: string;
  code: string;
  teams: string;
  minute: number;
  side: "yes" | "no";
  entry: number;
  fairSide: number;
  gap: number;
  usd: number;
  reached: boolean;
  win: number;
}

export default function ReplayEdge({ matches, pooled: pub }: { matches: PickoffMatch[]; pooled?: Record<string, PooledStat> }) {
  const withEdge = matches.filter((m) => m.edge && Object.keys(m.edge).length);
  const [theta, setTheta] = useState<"5" | "10">("5");
  const [sort, setSort] = useState<Sort>("gap");
  const [fid, setFid] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);

  // flatten every call at the chosen theta across all matches
  const calls: Call[] = useMemo(() => {
    const out: Call[] = [];
    for (const m of withEdge) {
      const kickSec = Math.floor(m.kick / 1000);
      const divs: DivergenceEntry[] = m.divergences?.[theta] ?? [];
      divs.forEach((e, i) => {
        out.push({
          key: `${m.fid}-${i}`,
          fid: m.fid,
          code: code(m.teams),
          teams: m.teams,
          minute: Math.max(0, Math.floor((e.t - kickSec) / 60)),
          side: e.side,
          entry: e.entry,
          fairSide: e.side === "yes" ? e.fair : 1 - e.fair,
          gap: e.gap,
          usd: e.usd ?? 0,
          reached: e.reached,
          win: e.win,
        });
      });
    }
    return out;
  }, [withEdge, theta]);

  const filtered = useMemo(() => (fid === "all" ? calls : calls.filter((c) => c.fid === fid)), [calls, fid]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "gap") arr.sort((a, b) => b.gap - a.gap);
    else if (sort === "size") arr.sort((a, b) => b.usd - a.usd);
    else if (sort === "match") arr.sort((a, b) => a.teams.localeCompare(b.teams) || a.minute - b.minute);
    else arr.sort((a, b) => Number(b.reached) - Number(a.reached) || b.gap - a.gap);
    return arr;
  }, [filtered, sort]);

  const maxGap = useMemo(() => Math.max(0.05, ...filtered.map((c) => c.gap)), [filtered]);

  // pooled across every match at the chosen theta — prefer the published stat (carries the bootstrap
  // CI); fall back to a client-side pool if the blob predates it.
  const pooled = useMemo(() => {
    // always derive from the matches so a stale blob (missing tpReturn) can never NaN the header;
    // overlay the published stat (carries the bootstrap CIs) when present.
    let n = 0, reach = 0, size = 0, kTp = 1, kRes = 1;
    for (const mm of withEdge) for (const e of mm.divergences?.[theta] ?? []) {
      n++; reach += e.reached ? 1 : 0; size += e.usd ?? 0; kTp *= kmult(e); kRes *= kmres(e);
    }
    const derived = { theta: Number(theta) / 100, n, reachRate: n ? reach / n : 0, kellyRoi: n ? kTp - 1 : 0, kellyRoiRes: n ? kRes - 1 : 0, usd: size };
    const pubp = pub?.[theta];
    return pubp ? { ...derived, ...pubp, kellyRoi: pubp.kellyRoi ?? derived.kellyRoi, kellyRoiRes: pubp.kellyRoiRes ?? derived.kellyRoiRes } : derived;
  }, [withEdge, theta, pub]);

  if (!withEdge.length) {
    return <div className="card p-5 text-sm text-faint">The calls publish after the pipeline runs. Check back shortly.</div>;
  }

  const sortBtn = (s: Sort, label: string) => (
    <button
      key={s}
      onClick={() => setSort(s)}
      className={`rounded px-2 py-0.5 ${sort === s ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}
    >
      {label}
      {sort === s ? " ▾" : ""}
    </button>
  );

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
                onClick={() => { setTheta(t); setOpen(null); }}
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
            <p className={`serif text-3xl ${pooled.kellyRoi >= 0 ? "text-amber" : "text-muted"}`}>{roiFmt(pooled.kellyRoi)}</p>
            <p className="text-xs text-muted">ROI · Kelly-sized, take-profit at fair</p>
          </div>
          <div>
            <p className="serif text-3xl text-fg">{pooled.n}</p>
            <p className="text-xs text-muted">calls · {usd(pooled.usd)} size available</p>
          </div>
        </div>

        {/* WHY KELLY — evidence, not assertion */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded border border-ink-700 bg-ink-900/40 px-4 py-3 text-sm">
          <span className="label">why Kelly + take-profit:</span>
          <span><span className={pooled.kellyRoi >= 0 ? "text-amber" : "text-muted"}>{roiFmt(pooled.kellyRoi)}</span> <span className="text-xs text-muted">take profit at fair</span></span>
          <span><span className={(pooled.kellyRoiRes ?? 0) >= 0 ? "text-amber" : "text-loss"}>{roiFmt(pooled.kellyRoiRes ?? 0)}</span> <span className="text-xs text-muted">same bets, held to the result</span></span>
        </div>

        <p className="mt-3 text-xs text-faint">
          Reach = did the prediction market price travel to TxLINE&apos;s line before full time. ROI = the
          compounding return of Kelly-sized bets (f = gap / (1 − price)) that exit at TxLINE&apos;s fair on
          reach, else mark out at the close; never held to resolution. Same signal, same bets: taking profit
          on convergence pays; holding to the result loses on a coin-flip, and betting flat with full
          compounding goes to zero. It is concentrated in a few high-volume matches, so treat it as a pilot
          that firms up as matches accrue. Size available = the liquidity you could exit into at the
          take-profit price (TxLINE fair or better); nil when the price never reached fair.
        </p>
      </div>

      {/* THE FEED — every call, sortable */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            match
            <select value={fid} onChange={(e) => { setFid(e.target.value); setOpen(null); }} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-sm text-fg">
              <option value="all" className="bg-ink-800">all matches</option>
              {withEdge.map((mm) => (
                <option key={mm.fid} value={mm.fid} className="bg-ink-800">{mm.teams}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-faint">sort</span>
            {sortBtn("gap", "gap")}
            {sortBtn("size", "size")}
            {sortBtn("match", "match")}
            {sortBtn("outcome", "reached")}
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          {sorted.map((c) => {
            const on = open === c.key;
            return (
              <div key={c.key} className={`rounded border ${on ? "border-amber/40 bg-amber/5" : "border-ink-700 hover:border-ink-500"}`}>
                <button
                  onClick={() => setOpen(on ? null : c.key)}
                  className="grid w-full grid-cols-[minmax(0,7rem)_4rem_1fr_minmax(0,6rem)_minmax(0,5rem)_2rem] items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-fg">{c.code}</span>
                    <span className="ml-1 text-xs text-faint">{c.minute}&apos;</span>
                  </span>
                  <span className={`text-xs ${c.side === "yes" ? "text-amber" : "text-fg"}`}>{c.side === "yes" ? "buy YES" : "buy NO"}</span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-ink-700">
                      <span className="block h-full rounded bg-amber" style={{ width: `${Math.min(100, (c.gap / maxGap) * 100)}%` }} />
                    </span>
                    <span className="w-10 shrink-0 font-mono text-xs text-amber">{(c.gap * 100).toFixed(0)}pp</span>
                  </span>
                  <span className="font-mono text-xs text-muted">{c.entry.toFixed(2)} → {c.fairSide.toFixed(2)}</span>
                  <span className="font-mono text-xs text-muted">{usd(c.usd)}</span>
                  <span className={c.reached ? "text-amber" : "text-faint"} title={c.reached ? "reached fair" : "never reached fair"}>{c.reached ? "✓" : "✗"}</span>
                </button>
                {on && (
                  <div className="border-t border-ink-700 px-3 py-2 text-xs text-muted">
                    <span className="text-faint">{c.teams}</span> · at {c.minute}&apos; the {c.side === "yes" ? "YES" : "NO"} side traded{" "}
                    <span className="font-mono text-fg">{c.entry.toFixed(3)}</span> while TxLINE&apos;s fair was{" "}
                    <span className="font-mono text-amber">{c.fairSide.toFixed(3)}</span>, a{" "}
                    <span className="text-amber">{(c.gap * 100).toFixed(1)}pp</span> gap on the cheap side.{" "}
                    <span className="font-mono">{usd(c.usd)}</span> sat there. The price{" "}
                    {c.reached ? <span className="text-amber">reached fair</span> : <span className="text-faint">never reached fair</span>}.
                  </div>
                )}
              </div>
            );
          })}
          {!sorted.length && <p className="text-sm text-faint">No calls past {theta}pp for this filter.</p>}
        </div>

        <div className="mt-2 flex flex-wrap gap-4 text-xs text-faint">
          <span><span className="text-amber">▮</span> gap on the cheap side</span>
          <span>reach ✓ = price travelled to fair</span>
          <span className="ml-auto">{sorted.length} calls · click a row to read it</span>
        </div>
      </div>
    </div>
  );
}
