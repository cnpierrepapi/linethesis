"use client";

import { useEffect, useState } from "react";

// THE CONTROL ROOM — where the read-only boundary is visible.
//  1. Current match: the live TxLINE book being benchmarked, in real time.
//  2. The boundary: each signal → the naive book's stale gap → the action the
//     OPERATOR'S policy chose. We emit the signal; their rule-set acts. We never
//     touch the book.  (data: /api/v1/control-room — deterministic over real frames)
//  3. The operator's rule-set: the policy the demo runs (editable via the SDK).

interface LiveFrame {
  market: string;
  line: string;
  priceNames: string[];
  fairProbs: number[];
  ageSec: number;
}
interface LiveFixture {
  fid: number | string;
  label: string;
  latestAgeSec: number;
  frames: LiveFrame[];
}
interface LiveData {
  configured: boolean;
  liveCount?: number;
  totalFrames?: number;
  fixtures?: LiveFixture[];
  note?: string;
}

interface CREvent {
  ts: number;
  minute: number | null;
  market: string;
  kind: "steam" | "overreaction" | "pregoal_warning";
  pRef: number;
  pWatched: number | null;
  gapBps: number | null;
  pickoffRisk: string;
  signalAction: string;
  operatorRule: number | null;
  operatorAction: string;
  proofHash: string;
  note: string;
}
interface ControlRoom {
  label: string;
  lagMs: number;
  boundary: string;
  summary: { total: number; acted: number; pickoffsFlagged: number };
  events: CREvent[];
}

// The operator's rule-set that the demo runs (mirrors lib/signals/policy.mjs DEMO_POLICY).
const POLICY = [
  { when: "goal imminent (momentum tape)", then: "suspend market" },
  { when: "overreaction · confidence ≥ 0.7", then: "widen margin +4%" },
  { when: "overreaction (any)", then: "cut limit to 50%" },
  { when: "steam · pickoff-risk high", then: "cut limit to 60%" },
];

