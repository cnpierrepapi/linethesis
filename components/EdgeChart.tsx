"use client";

// Interactive fair-vs-market line chart. Move the pointer across it: a crosshair snaps to the
// nearest tick and a tooltip shows the TxLINE fair, the market price, and the gap. Where the two
// lines diverge past the threshold, the gap is shaded orange. Entry markers sit on the market line.

import { useMemo, useRef, useState } from "react";

export interface ChartFrame { ts: number; fair: number; pm: number | null }
export interface ChartEntry { ts: number; side: "yes" | "no"; gap: number; reached: boolean; fair: number }

const W = 760;
const H = 260;
const PAD = 8;

export default function EdgeChart({
  frames,
  entries = [],
  theta = 0.05,
}: {
  frames: ChartFrame[];
  entries?: ChartEntry[];
  theta?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pts = useMemo(() => (frames || []).filter((f) => f.fair != null), [frames]);
  const g = useMemo(() => {
    if (pts.length < 2) return null;
    const t0 = pts[0].ts;
    const tN = pts[pts.length - 1].ts || t0 + 1;
    const span = tN - t0 || 1;
    const x = (ts: number) => PAD + ((ts - t0) / span) * (W - 2 * PAD);
    const y = (p: number) => PAD + (1 - p) * (H - 2 * PAD);
    return { t0, span, x, y };
  }, [pts]);

  if (!g) return <p className="text-sm text-faint">No tape for this match.</p>;
  const { x, y } = g;

  const fairLine = pts.map((p) => `${x(p.ts).toFixed(1)},${y(p.fair).toFixed(1)}`).join(" ");
  const pmLine = pts.filter((p) => p.pm != null).map((p) => `${x(p.ts).toFixed(1)},${y(p.pm as number).toFixed(1)}`).join(" ");
  const gapBars = pts.filter((p) => p.pm != null && Math.abs(p.fair - (p.pm as number)) >= 0.01);

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(x(pts[i].ts) - relX);
      if (d < bd) { bd = d; best = i; }
    }
    setHover(best);
  };

  const hf = hover != null ? pts[hover] : null;
  const hoverPct = hf ? (x(hf.ts) / W) * 100 : 0;
  const min = (ts: number) => `${Math.max(0, Math.floor(ts / 60))}'`;
  const gapPp = hf && hf.pm != null ? (hf.fair - hf.pm) * 100 : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        style={{ height: 260 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((gl) => (
          <line key={gl} x1={PAD} x2={W - PAD} y1={y(gl)} y2={y(gl)} className="stroke-ink-700" strokeWidth={0.5} />
        ))}
        {gapBars.map((p, i) => {
          const ag = Math.abs(p.fair - (p.pm as number));
          return (
            <line key={i} x1={x(p.ts)} x2={x(p.ts)} y1={y(p.fair)} y2={y(p.pm as number)} className="stroke-amber" strokeWidth={1} opacity={Math.min(ag / 0.1, 1) * 0.5 + 0.12} />
          );
        })}
        <polyline points={pmLine} fill="none" className="stroke-muted" strokeWidth={1.25} />
        <polyline points={fairLine} fill="none" className="stroke-amber" strokeWidth={1.5} />
        {entries.map((en, i) => {
          const pmProb = en.side === "yes" ? en.fair - en.gap : en.fair + en.gap;
          return (
            <circle key={i} cx={x(en.ts)} cy={y(pmProb)} r={4} className={en.side === "yes" ? "fill-amber" : "fill-fg"} opacity={en.reached ? 1 : 0.4} stroke="#0a0c0f" strokeWidth={1} />
          );
        })}
        {hf && (
          <g>
            <line x1={x(hf.ts)} x2={x(hf.ts)} y1={PAD} y2={H - PAD} className="stroke-ink-500" strokeWidth={0.75} strokeDasharray="3 3" />
            <circle cx={x(hf.ts)} cy={y(hf.fair)} r={3.5} className="fill-amber" />
            {hf.pm != null && <circle cx={x(hf.ts)} cy={y(hf.pm)} r={3.5} className="fill-muted" />}
          </g>
        )}
      </svg>

      {hf && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded border border-ink-600 bg-ink-900/95 px-2 py-1 font-mono text-[11px] leading-tight shadow"
          style={{ left: `${Math.min(88, Math.max(12, hoverPct))}%` }}
        >
          <div className="text-faint">{min(hf.ts)}</div>
          <div className="text-amber">fair {hf.fair.toFixed(3)}</div>
          <div className="text-muted">mkt&nbsp; {hf.pm != null ? hf.pm.toFixed(3) : "—"}</div>
          {gapPp != null && (
            <div className={Math.abs(gapPp) >= theta * 100 ? "text-amber" : "text-faint"}>
              gap {gapPp > 0 ? "+" : ""}
              {gapPp.toFixed(1)}pp
            </div>
          )}
        </div>
      )}
    </div>
  );
}
