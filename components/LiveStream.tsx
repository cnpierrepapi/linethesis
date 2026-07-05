"use client";

// LIVE / REPLAY dual stream.
//   LIVE   — reads the box's real-time blob (desk-archives/live-stream.json): two INDEPENDENT
//            timestamped tick arrays (TxLINE fair, market price). Interleaved newest-first so you
//            see TxLINE move, then the market catch up. Rows where the gap >= theta glow orange.
//   REPLAY — plays back a settled match's aligned tape on a virtual clock (one merged series).

import { useEffect, useMemo, useRef, useState } from "react";
import type { PickoffMatch } from "@/lib/pickoff-source";

const THETA = 0.05;
const STREAM_BLOB =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co") +
  "/storage/v1/object/public/desk-archives/live-stream.json";

interface StreamFix { fid: string; teams: string; txline: [number, number][]; market: [number, number][] }
interface Row { key: string; ts: number; label: string; kind: "txline" | "market"; v: number; fair: number | null; pm: number | null }

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

  // ---- LIVE state ----
  const [fixtures, setFixtures] = useState<StreamFix[] | null>(null);
  const [liveFid, setLiveFid] = useState<string>("");

  useEffect(() => {
    if (mode !== "live") return;
    let on = true;
    const load = () =>
      fetch(`${STREAM_BLOB}?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!on) return;
          const fx: StreamFix[] = d?.fixtures ?? [];
          setFixtures(fx);
          setLiveFid((cur) => cur || fx[0]?.fid || "");
        })
        .catch(() => on && setFixtures([]));
    load();
    const iv = setInterval(load, 4000);
    return () => { on = false; clearInterval(iv); };
  }, [mode]);

  const liveFx = fixtures?.find((f) => f.fid === liveFid) ?? fixtures?.[0];
  const liveRows: Row[] = useMemo(() => {
    if (!liveFx) return [];
    const rows: Row[] = [];
    for (const [ts, v] of liveFx.txline) rows.push({ key: `t${ts}`, ts, label: hhmmss(ts) + " UTC", kind: "txline", v, fair: null, pm: null });
    for (const [ts, v] of liveFx.market) rows.push({ key: `m${ts}`, ts, label: hhmmss(ts) + " UTC", kind: "market", v, fair: null, pm: null });
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, 80).map((r) => ({ ...r, fair: stepAt(liveFx.txline, r.ts), pm: stepAt(liveFx.market, r.ts) }));
  }, [liveFx]);

  // ---- REPLAY state ----
  const [fid, setFid] = useState(replayable[0]?.fid ?? "");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(250);
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
      setRTicks((prev) => [{ key: `r${rIdx.current}`, ts: sec, label: `${mm}:${String(ss).padStart(2, "0")}`, kind: "txline" as const, v: fair, fair, pm }, ...prev].slice(0, 80));
    }, speed);
    return () => clearInterval(iv);
  }, [mode, rm, playing, speed]);

  const rows = mode === "live" ? liveRows : rTicks;
  const latest = liveFx && liveFx.txline.length && liveFx.market.length
    ? { fair: liveFx.txline[liveFx.txline.length - 1][1], pm: liveFx.market[liveFx.market.length - 1][1] }
    : null;
  const latestGap = latest ? latest.fair - latest.pm : null;

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
              {[500, 250, 100].map((s) => (<button key={s} onClick={() => setSpeed(s)} className={`rounded px-1.5 py-1 ${speed === s ? "text-amber" : "text-faint hover:text-fg"}`}>{s === 500 ? "1x" : s === 250 ? "2x" : "5x"}</button>))}
            </div>
          </div>
        ) : fixtures == null ? (
          <span className="text-xs text-faint">connecting to the detector…</span>
        ) : liveFx ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {(fixtures?.length ?? 0) > 1 && (
              <select value={liveFid} onChange={(e) => setLiveFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-fg">
                {fixtures!.map((f) => (<option key={f.fid} value={f.fid} className="bg-ink-800">{f.teams}</option>))}
              </select>
            )}
            <span className="serif text-sm text-paper">{liveFx.teams}</span>
            {latest && (
              <span className="font-mono text-faint">
                fair <span className="text-amber">{latest.fair.toFixed(3)}</span> · mkt <span className="text-muted">{latest.pm.toFixed(3)}</span> ·{" "}
                <span className={latestGap != null && Math.abs(latestGap) >= THETA ? "text-amber" : "text-faint"}>
                  gap {latestGap != null ? `${latestGap > 0 ? "+" : ""}${(latestGap * 100).toFixed(1)}pp` : "—"}
                </span>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-faint">no match in-play right now · the feed fills at kickoff</span>
        )}
      </div>

      <div className="max-h-[440px] overflow-y-auto px-4 py-3 font-mono text-xs">
        <div className="mb-2 grid grid-cols-[6.5rem_5rem_1fr_4.5rem] gap-3 text-faint">
          <span>time</span><span>stream</span><span>price</span><span className="text-right">gap</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-faint">{mode === "live" ? "waiting for the first tick…" : "press play to stream the match…"}</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const gap = r.fair != null && r.pm != null ? r.fair - r.pm : null;
              const ag = gap != null ? Math.abs(gap) : 0;
              const tint = Math.min(ag / 0.1, 1) * 0.24; // any gap tints; full orange by ~10pp
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[6.5rem_5rem_1fr_4.5rem] gap-3 border-t border-ink-800 py-1"
                  style={ag > 0 ? { backgroundColor: `rgba(217,119,6,${tint.toFixed(3)})` } : undefined}
                >
                  <span className="text-faint">{r.label}</span>
                  <span className={r.kind === "txline" ? "text-amber" : "text-muted"}>{r.kind === "txline" ? "TxLINE" : "market"}</span>
                  <span className="text-fg">{r.v.toFixed(3)}</span>
                  <span className={`text-right ${ag >= 0.02 ? "text-amber" : ag > 0 ? "text-muted" : "text-faint"}`}>
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
