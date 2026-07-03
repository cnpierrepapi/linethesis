"use client";

import { useEffect, useRef, useState } from "react";
import { classifyEdge } from "@/lib/signals/classify.mjs";
import { evaluatePolicy, describeAction, DEMO_POLICY } from "@/lib/signals/policy.mjs";

// LIVE LINE-INTEGRITY — the demo. The deployed app can't hold an SSE open, so the browser
// polls the live snapshot and holds the history itself; on each new frame it runs our REAL
// classifier + operator policy. Naive book = the fair line a few seconds ago (the stale
// price that gets picked off). This is the exact engine logic from lib/, run live.

const POLL_MS = 4000;
const STEAM = 0.04; // pp move over the window = steam (mirrors engine DEFAULTS)
const OVERREACTION = 0.08; // pp swing near a goal = overreaction
const WINDOW_MS = 90_000; // look-back window for a move
const GOAL_WINDOW_MS = 150_000; // a move this soon after a goal is an overreaction
const LAG_MS = 8_000; // naive-book latency = the pickoff surface
const COOLDOWN_MS = 90_000; // don't re-fire the same market+kind
const HIST_MS = 300_000;

interface FrameOut {
  market: string;
  line: string;
  period: string;
  priceNames: string[];
  fairProbs: number[];
  ts: number;
  ageSec: number;
}
interface FixtureOut {
  fid: number | string;
  label: string;
  minute: number | null;
  goals: { p1: number; p2: number };
  latestAgeSec: number;
  frames: FrameOut[];
}
interface LiveSig {
  ts: number;
  match: string;
  minute: number | null;
  market: string;
  kind: string;
  signalAction: string;
  confidence: number;
  pRef: number;
  pWatched: number | null;
  gapBps: number | null;
  pickoffRisk: string;
  operatorAction: string;
  note: string;
}

const KIND_COLOR: Record<string, string> = { overreaction: "loss", steam: "amber", pregoal_warning: "text-muted" };
function actionColor(a: string): string {
  return a === "fade" ? "loss" : a === "follow" ? "amber" : "text-muted";
}
function riskColor(r: string): string {
  return r === "high" ? "loss" : r === "med" ? "amber" : "text-faint";
}
function shortMarket(m: string, line?: string): string {
  const s = m.replace("OVERUNDER_PARTICIPANT_GOALS", "O/U").replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH");
  return line ? `${s} ${String(line).replace("line=", "")}` : s;
}
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function valueAt(buf: { ts: number; prob: number }[], target: number): number | null {
  let best: number | null = null;
  for (const e of buf) {
    if (e.ts <= target) best = e.prob;
    else break;
  }
  return best;
}

const POLICY = [
  { when: "goal imminent (momentum tape)", then: "suspend market" },
  { when: "overreaction · confidence ≥ 0.7", then: "widen margin +4%" },
  { when: "overreaction (any)", then: "cut limit to 50%" },
  { when: "steam · pickoff-risk high", then: "cut limit to 60%" },
];

