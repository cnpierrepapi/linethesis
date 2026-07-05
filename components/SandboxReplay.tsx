"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PickoffMatch } from "@/lib/pickoff-source";

// THE DEMO: plug in a real recorded match (prediction market fills read on-chain, aligned to TxLINE
// fair) and watch it get picked off in compressed real time. The play is real; only the clock
// is sped up. Fair = TxLINE demargined P(win); book = the market's own price, lagging. When a
// goal moves the fair and the book hasn't caught up, the gap opens and the stale side is lifted.

const usd = (n: number) => "$" + Math.round(n).toLocaleString();

export default function SandboxReplay({ matches }: { matches: PickoffMatch[] }) {
  const [mi, setMi] = useState(0);
  const [t, setT] = useState(0); // cursor, seconds from kick
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(120); // match-seconds per real-second
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  const m = matches[mi];
  const dur = m?.series.length ? m.series[m.series.length - 1][0] : 0;

  // pickoff markers in seconds-from-kick
  const marks = useMemo(
    () =>
      (m?.top_pickoffs ?? [])
        .map((p) => ({ sec: Math.max(0, Math.round(p.t - m.kick / 1000)), gap: p.gap_pp, usd: p.usd, tx: p.tx }))
        .sort((a, b) => a.sec - b.sec),
    [m],
  );

  // y-range from the data (zoom to the action)
  const [yMin, yMax] = useMemo(() => {
    let lo = 1, hi = 0;
    for (const [, f, b] of m?.series ?? []) {
      lo = Math.min(lo, f, b ?? f); hi = Math.max(hi, f, b ?? f);
    }
    const pad = Math.max(0.05, (hi - lo) * 0.15);
    return [Math.max(0, lo - pad), Math.min(1, hi + pad)];
  }, [m]);

  useEffect(() => { setT(0); setPlaying(false); }, [mi]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000; last.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= dur) { setPlaying(false); return dur; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, dur]);

  if (!m) return <p className="text-sm text-faint">No recorded matches published yet.</p>;

  // chart geometry
  const W = 860, H = 340, PADL = 8, PADR = 8, PADT = 12, PADB = 22;
  const pw = W - PADL - PADR, ph = H - PADT - PADB;
  const x = (sec: number) => PADL + (dur ? (sec / dur) * pw : 0);
  const y = (p: number) => PADT + (1 - (p - yMin) / (yMax - yMin || 1)) * ph;
  const line = (idx: 1 | 2) =>
    m.series
      .filter((pt) => pt[0] <= t && pt[idx] != null)
      .map((pt) => `${x(pt[0]).toFixed(1)},${y(pt[idx] as number).toFixed(1)}`)
      .join(" ");

  // live readout at the cursor
  const cur = [...m.series].filter((pt) => pt[0] <= t).pop() ?? m.series[0];
  const curFair = cur?.[1] ?? null, curBook = cur?.[2] ?? null;
  const gap = curFair != null && curBook != null ? (curBook - curFair) * 100 : null;
  const caught = marks.filter((k) => k.sec <= t);
  const leaked = caught.reduce((s, k) => s + k.usd, 0);
  const minute = Math.floor(t / 60);

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={mi}
          onChange={(e) => setMi(Number(e.target.value))}
          className="rounded border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-fg"
        >
          {matches.map((mm, i) => (
            <option key={mm.fid} value={i}>{mm.teams}</option>
          ))}
        </select>
        <button
          onClick={() => (t >= dur ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}
          className="rounded border border-amber-dim bg-amber/10 px-4 py-1.5 text-sm font-semibold text-amber hover:bg-amber/20"
        >
          {playing ? "❚❚ Pause" : t >= dur ? "↻ Replay" : "▶ Play"}
        </button>
        <button onClick={() => { setPlaying(false); setT(0); }} className="rounded border border-ink-600 px-3 py-1.5 text-sm text-muted hover:text-fg">Reset</button>
        <label className="flex items-center gap-2 text-xs text-faint">
          speed
          <input type="range" min={30} max={300} step={10} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
        <Link href={`/report/${m.fid}`} className="ml-auto rounded border border-ink-600 px-3 py-1.5 text-sm text-muted hover:text-fg">
          ↓ Download report
        </Link>
      </div>

      {/* live readout */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="match clock" value={`${minute}'`} />
        <Stat label="TxLINE fair" value={curFair != null ? curFair.toFixed(3) : "—"} />
        <Stat label="book price" value={curBook != null ? curBook.toFixed(3) : "—"} tone={gap != null && Math.abs(gap) >= 5 ? "amber" : undefined} />
        <Stat label="caught leakage" value={usd(leaked)} tone="amber" />
      </div>

      {/* chart */}
      <div className="card mt-4 p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
          {/* pickoff markers that have fired */}
          {caught.map((k, i) => (
            <line key={i} x1={x(k.sec)} x2={x(k.sec)} y1={PADT} y2={PADT + ph}
              stroke={Math.abs(k.gap) >= 10 ? "#f5a623" : "#6b7280"} strokeOpacity={0.28} strokeWidth={1} />
          ))}
          {/* book (lagging) then fair (sharp) */}
          <polyline points={line(2)} fill="none" stroke="#e5e7eb" strokeWidth={1.6} strokeOpacity={0.85} />
          <polyline points={line(1)} fill="none" stroke="#f5a623" strokeWidth={2} />
          {/* cursor */}
          <line x1={x(t)} x2={x(t)} y1={PADT} y2={PADT + ph} stroke="#9ca3af" strokeOpacity={0.5} strokeDasharray="3 3" />
          {/* half/full time ticks */}
          {[0, 45, 90].map((mk) => (
            <text key={mk} x={x(mk * 60)} y={H - 6} fontSize={10} fill="#6b7280" textAnchor="middle">{mk}&apos;</text>
          ))}
        </svg>
        <div className="mt-2 flex gap-4 text-xs text-faint">
          <span><span className="inline-block h-2 w-3 align-middle" style={{ background: "#f5a623" }} /> TxLINE fair</span>
          <span><span className="inline-block h-2 w-3 align-middle" style={{ background: "#e5e7eb" }} /> book price</span>
          <span>vertical lines = pickoffs (amber ≥10pp)</span>
        </div>
      </div>

      <p className="mt-4 max-w-3xl text-sm text-muted">
        {m.teams}: {usd(m.inplay.usd)} of real book, median gap {m.inplay.median_pp}pp. Press play and
        watch the book track the fair at the spread, then lag when a goal hits, the moment the stale side
        gets lifted. This is a replay of real on-chain fills; only the clock is compressed.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="card p-3">
      <p className={`serif text-2xl ${tone === "amber" ? "text-amber" : "text-fg"}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
