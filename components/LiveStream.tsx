"use client";

// LIVE / REPLAY dual stream — one row per tick, showing BOTH the TxLINE fair and the market price
// side by side so the discrepancy is obvious. A row appears whenever either stream moves; the row
// glows orange in proportion to the gap.
//   LIVE   — reads the box blob (desk-archives/live-stream.json): two timestamped tick arrays.
//   REPLAY — plays back a settled match's 1s tape on a virtual clock.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PickoffMatch } from "@/lib/pickoff-source";

const THETA = 0.05;
// a fixture is "live" only while its ticks are fresh; a settled match's last tick is hours old, so
// past this staleness window we drop it from Live mode (it stays available under Replay).
const LIVE_MAX_AGE = 10 * 60 * 1000;
// Poll the same-origin, Vercel-cached proxy, NOT Supabase directly. Fetching the ~52KB blob straight
// off Supabase every 3s with a cache-buster blew the storage egress budget; /api/live-stream caps it.
const STREAM_BLOB = "/api/live-stream";

interface StreamFix { fid: string; teams: string; txline: [number, number][]; market: [number, number][] }
interface Row { key: string; label: string; fair: number | null; pm: number | null }

const lastTick = (f: StreamFix) =>
  Math.max(f.txline.length ? f.txline[f.txline.length - 1][0] : 0, f.market.length ? f.market[f.market.length - 1][0] : 0);

function stepAt(arr: [number, number][], ts: number): number | null {
  let v: number | null = null;
  for (const [t, val] of arr) {
    if (t <= ts) v = val;
    else break;
  }
  return v;
}
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

