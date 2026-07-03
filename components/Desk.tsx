"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// THE ARCHIVE — signals from every recorded match, browsable per match. The live demo
// lives on /live; this is the durable record: pick a match, see the read-only boundary
// (signal → stale-book gap → operator action) the classifier produced over its frames.
// Match list from /api/v1/signals; per-match timeline from /api/v1/control-room.

interface FixtureRef {
  fixtureId: string;
  label: string;
  signalCount: number;
}
interface CREvent {
  ts: number;
  minute: number | null;
  market: string;
  kind: string;
  pRef: number;
  pWatched: number | null;
  gapBps: number | null;
  pickoffRisk: string;
  signalAction: string;
  operatorAction: string;
  proofHash: string;
}
interface ControlRoom {
  label: string;
  summary: { total: number; acted: number; pickoffsFlagged: number };
  events: CREvent[];
}

const POLICY = [
  { when: "goal imminent (momentum tape)", then: "suspend market" },
  { when: "overreaction · confidence ≥ 0.7", then: "widen margin +4%" },
  { when: "overreaction (any)", then: "cut limit to 50%" },
  { when: "steam · pickoff-risk high", then: "cut limit to 60%" },
];

const KIND_COLOR: Record<string, string> = { overreaction: "loss", steam: "amber", pregoal_warning: "text-muted" };
function actionColor(a: string): string {
  return a === "fade" ? "loss" : a === "follow" ? "amber" : "text-muted";
}
function riskColor(r: string): string {
  return r === "high" ? "loss" : r === "med" ? "amber" : "text-faint";
}
function shortMarket(m: string): string {
  return m.replace("OVERUNDER_PARTICIPANT_GOALS", "O/U").replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH").replace("line=", "");
}

export default function Desk() {
  const [fixtures, setFixtures] = useState<FixtureRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cr, setCr] = useState<ControlRoom | null>(null);

  // load the match list once
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/signals", { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const fx: FixtureRef[] = (j.fixtures ?? []).map((f: FixtureRef) => ({
          fixtureId: f.fixtureId,
          label: f.label,
          signalCount: f.signalCount,
        }));
        setFixtures(fx);
        if (fx.length && !selected) setSelected(fx[0].fixtureId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the selected match's boundary timeline
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/v1/control-room?fixtureId=${encodeURIComponent(selected)}`, { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => alive && setCr(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected]);

  const events = cr?.events ?? [];

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">the archive — recorded signals, per match</p>
          <h1 className="serif mt-1 text-2xl">Every signal, on record.</h1>
          <p className="mt-1 text-sm text-muted">
            The classifier&apos;s read-only boundary over every recorded match. Watching a match live?{" "}
            <Link href="/live" className="amber hover:text-fg">
              Open the live view →
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="signals" value={`${cr?.summary.total ?? 0}`} />
          <Stat label="pickoffs" value={`${cr?.summary.pickoffsFlagged ?? 0}`} tone="loss" />
          <Stat label="op actions" value={`${cr?.summary.acted ?? 0}`} />
        </div>
      </header>

      {/* MATCH SELECTOR */}
      <div className="mb-5 flex flex-wrap gap-2">
        {fixtures.length === 0 && <span className="text-sm text-faint">loading matches…</span>}
        {fixtures.map((f) => (
          <button
            key={f.fixtureId}
            onClick={() => setSelected(f.fixtureId)}
            className={`rounded border px-3 py-1.5 text-sm transition-colors ${
              selected === f.fixtureId ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"
            }`}
          >
            {f.label} <span className="text-faint tabular-nums">· {f.signalCount}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* THE BOUNDARY for the selected match */}
        <section className="panel order-2 flex min-h-[50vh] flex-col lg:order-1 lg:col-span-8">
          <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
            <div>
              <p className="label">the read-only boundary — {cr?.label ?? "loading"}</p>
              <p className="text-sm text-muted">signal (ours) → the naive book&apos;s stale gap → the operator&apos;s action (theirs)</p>
            </div>
            <span className="text-xs text-faint tabular-nums">{events.length} signals</span>
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
                      select a match…
                    </td>
                  </tr>
                )}
                {events.map((e, i) => (
                  <tr key={`${e.proofHash}-${e.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                    <td className="px-3 py-2 text-faint tabular-nums">{e.minute != null ? `${e.minute}'` : "—"}</td>
                    <td className="px-3 py-2 text-muted">{shortMarket(e.market)}</td>
                    <td className="px-3 py-2">
                      <span className={KIND_COLOR[e.kind] ?? "text-muted"}>{e.kind}</span>{" "}
                      <span className="text-faint">→</span> <span className={actionColor(e.signalAction)}>{e.signalAction}</span>
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
                      <span className="amber" title="fingerprint of the real TxLINE frame">
                        ⛓ {e.proofHash}
                      </span>
                    </td>
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
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3 text-center">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-lg tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