export default function LiveBoundary() {
  const [fixtures, setFixtures] = useState<FixtureOut[]>([]);
  const [configured, setConfigured] = useState(true);
  const [connected, setConnected] = useState(false);
  const [signals, setSignals] = useState<LiveSig[]>([]);

  const hist = useRef(new Map<string, { ts: number; prob: number }[]>());
  const lastGoals = useRef(new Map<string, { p1: number; p2: number }>());
  const goalAt = useRef(new Map<string, number>());
  const cooldown = useRef(new Map<string, number>());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/live-signals", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setConfigured(j.configured !== false);
        setConnected(true);
        const fx: FixtureOut[] = j.fixtures ?? [];
        setFixtures(fx);
        detect(fx);
      } catch {
        setConnected(false);
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detect(fx: FixtureOut[]) {
    const fresh: LiveSig[] = [];
    for (const f of fx) {
      const fid = String(f.fid);
      // goal change → mark an overreaction window
      const prev = lastGoals.current.get(fid);
      if (prev && (f.goals.p1 > prev.p1 || f.goals.p2 > prev.p2)) goalAt.current.set(fid, Date.now());
      lastGoals.current.set(fid, f.goals);
      const goalRecent = (goalAt.current.get(fid) ?? 0) > 0 && Date.now() - (goalAt.current.get(fid) ?? 0) <= GOAL_WINDOW_MS;

      for (const fr of f.frames) {
        if (!/PARTICIPANT_GOALS/.test(fr.market)) continue; // on-chain-settleable scope only
        fr.priceNames.forEach((side, j) => {
          const prob = fr.fairProbs[j];
          if (!(prob > 0.02 && prob < 0.98)) return;
          const key = `${fid}|${fr.market}|${fr.line}|${fr.period}|${side}`;
          const buf = hist.current.get(key) ?? [];
          if (!buf.length || buf[buf.length - 1].ts !== fr.ts) buf.push({ ts: fr.ts, prob });
          while (buf.length && buf[0].ts < fr.ts - HIST_MS) buf.shift();
          hist.current.set(key, buf);

          const now = fr.ts;
          const probThen = valueAt(buf, now - WINDOW_MS);
          if (probThen == null) return;
          const delta = prob - probThen;
          const kind = goalRecent && Math.abs(delta) >= OVERREACTION ? "overreaction" : !goalRecent && Math.abs(delta) >= STEAM ? "steam" : null;
          if (!kind) return;
          const ck = `${key}|${kind}`;
          if (now - (cooldown.current.get(ck) ?? 0) < COOLDOWN_MS) return;
          cooldown.current.set(ck, now);

          const edge = {
            kind,
            market: { fixtureId: fid, superOddsType: fr.market, marketParameters: fr.line, marketPeriod: fr.period, side, inRunning: true },
            edgeMeasure: Math.abs(delta),
            fairProb: prob,
            preEventProb: probThen,
            direction: kind === "steam" ? (delta > 0 ? "back" : "lay") : delta > 0 ? "lay" : "back",
            openedAt: now,
            note: `${(probThen * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}%${goalRecent ? " (post-goal)" : ""}`,
            trigger: goalRecent ? "GOAL" : undefined,
          };
          const watchedProb = valueAt(buf, now - LAG_MS);
          const sig = classifyEdge(edge, { minute: f.minute, watchedProb, preEventProb: probThen });
          if (!sig) return;
          const pol = evaluatePolicy(DEMO_POLICY, sig);
          fresh.push({
            ts: now,
            match: f.label,
            minute: f.minute,
            market: sig.market,
            kind: sig.kind,
            signalAction: sig.action,
            confidence: sig.confidence,
            pRef: sig.pRef,
            pWatched: sig.pWatched,
            gapBps: sig.gapBps,
            pickoffRisk: sig.pickoffRisk,
            operatorAction: describeAction(pol.action),
            note: sig.note,
          });
        });
      }
    }
    if (fresh.length) setSignals((prev) => [...fresh.reverse(), ...prev].slice(0, 60));
  }

  const liveOn = fixtures.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">live line-integrity — naive book vs TxLINE consensus</p>
          <h1 className="serif mt-1 text-2xl">Watch the pickoff, live.</h1>
          <p className="mt-1 text-sm text-muted">
            The classifier runs in real time on the in-play book. Naive book = the fair line {LAG_MS / 1000}s ago — the
            stale price a sharp lifts. We warn; the operator&apos;s policy acts.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${liveOn ? "bg-amber blink" : "bg-ink-500"}`} />
          {!configured ? "no token" : liveOn ? "LIVE · TxLINE" : connected ? "idle — no match in-play" : "connecting"}
        </span>
      </header>

      {!configured ? (
        <p className="panel px-5 py-4 text-sm text-faint">Live feed unavailable — no TxLINE token configured in this environment.</p>
      ) : !liveOn ? (
        <p className="panel px-5 py-6 text-sm text-muted">
          No World Cup match is in-play right now. Odds are live-only, so the book and its signals appear the moment a
          match kicks off — keep this page open through kickoff.
        </p>
      ) : (
        <>
          {/* live book per fixture */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {fixtures.map((f) => (
              <div key={f.fid} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="serif text-paper">
                    {f.label} <span className="text-faint">· {f.goals.p1}-{f.goals.p2}</span>
                    {f.minute != null && <span className="text-faint"> · {f.minute}&apos;</span>}
                  </p>
                  <span className={`text-xs tabular-nums ${f.latestAgeSec < 10 ? "gain" : "text-faint"}`}>
                    {f.latestAgeSec < 10 ? "● " : ""}freshest {f.latestAgeSec}s
                  </span>
                </div>
                <table className="mt-3 w-full text-left text-xs">
                  <tbody className="font-mono">
                    {f.frames.filter((fr) => /PARTICIPANT_GOALS/.test(fr.market)).slice(0, 5).map((fr, i) => (
                      <tr key={i} className="border-t border-ink-700">
                        <td className="py-1 pr-2 text-muted">{shortMarket(fr.market, fr.line)}</td>
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

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* live boundary */}
            <section className="panel order-2 flex min-h-[45vh] flex-col lg:order-1 lg:col-span-8">
              <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
                <div>
                  <p className="label">the read-only boundary — live</p>
                  <p className="text-sm text-muted">signal (ours) → the naive book&apos;s stale gap → the operator&apos;s action (theirs)</p>
                </div>
                <span className="text-xs text-faint tabular-nums">{signals.length} signals</span>
              </header>
              <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-600 text-xs text-faint">
                      <Th>time</Th>
                      <Th>market</Th>
                      <Th>signal</Th>
                      <Th right>ref</Th>
                      <Th right>book gap</Th>
                      <Th>pickoff</Th>
                      <Th>operator action</Th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {signals.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-faint">
                          benchmarking the live book against the demargined consensus…
                        </td>
                      </tr>
                    )}
                    {signals.map((s, i) => (
                      <tr key={`${s.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                        <td className="px-3 py-2 text-faint tabular-nums">{clock(s.ts)}</td>
                        <td className="px-3 py-2 text-muted">{shortMarket(s.market)}</td>
                        <td className="px-3 py-2">
                          <span className={KIND_COLOR[s.kind] ?? "text-muted"}>{s.kind}</span>{" "}
                          <span className="text-faint">→</span> <span className={actionColor(s.signalAction)}>{s.signalAction}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{s.pRef?.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.gapBps != null ? (
                            <span className={Math.abs(s.gapBps) >= 60 ? "loss" : "text-faint"}>
                              {s.gapBps > 0 ? "+" : ""}
                              {s.gapBps}bps
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 ${riskColor(s.pickoffRisk)}`}>{s.pickoffRisk}</td>
                        <td className="px-3 py-2 text-fg">{s.operatorAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* operator rule-set */}
            <aside className="order-1 space-y-3 lg:order-2 lg:col-span-4">
              <div className="px-1">
                <p className="label">the operator&apos;s rule-set</p>
                <p className="mt-1 text-xs text-faint">The policy THEY control. We report which rule fired; the book takes the action.</p>
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
              <p className="px-1 text-xs text-faint">Read-only: no bet placed, no price moved, no funds held.</p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