export default function LiveStream({ matches }: { matches: PickoffMatch[] }) {
  const replayable = matches.filter((m) => (m.series?.length ?? 0) > 2);
  const [mode, setMode] = useState<"live" | "replay">("live");

  // ---- LIVE ----
  const [fixtures, setFixtures] = useState<StreamFix[] | null>(null);
  const [liveFid, setLiveFid] = useState("");
  useEffect(() => {
    if (mode !== "live") return;
    let on = true;
    const load = () =>
      fetch(STREAM_BLOB)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!on) return;
          const fx: StreamFix[] = d?.fixtures ?? [];
          setFixtures(fx);
          setLiveFid((cur) => cur || fx[0]?.fid || "");
        })
        .catch(() => on && setFixtures([]));
    load();
    const iv = setInterval(load, 10000);
    return () => { on = false; clearInterval(iv); };
  }, [mode]);

  // only fixtures still ticking count as live; settled matches drop out (they live under Replay)
  const liveFixtures = useMemo(() => (fixtures ?? []).filter((f) => Date.now() - lastTick(f) < LIVE_MAX_AGE), [fixtures]);
  const liveFx = liveFixtures.find((f) => f.fid === liveFid) ?? liveFixtures[0];
  const liveRows: Row[] = useMemo(() => {
    if (!liveFx) return [];
    const tsSet = new Set<number>();
    liveFx.txline.forEach(([t]) => tsSet.add(t));
    liveFx.market.forEach(([t]) => tsSet.add(t));
    return [...tsSet]
      .sort((a, b) => b - a)
      .slice(0, 140)
      .map((t) => ({ key: String(t), label: hhmmss(t) + " UTC", fair: stepAt(liveFx.txline, t), pm: stepAt(liveFx.market, t) }));
  }, [liveFx]);

  // ---- REPLAY ----
  const [fid, setFid] = useState(replayable[0]?.fid ?? "");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(120);
  const [rTicks, setRTicks] = useState<Row[]>([]);
  const rIdx = useRef(0);
  const rm = replayable.find((m) => m.fid === fid) ?? replayable[0];
  useEffect(() => { setRTicks([]); rIdx.current = 0; }, [fid, mode]);
  useEffect(() => {
    if (mode !== "replay" || !rm || !playing) return;
    const series = rm.series;
    const iv = setInterval(() => {
      if (rIdx.current >= series.length) { setPlaying(false); return; }
      const [sec, fair, pm] = series[rIdx.current];
      rIdx.current += 1;
      if (fair == null) return;
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      setRTicks((prev) => [{ key: `r${rIdx.current}`, label: `${mm}:${String(ss).padStart(2, "0")}`, fair, pm }, ...prev].slice(0, 140));
    }, speed);
    return () => clearInterval(iv);
  }, [mode, rm, playing, speed]);

  const rows = mode === "live" ? liveRows : rTicks;
  const latest = rows[0];
  const latestGap = latest && latest.fair != null && latest.pm != null ? latest.fair - latest.pm : null;

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-600 px-4 py-3">
        <div className="flex gap-1 text-sm">
          {(["live", "replay"] as const).map((mt) => (
            <button key={mt} onClick={() => setMode(mt)} className={`rounded px-3 py-1 ${mode === mt ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}>
              {mt === "live" ? "● Live" : "Replay"}
            </button>
          ))}
        </div>
        {mode === "replay" ? (
          <div className="flex flex-wrap items-center gap-3">
            <select value={fid} onChange={(e) => setFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-sm text-fg">
              {replayable.map((m) => (<option key={m.fid} value={m.fid} className="bg-ink-800">{m.teams}</option>))}
            </select>
            <button onClick={() => setPlaying((p) => !p)} className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg">{playing ? "❙❙ pause" : "▶ play"}</button>
            <button onClick={() => { setRTicks([]); rIdx.current = 0; setPlaying(true); }} className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg">⟲ restart</button>
            <div className="flex gap-1 text-xs">
              {[240, 120, 40].map((s) => (<button key={s} onClick={() => setSpeed(s)} className={`rounded px-1.5 py-1 ${speed === s ? "text-amber" : "text-faint hover:text-fg"}`}>{s === 240 ? "1x" : s === 120 ? "2x" : "6x"}</button>))}
            </div>
          </div>
        ) : fixtures == null ? (
          <span className="text-xs text-faint">connecting to the detector…</span>
        ) : liveFx ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {liveFixtures.length > 1 && (
              <select value={liveFid} onChange={(e) => setLiveFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-fg">
                {liveFixtures.map((f) => (<option key={f.fid} value={f.fid} className="bg-ink-800">{f.teams}</option>))}
              </select>
            )}
            <span className="serif text-sm text-paper">{liveFx.teams}</span>
            {latest && (
              <span className="font-mono text-faint">
                fair <span className="text-amber">{latest.fair?.toFixed(3) ?? "—"}</span> · mkt <span className="text-muted">{latest.pm?.toFixed(3) ?? "—"}</span> ·{" "}
                <span className={latestGap != null && latestGap >= THETA ? "text-amber" : "text-faint"}>
                  gap {latestGap != null ? `${latestGap > 0 ? "+" : ""}${(latestGap * 100).toFixed(1)}pp` : "—"}
                </span>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-faint">waiting for next match · the feed fills at kickoff</span>
        )}
      </div>

      <div className="max-h-[440px] overflow-y-auto px-4 py-3 font-mono text-xs">
        <div className="mb-2 grid grid-cols-[7rem_1fr_1fr_4.5rem] gap-3 text-faint">
          <span>time</span><span>TxLINE fair</span><span>market</span><span className="text-right">gap</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-faint">{mode === "live" ? (liveFx ? "waiting for the first tick…" : "waiting for the next match to kick off…") : "press play to stream the match…"}</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const gap = r.fair != null && r.pm != null ? r.fair - r.pm : null;
              const pos = gap != null && gap > 0 ? gap : 0; // TxLINE above market = the cheap side to buy
              const tint = Math.min(pos / 0.1, 1) * 0.26;
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[7rem_1fr_1fr_4.5rem] gap-3 border-t border-ink-800 py-1"
                  style={pos > 0 ? { backgroundColor: `rgba(217,119,6,${tint.toFixed(3)})` } : undefined}
                >
                  <span className="text-faint">{r.label}</span>
                  <span className="text-amber">{r.fair != null ? r.fair.toFixed(3) : "—"}</span>
                  <span className="text-muted">{r.pm != null ? r.pm.toFixed(3) : "—"}</span>
                  <span className={`text-right ${gap != null && gap >= 0.02 ? "text-amber" : "text-faint"}`}>
                    {gap != null ? `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
