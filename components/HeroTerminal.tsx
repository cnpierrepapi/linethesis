"use client";

import { useEffect, useRef, useState } from "react";

// The hero tape shows the PRODUCT: real divergences from the published track record. Each line is
// a moment the prediction market lagged TxLINE's vig-free fair, the cheap side to take, the size
// that sat there, and whether the market later travelled back to fair. Revealed one at a time so a
// static snapshot reads like a live scan.
//
// EGRESS NOTE: `items` are computed on the SERVER (app/page.tsx, from the cached getPickoffs ledger)
// and passed in as props. This component MUST NOT fetch the ~600KB pickoffs.json from the client:
// that pulled the full blob straight off Supabase on every homepage visit, bypassing Vercel's CDN,
// and blew the storage egress budget. Keep the blob server-side, shared and cached.
export interface Div {
  teams: string;
  side: "yes" | "no";
  entry: number;
  fair: number;
  gap: number;
  reached: boolean;
  usd: number;
}

export default function HeroTerminal({ items }: { items: Div[] }) {
  const [shown, setShown] = useState<Div[]>([]);
  const idx = useRef(0);

  useEffect(() => {
    if (!items.length) return;
    const iv = setInterval(() => {
      const e = items[idx.current % items.length];
      idx.current += 1;
      setShown((prev) => [e, ...prev].slice(0, 7));
    }, 1400);
    return () => clearInterval(iv);
  }, [items]);

  const loaded = items.length > 0;

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
        <span className="label">divergences.log</span>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${loaded ? "bg-amber blink" : "bg-ink-500"}`} />
          {loaded ? "REPLAY" : "loading"}
        </span>
      </header>
      <div className="min-h-[240px] px-4 py-3 font-mono text-xs">
        {shown.length === 0 && <p className="text-faint">scanning the market against the vig-free fair…</p>}
        <ul className="space-y-2">
          {shown.map((e, i) => {
            const mkt = e.side === "yes" ? e.entry : 1 - e.entry;
            return (
              <li key={i} className="leading-relaxed">
                <span className="text-muted">{e.teams}</span>{" "}
                <span className="text-faint">
                  fair {e.fair.toFixed(2)} · mkt {mkt.toFixed(2)}
                </span>{" "}
                <span className="amber">+{(e.gap * 100).toFixed(0)}pp</span>{" "}
                <span className="text-faint">→</span> <span className="text-fg">buy {e.side.toUpperCase()} cheap</span>
                <br />
                <span className="text-faint">└ ${Math.round(e.usd).toLocaleString()} on the table ·</span>{" "}
                <span className={e.reached ? "amber" : "text-faint"}>{e.reached ? "travelled back to fair ✓" : "held"}</span>
              </li>
            );
          })}
        </ul>
        <p className="prompt mt-2 text-faint">
          <span className="blink amber">_</span>
        </p>
      </div>
    </div>
  );
}
