"use client";

// LIVE DETECTOR PANEL — polls the box's real-time divergence read (TxLINE 1X2 fair vs the
// prediction market book) every 20s and flags divergences the instant they open. Idle between matches.

import { useEffect, useState } from "react";
import type { LiveEdge } from "@/lib/pickoff-source";

export default function LiveEdgePanel() {
  const [d, setD] = useState<LiveEdge | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/live-edge")
        .then((r) => r.json())
        .then((x: LiveEdge) => { if (on) setD(x); })
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { on = false; clearInterval(t); };
  }, []);

  const live = !!d && d.liveCount > 0 && d.signals.length > 0;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="label">
          live detector{" "}
          {live ? <span className="text-amber">● in-play</span> : <span className="text-faint">○ idle</span>}
        </p>
        {d && <span className="font-mono text-xs text-faint">updated {new Date(d.generatedAt).toISOString().slice(11, 19)} UTC</span>}
      </div>
      {live ? (
        <div className="mt-3 space-y-2">
          {d!.signals.map((s) => (
            <div key={s.fid} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span className="serif text-paper">{s.teams}</span>
              <span className="font-mono text-muted">fair {s.fair.toFixed(3)} · book {s.pm.toFixed(3)}</span>
              <span className={`font-mono ${s.diverged ? "text-amber" : "text-faint"}`}>
                {s.gapPp > 0 ? "+" : ""}
                {s.gapPp}pp {s.diverged ? `· DIVERGENCE: buy ${s.side.toUpperCase()} cheap` : "· at the line"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-faint">
          No World Cup match is in-play right now. The detector polls TxLINE&apos;s live 1X2 fair against the
          prediction market book every minute and flags a divergence the moment the book lags past the threshold.
          Check back at kickoff.
        </p>
      )}
    </div>
  );
}
