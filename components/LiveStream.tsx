"use client";

// LIVE / REPLAY dual stream. Two modes:
//   LIVE   — polls the box detector every 15s; each poll appends a tick per in-play fixture.
//   REPLAY — plays back a settled match's aligned tape on a virtual clock.
// Every tick shows the TxLINE fair and the market price at that timestamp; when the gap opens past
// the threshold the row is highlighted orange. That orange is the lead-lag, the moment to take.

import { useEffect, useRef, useState } from "react";
import type { PickoffMatch, LiveEdge } from "@/lib/pickoff-source";

const THETA = 0.05;

interface Tick {
  key: string;
  label: string; // timestamp (match clock in replay, UTC in live)
  teams?: string;
  fair: number;
  pm: number | null;
}

export default function LiveStream({ matches }: { matches: PickoffMatch[] }) {
  const replayable = matches.filter((m) => (m.series?.length ?? 0) > 2);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [fid, setFid] = useState(replayable[0]?.fid ?? "");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(250);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [liveInfo, setLiveInfo] = useState<{ count: number; at: number } | null>(null);
  const rIdx = useRef(0);

  const rm = replayable.find((m) => m.fid === fid) ?? replayable[0];

  // reset the feed on any mode / match change
  useEffect(() => {
    setTicks([]);
    rIdx.current = 0;
  }, [fid, mode]);

  // REPLAY playback on a virtual clock
  useEffect(() => {
    if (mode !== "replay" || !rm || !playing) return;
    const series = rm.series;
    const iv = setInterval(() => {
      if (rIdx.current >= series.length) {
        setPlaying(false);
        return;
      }
      const row = series[rIdx.current];
      rIdx.current += 1;
      const sec = row[0];
      const fair = row[1];
      const pm = row[2];
      if (fair == null) return;
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      setTicks((prev) => [{ key: `r${rIdx.current}`, label: `${mm}:${String(ss).padStart(2, "0")}`, fair, pm }, ...prev].slice(0, 80));
    }, speed);
    return () => clearInterval(iv);
  }, [mode, rm, playing, speed]);

  // LIVE polling of the box detector
  useEffect(() => {
    if (mode !== "live") return;
    let on = true;
    const load = () =>
      fetch("/api/live-edge")
        .then((r) => r.json())
        .then((d: LiveEdge) => {
          if (!on) return;
          setLiveInfo({ count: d.liveCount ?? 0, at: d.generatedAt ?? Date.now() });
          const now = new Date().toISOString().slice(11, 19);
          const rows: Tick[] = (d.signals ?? []).map((s, i) => ({ key: `l${d.generatedAt}-${i}`, label: `${now} UTC`, teams: s.teams, fair: s.fair, pm: s.pm }));
          if (rows.length) setTicks((prev) => [...rows, ...prev].slice(0, 80));
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 15000);
    return () => {
      on = false;
      clearInterval(iv);
    };
  }, [mode]);

  return (
    <div className="card overflow-hidden p-0">
      {/* header: mode toggle + controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-600 px-4 py-3">
        <div className="flex gap-1 text-sm">
          {(["live", "replay"] as const).map((mt) => (
            <button
              key={mt}
              onClick={() => setMode(mt)}
              className={`rounded px-3 py-1 ${mode === mt ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}
            >
              {mt === "live" ? "● Live" : "Replay"}
            </button>
          ))}
        </div>

        {mode === "replay" ? (
          <div className="flex flex-wrap items-center gap-3">
            <select value={fid} onChange={(e) => setFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-sm text-fg">
              {replayable.map((m) => (
                <option key={m.fid} value={m.fid} className="bg-ink-800">{m.teams}</option>
              ))}
            </select>
            <button onClick={() => setPlaying((p) => !p)} className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg">
              {playing ? "❙❙ pause" : "▶ play"}
            </button>
            <button
              onClick={() => { setTicks([]); rIdx.current = 0; setPlaying(true); }}
              className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg"
            >
              ⟲ restart
            </button>
            <div className="flex gap-1 text-xs">
              {[500, 250, 100].map((s) => (
                <button key={s} onClick={() => setSpeed(s)} className={`rounded px-1.5 py-1 ${speed === s ? "text-amber" : "text-faint hover:text-fg"}`}>
                  {s === 500 ? "1x" : s === 250 ? "2x" : "5x"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <span className="text-xs text-faint">
            {liveInfo == null
              ? "connecting to the detector…"
              : liveInfo.count > 0
              ? `${liveInfo.count} match in-play · polling every 15s`
              : "no match in-play right now · the feed fills at kickoff"}
          </span>
        )}
      </div>

      {/* the stream */}
      <div className="max-h-[420px] overflow-y-auto px-4 py-3 font-mono text-xs">
        <div className="mb-2 grid grid-cols-[5.5rem_1fr_1fr_4rem] gap-3 text-faint">
          <span>time</span>
          <span>TxLINE fair</span>
          <span>market</span>
          <span className="text-right">gap</span>
        </div>
        {ticks.length === 0 ? (
          <p className="text-faint">{mode === "live" ? "waiting for a live divergence…" : "press play to stream the match…"}</p>
        ) : (
          <ul>
            {ticks.map((t) => {
              const gap = t.pm != null ? t.fair - t.pm : null;
              const diverged = gap != null && Math.abs(gap) >= THETA;
              return (
                <li key={t.key} className={`grid grid-cols-[5.5rem_1fr_1fr_4rem] gap-3 border-t border-ink-800 py-1 ${diverged ? "bg-amber/5" : ""}`}>
                  <span className="text-faint">{t.label}</span>
                  <span className="text-fg">
                    {t.teams ? <span className="text-faint">{t.teams.split(" v ")[1] ?? ""} </span> : null}
                    {t.fair.toFixed(3)}
                  </span>
                  <span className="text-muted">{t.pm != null ? t.pm.toFixed(3) : "—"}</span>
                  <span className={`text-right ${diverged ? "text-amber" : "text-faint"}`}>
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