const KIND_COLOR: Record<string, string> = {
  overreaction: "loss",
  steam: "amber",
  pregoal_warning: "text-muted",
};
function actionColor(a: string): string {
  if (a === "fade") return "loss";
  if (a === "follow") return "amber";
  return "text-muted";
}
function riskColor(r: string): string {
  return r === "high" ? "loss" : r === "med" ? "amber" : "text-faint";
}
function shortMarket(m: string): string {
  return m
    .replace("OVERUNDER_PARTICIPANT_GOALS", "O/U")
    .replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH")
    .replace("line=", "");
}
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export default function Desk() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [cr, setCr] = useState<ControlRoom | null>(null);

  // Current match — real-time TxLINE frames (server-side poll, works on Vercel).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/live-frames", { cache: "no-store" });
        const j = (await r.json()) as LiveData;
        if (alive) setLive(j);
      } catch {
        /* keep last */
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // The read-only boundary timeline (deterministic over real captured frames).
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/control-room", { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => alive && setCr(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const liveFixtures = live?.fixtures ?? [];
  const liveMatchOn = (live?.liveCount ?? 0) > 0;
  const liveFrameCount = live?.totalFrames ?? 0;
  const events = cr?.events ?? [];

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      {/* aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="signals" value={`${cr?.summary.total ?? 0}`} />
        <Stat label="pickoffs flagged" value={`${cr?.summary.pickoffsFlagged ?? 0}`} tone="loss" />
        <Stat label="operator actions" value={`${cr?.summary.acted ?? 0}`} />
        <div className="card flex items-center justify-between px-4 py-3">
          <span className="label">match</span>
          <span className="flex items-center gap-2 text-sm">
            <span className={`inline-block h-2 w-2 rounded-full ${liveMatchOn ? "bg-amber blink" : "bg-ink-500"}`} />
            {liveMatchOn ? "live" : "none"}
          </span>
        </div>
      </div>

      {/* the boundary statement */}
      <p className="mt-4 rounded border border-ink-600 bg-ink-850 px-4 py-2.5 text-sm text-muted">
        <span className="amber">Read-only.</span> Agenthesis emits the signal; the operator&apos;s policy takes the
        action. We benchmark the book — we never touch it.
      </p>

      {/* CURRENT MATCH — the live book being benchmarked */}
      <section className="panel mt-5">
        <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
          <div>
            <p className="label">current match — the book we benchmark</p>
            <p className="text-sm text-muted">
              {liveMatchOn
                ? `${liveFixtures.length} match${liveFixtures.length > 1 ? "es" : ""} in-play · ${liveFrameCount} live market frame${liveFrameCount === 1 ? "" : "s"} against the demargined consensus`
                : "no World Cup match is in-play right now — the boundary below replays a captured match"}
            </p>
          </div>
          <span className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-2 w-2 rounded-full ${liveMatchOn ? "bg-amber blink" : "bg-ink-500"}`} />
            {liveMatchOn ? "INGESTING · TxLINE" : "idle"}
          </span>
        </header>

        {live && !live.configured ? (
          <p className="px-5 py-4 text-sm text-faint">Live frames unavailable — no TxLINE token configured in this environment.</p>
        ) : liveMatchOn ? (
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
            {liveFixtures.map((f) => (
              <div key={f.fid} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="serif text-paper">{f.label}</p>
                  <span className={`text-xs tabular-nums ${f.latestAgeSec < 10 ? "gain" : "text-faint"}`}>
                    {f.latestAgeSec < 10 ? "● " : ""}freshest {f.latestAgeSec}s ago
                  </span>
                </div>
                <table className="mt-3 w-full text-left text-xs">
                  <tbody className="font-mono">
                    {f.frames.map((fr, i) => (
                      <tr key={i} className="border-t border-ink-700">
                        <td className="py-1 pr-2 text-muted">
                          {shortMarket(fr.market)}
                          {fr.line ? <span className="text-faint"> {fr.line}</span> : null}
                        </td>
                        <td className="py-1 pr-2 text-fg">
                          {fr.priceNames.map((n, j) => (
                            <span key={j} className="mr-2 whitespace-nowrap">
                              <span className="text-faint">{n}</span> {fr.fairProbs[j]?.toFixed(3)}
                            </span>
                          ))}
                        </td>
                        <td className={`py-1 text-right tabular-nums ${fr.ageSec < 10 ? "gain" : "text-faint"}`}>{fr.ageSec}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">
            {live?.note ?? "Odds are live-only, so the book appears the moment a match kicks off."} The boundary
            timeline below is a deterministic replay of a real captured match ({cr?.label ?? "…"}).
          </p>
        )}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* THE BOUNDARY — signal → stale-book gap → operator action */}
        <section className="panel order-2 flex min-h-[55vh] flex-col lg:order-1 lg:col-span-8">
          <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
            <div>
              <p className="label">the read-only boundary — {cr?.label ?? "loading"}</p>
              <p className="text-sm text-muted">
                signal (ours) → the naive book&apos;s stale gap → the action the operator&apos;s policy chose (theirs)
              </p>
            </div>
            <span className="text-xs text-faint tabular-nums">
              {cr ? `book lag ${(cr.lagMs / 1000).toFixed(0)}s · ${events.length} signals` : ""}
            </span>
          </header>
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-600 text-xs text-faint">
                  <Th>min</Th>
                  <Th>market</Th>
                  <Th>signal</Th>
                  <Th right>ref</Th>
                  <Th right>book gap</Th>
                  <Th>pickoff</Th>
                  <Th>operator action</Th>
                  <Th>proof</Th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {events.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-faint">
                      benchmarking against the demargined consensus…
                    </td>
                  </tr>
                )}
                {events.map((e, i) => (
                  <tr key={`${e.proofHash}-${e.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                    <td className="px-3 py-2 text-faint tabular-nums">{e.minute != null ? `${e.minute}'` : "—"}</td>
                    <td className="px-3 py-2 text-muted">{shortMarket(e.market)}</td>
                    <td className="px-3 py-2">
                      <span className={KIND_COLOR[e.kind] ?? "text-muted"}>{e.kind}</span>{" "}
                      <span className="text-faint">→</span>{" "}
                      <span className={actionColor(e.signalAction)}>{e.signalAction}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{e.pRef?.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.gapBps != null ? (
                        <span className={Math.abs(e.gapBps) >= 60 ? "loss" : "text-faint"}>
                          {e.gapBps > 0 ? "+" : ""}
                          {e.gapBps}bps
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${riskColor(e.pickoffRisk)}`}>{e.pickoffRisk}</td>
                    <td className="px-3 py-2 text-fg">{e.operatorAction}</td>
                    <td className="px-3 py-2">
                      <span className="amber" title="fingerprint of the real TxLINE frame this signal was derived from">
                        ⛓ {e.proofHash}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* THE OPERATOR'S RULE-SET */}
        <aside className="order-1 space-y-3 lg:order-2 lg:col-span-4">
          <div className="px-1">
            <p className="label">the operator&apos;s rule-set</p>
            <p className="mt-1 text-xs text-faint">
              The policy THEY control — editable via the SDK. We report which rule fired; the book takes the action.
            </p>
          </div>
          {POLICY.map((r, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-faint">
                when <span className="text-muted">{r.when}</span>
              </p>
              <p className="mt-1 text-sm">
                <span className="text-faint">then</span> <span className="text-fg">{r.then}</span>
              </p>
            </div>
          ))}
          <p className="px-1 text-xs text-faint">
            Every action here is the operator&apos;s. Agenthesis never places a bet, moves a price, or holds funds.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-lg tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
