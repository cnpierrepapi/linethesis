"use client";

// FAIR-VS-MARKET TIMELINE — the verification surface behind every fill link on /proof.
// One clock, two recorded lines: TxLINE's demargined fair and the prediction market's
// traded price. A fill on /proof says "the market printed X while fair was Y at second T";
// this chart lets anyone scrub to T and read both prices for themselves. Entry fills are
// plotted red (the lag), exit fills green (the convergence), so the claim is visual: the
// market really sat below fair when the entry traded, and really travelled to fair by the exit.
//
// Prices are shown in one frame: the chance the second-named team wins (yes-frame).
// Fills on the first-named side are converted (1 - price) so they sit on the same axis.

import { useMemo, useState } from "react";
import type { PickoffMatch, DivergenceEntry, ReplayPoint } from "@/lib/pickoff-source";
import { polygonTx } from "@/lib/pickoff-source";

const W = 1000;
const H = 400;
const PAD = { l: 46, r: 14, t: 14, b: 30 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;

const fmtClock = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// step lookup: the value in force at `sec` (series is change-based, values persist)
function valueAt(series: ReplayPoint[], sec: number, idx: 1 | 2): number | null {
  let v: number | null = null;
  for (const p of series) {
    if (p[0] > sec) break;
    const x = p[idx];
    if (x != null) v = x;
  }
  return v;
}

function stepPath(pts: Array<[number, number]>, x: (s: number) => number, y: (v: number) => number, endX?: number): string {
  if (!pts.length) return "";
  let d = `M${x(pts[0][0]).toFixed(1)},${y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `H${x(pts[i][0]).toFixed(1)}V${y(pts[i][1]).toFixed(1)}`;
  }
  if (endX != null) d += `H${endX.toFixed(1)}`;
  return d;
}

export default function FairTimeline({
  match,
  theta,
  focusT,
}: {
  match: PickoffMatch;
  theta: "5" | "10";
  focusT: number | null; // unix seconds (a fill's clock), from the /proof link
}) {
  const { series, kick, teams } = match;
  const parts = teams.split(/\s+v\s+/i).map((s) => s.trim());
  const team1 = parts[0] ?? "team 1";
  const team2 = parts[1] ?? "team 2";
  const divs = match.divergences?.[theta] ?? [];

  const toSec = (unixSec: number) => (unixSec * 1000 - kick) / 1000;
  const xMax = series.length ? series[series.length - 1][0] : 1;

  const x = (sec: number) => PAD.l + (Math.min(Math.max(sec, 0), xMax) / xMax) * PW;
  const y = (v: number) => PAD.t + (1 - Math.min(Math.max(v, 0), 1)) * PH;

  const fairPath = useMemo(() => {
    const pts = series.filter((p) => p[1] != null).map((p) => [p[0], p[1]] as [number, number]);
    return stepPath(pts, x, y, PAD.l + PW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);
  const bookPath = useMemo(() => {
    const pts = series.filter((p) => p[2] != null).map((p) => [p[0], p[2] as number] as [number, number]);
    return stepPath(pts, x, y, PAD.l + PW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  // fill markers, converted to the yes-frame so they sit on the market line
  const markers = useMemo(() => {
    const out: Array<{ sec: number; p: number; kind: "entry" | "exit"; tx: string; e: DivergenceEntry }> = [];
    for (const e of divs) {
      const yf = (price: number) => (e.side === "yes" ? price : 1 - price);
      if (e.entryFill) out.push({ sec: toSec(e.entryFill.t), p: yf(e.entryFill.price), kind: "entry", tx: e.entryFill.tx, e });
      if (e.exitFill) out.push({ sec: toSec(e.exitFill.t), p: yf(e.exitFill.price), kind: "exit", tx: e.exitFill.tx, e });
    }
    return out.filter((m) => m.sec >= 0 && m.sec <= xMax);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divs, kick, xMax]);

  const initialFocus = focusT != null ? Math.min(Math.max(toSec(focusT), 0), xMax) : null;
  const [focus, setFocus] = useState<number | null>(initialFocus);
  const [hover, setHover] = useState<number | null>(null);

  const readSec = hover ?? focus;
  const fair = readSec != null ? valueAt(series, readSec, 1) : null;
  const book = readSec != null ? valueAt(series, readSec, 2) : null;
  const gapPp = fair != null && book != null ? (book - fair) * 100 : null;
  // the fill this focus came from (a /proof link lands within a second of its fill)
  const focusFill = focus != null ? markers.find((m) => Math.abs(m.sec - focus) <= 2) : null;

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const svgX = ((ev.clientX - rect.left) / rect.width) * W;
    if (svgX < PAD.l || svgX > PAD.l + PW) return setHover(null);
    setHover(((svgX - PAD.l) / PW) * xMax);
  };

  const minuteTicks: number[] = [];
  for (let m = 0; m <= xMax / 60; m += 15) minuteTicks.push(m);

  return (
    <div className="space-y-4">
      {/* THE READOUT — the exact-second claim, stated in plain team prices */}
      <div className="card p-4">
        {readSec != null && fair != null ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-sm">
            <span className="text-faint">at {fmtClock(readSec)}</span>
            <span>
              <span className="text-faint">TxLINE fair · </span>
              <span className="text-amber">{team2} {fair.toFixed(3)}</span>
              <span className="text-muted"> / {team1} {(1 - fair).toFixed(3)}</span>
            </span>
            {book != null && (
              <span>
                <span className="text-faint">market · </span>
                <span className="text-info">{team2} {book.toFixed(3)}</span>
                {gapPp != null && Math.abs(gapPp) >= 0.05 && (
                  <span className={gapPp < 0 ? "text-loss" : "text-gain"}>
                    {" "}({Math.abs(gapPp).toFixed(1)}pp {gapPp < 0 ? "below" : "above"} fair)
                  </span>
                )}
              </span>
            )}
            {focusFill && hover == null && (
              <a
                href={polygonTx(focusFill.tx)}
                target="_blank"
                rel="noreferrer"
                className="text-muted underline decoration-ink-500 underline-offset-2 hover:text-fg"
              >
                the {focusFill.kind} fill at this second: {focusFill.tx.slice(0, 10)}… verify ↗
              </a>
            )}
          </div>
        ) : (
          <p className="font-mono text-sm text-faint">hover the chart, or open any fill link on the proof page, to read both prices at an exact second</p>
        )}
      </div>

      {/* THE CHART */}
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="text-muted"><span className="mr-1.5 inline-block h-[3px] w-5 bg-amber align-middle" />TxLINE fair</span>
          <span className="text-muted"><span className="mr-1.5 inline-block h-[3px] w-5 bg-info align-middle" />prediction market</span>
          <span className="text-muted"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-loss align-middle" />entry fill (the lag)</span>
          <span className="text-muted"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-gain align-middle" />exit fill (reached fair)</span>
          <span className="ml-auto text-faint">price = chance {team2} wins</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover != null && setFocus(hover)}
          role="img"
          aria-label={`TxLINE fair versus prediction market price over the ${teams} match`}
        >
          {/* grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + PW} y1={y(v)} y2={y(v)} stroke="var(--color-ink-600)" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--color-faint)" fontFamily="var(--font-mono)">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          {minuteTicks.map((m) => (
            <g key={m}>
              <line x1={x(m * 60)} x2={x(m * 60)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--color-ink-700)" strokeWidth="1" />
              <text x={x(m * 60)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-faint)" fontFamily="var(--font-mono)">
                {m}&apos;
              </text>
            </g>
          ))}

          <path d={bookPath} fill="none" stroke="var(--color-info)" strokeWidth="1.75" />
          <path d={fairPath} fill="none" stroke="var(--color-amber)" strokeWidth="2.25" />

          {markers.map((mk, i) => (
            <circle
              key={i}
              cx={x(mk.sec)}
              cy={y(mk.p)}
              r="5"
              fill="var(--color-ink-900)"
              stroke={mk.kind === "entry" ? "var(--color-loss)" : "var(--color-gain)"}
              strokeWidth="2"
              className="cursor-pointer"
              onClick={(ev) => {
                ev.stopPropagation();
                setFocus(mk.sec);
              }}
            >
              <title>{`${mk.kind} fill · ${fmtClock(mk.sec)} · ${mk.p.toFixed(3)}`}</title>
            </circle>
          ))}

          {focus != null && (
            <line x1={x(focus)} x2={x(focus)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--color-amber)" strokeWidth="1.5" strokeDasharray="5 4" />
          )}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="2 3" />
          )}
        </svg>
        <p className="mt-2 text-xs text-faint">
          Both lines replay the recorded feeds on a shared clock, downsampled to 1-second changes: the fair
          line is TxLINE&apos;s demargined price as we received it, the market line is the traded price
          rebuilt from on-chain fills. Click anywhere to pin a second; click a circle to jump to that fill.
        </p>
      </div>

      {/* THE CALLS — jump straight to each entry's moment */}
      {divs.length > 0 && (
        <div className="card p-4">
          <p className="label">the calls in this match · ≥{theta}pp · click one to jump to its entry second</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="py-1 font-normal">min</th>
                  <th className="py-1 font-normal">cheap side</th>
                  <th className="py-1 font-normal">entry</th>
                  <th className="py-1 font-normal">fair</th>
                  <th className="py-1 font-normal">reached fair</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {divs.map((e, i) => {
                  const sec = toSec(e.entryFill?.t ?? e.t);
                  const team = e.side === "yes" ? team2 : team1;
                  return (
                    <tr
                      key={i}
                      onClick={() => setFocus(Math.min(Math.max(sec, 0), xMax))}
                      className="cursor-pointer border-t border-ink-700 hover:bg-ink-800/60"
                    >
                      <td className="py-1.5 text-muted">{Math.max(0, Math.floor(sec / 60))}&apos;</td>
                      <td className="py-1.5 text-fg">{team}</td>
                      <td className="py-1.5 text-muted">{e.entry.toFixed(3)}</td>
                      <td className="py-1.5 text-fg">{(e.side === "yes" ? e.fair : 1 - e.fair).toFixed(3)}</td>
                      <td className={`py-1.5 ${e.reached ? "text-amber" : "text-faint"}`}>{e.reached ? "✓" : "✗"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
