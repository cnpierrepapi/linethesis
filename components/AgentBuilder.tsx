"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PAPERS, DEFAULT_BASE_LEVERS, type AgentLevers, type Paper } from "@/lib/papers";
import type { EdgeKind } from "@/lib/edge/types";
import { sendRemoteCreate, remoteConfigured } from "@/lib/desk-remote";

const KIND_LABELS: Record<EdgeKind, string> = {
  quote: "Baseline (quote)",
  steam: "Steam",
  overreaction: "Overreaction",
};

function previewSentence(name: string, L: AgentLevers, papers: Paper[]): string {
  const who = name.trim() || "This forecaster";
  const verb = L.direction === "follow" ? "follows" : "fades";
  const pp = (L.minConviction * 100).toFixed(1);
  const kinds = L.edgeKinds.map((k) => KIND_LABELS[k].toLowerCase()).join(" + ") || "nothing";
  const phase =
    L.phase === "pre"
      ? "pre-match"
      : L.phase === "inplay"
        ? `in-play${L.minMinute > 0 ? ` after ${L.minMinute}'` : ""}${L.maxMinute < 90 ? ` until ${L.maxMinute}'` : ""}`
        : "any phase";
  const base = `${who} ${verb} the ${kinds} call on its own tuning — flagging mispricings above ${pp}pp, ${phase}, odds ${L.oddsMin.toFixed(2)}–${L.oddsMax.toFixed(2)}, max ${L.maxConcurrent} open.`;
  if (!papers.length) return base;
  const list = papers.map((p) => p.title).join("; ");
  return `${base} It also runs ${papers.length} research paper${papers.length > 1 ? "s" : ""} alongside that base: ${list}.`;
}

export default function AgentBuilder({ initialPaper }: { initialPaper: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [levers, setLevers] = useState<AgentLevers>(() => ({ ...DEFAULT_BASE_LEVERS }));
  const [papers, setPapers] = useState<string[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pre-attach the paper the user came from. Every paper is available.
    if (initialPaper && PAPERS.some((p) => p.id === initialPaper)) setPapers([initialPaper]);
  }, [initialPaper]);

  function set<K extends keyof AgentLevers>(key: K, val: AgentLevers[K]) {
    setLevers((L) => ({ ...L, [key]: val }));
  }
  function toggleKind(k: EdgeKind) {
    setLevers((L) => {
      const has = L.edgeKinds.includes(k);
      const next = has ? L.edgeKinds.filter((x) => x !== k) : [...L.edgeKinds, k];
      return { ...L, edgeKinds: next };
    });
  }
  function togglePaper(id: string) {
    setPapers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const attached = useMemo(() => PAPERS.filter((p) => papers.includes(p.id)), [papers]);
  const preview = useMemo(() => previewSentence(name, levers, attached), [name, levers, attached]);

  async function deploy() {
    setError(null);
    if (!name.trim()) return setError("name your forecaster");
    if (!levers.edgeKinds.length && !papers.length) return setError("give it a base signal or attach a paper");
    setDeploying(true);
    try {
      // The live runner lives on the EC2 worker (the desk reads its mirror), so a
      // create must be QUEUED there — posting to the ephemeral Vercel runner would
      // land on a per-request lambda and never reach the desk. Fall back to the
      // in-app runner only when no mirror is configured.
      if (remoteConfigured) {
        const ok = await sendRemoteCreate(name.trim(), papers, levers);
        if (!ok) throw new Error("could not reach the live desk — try again in a moment");
      } else {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", name: name.trim(), paperIds: papers, baseLevers: levers }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || "deploy failed");
      }
      router.push("/desk");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setDeploying(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6">
        <p className="label">deploy a forecaster</p>
        <h1 className="serif mt-1 text-3xl">Build a Forecaster</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every forecaster runs an always-on <span className="text-fg">base tuning</span> on the live book, and can run any
          number of <span className="text-fg">research papers</span> alongside it. Tune the base, then attach papers.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* base tuning */}
        <section className="panel p-5 lg:col-span-2">
          <p className="label mb-3">base tuning — always on</p>

          <div className="mb-5">
            <span className="label">Signals the base calls</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(KIND_LABELS) as EdgeKind[]).map((k) => {
                const on = levers.edgeKinds.includes(k);
                return (
                  <button
                    key={k}
                    onClick={() => toggleKind(k)}
                    className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                      on ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {KIND_LABELS[k]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-faint">
              Baseline (quote) reads the live line continuously even when no sharp move fires — proof the forecaster is
              acting on real data. Steam/overreaction here run on your base tuning without a paper.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Range label="Conviction floor" value={levers.minConviction} min={0.003} max={0.2} step={0.001} fmt={(v) => `${(v * 100).toFixed(1)}pp`} onChange={(v) => set("minConviction", v)} />

            <Segment label="Phase" value={levers.phase} options={[["pre", "Pre"], ["inplay", "In-play"], ["both", "Both"]]} onChange={(v) => set("phase", v as AgentLevers["phase"])} />

            <Pair label="Minute window" lo={levers.minMinute} hi={levers.maxMinute} min={0} max={90} step={1} onLo={(v) => set("minMinute", v)} onHi={(v) => set("maxMinute", v)} />
            <Pair label="Odds band" lo={levers.oddsMin} hi={levers.oddsMax} min={1.1} max={10} step={0.1} onLo={(v) => set("oddsMin", v)} onHi={(v) => set("oddsMax", v)} />

            <Range label="Max concurrent" value={levers.maxConcurrent} min={1} max={10} step={1} fmt={(v) => `${v}`} onChange={(v) => set("maxConcurrent", v)} />

            <Segment label="Direction" value={levers.direction} options={[["follow", "Follow"], ["fade", "Fade"]]} onChange={(v) => set("direction", v as AgentLevers["direction"])} />
          </div>
        </section>

        {/* papers to attach */}
        <aside className="panel p-5 lg:col-span-1">
          <p className="label mb-1">research papers</p>
          <p className="mb-3 text-xs text-faint">Each adds its calibrated edge on top of the base. Attach any you own.</p>
          <div className="space-y-2">
            {PAPERS.map((p) => {
              const on = papers.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => togglePaper(p.id)}
                  className={`w-full rounded border p-3 text-left transition-colors ${
                    on ? "border-amber-dim bg-amber/10" : "border-ink-600 hover:border-ink-500"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="serif text-sm leading-snug text-paper">{p.title}</span>
                    <span className={`shrink-0 text-sm ${on ? "amber" : "text-faint"}`}>{on ? "✓" : "+"}</span>
                  </div>
                  <span className="label mt-1 block text-faint">{p.edgeKind}</span>
                </button>
              );
            })}
          </div>
          <Link href="/papers" className="mt-3 block text-xs amber hover:text-fg">
            Read the research library →
          </Link>
        </aside>
      </div>

      {/* live preview + deploy */}
      <div className="panel mt-5 p-5">
        <p className="label mb-2">preview</p>
        <p className="prompt serif text-lg leading-snug text-paper">{preview}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your forecaster…"
            className="card flex-1 min-w-[200px] px-4 py-2.5 text-fg placeholder:text-faint"
          />
          <button
            onClick={deploy}
            disabled={deploying}
            className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-50"
          >
            {deploying ? "Deploying…" : "Deploy forecaster →"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm loss">{error}</p>}
        <p className="mt-2 text-xs text-faint">
          Deploys to the runner and starts forecasting immediately. Watch it on the{" "}
          <Link href="/desk" className="amber hover:text-fg">
            Signal Desk
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-sm tabular-nums amber">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-amber" />
    </div>
  );
}

function Pair({ label, lo, hi, min, max, step, onLo, onHi }: { label: string; lo: number; hi: number; min: number; max: number; step: number; onLo: (v: number) => void; onHi: (v: number) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <input type="number" min={min} max={max} step={step} value={lo} onChange={(e) => onLo(Number(e.target.value))} className="card w-full px-2 py-1.5 text-sm tabular-nums text-fg" />
        <span className="text-faint">—</span>
        <input type="number" min={min} max={max} step={step} value={hi} onChange={(e) => onHi(Number(e.target.value))} className="card w-full px-2 py-1.5 text-sm tabular-nums text-fg" />
      </div>
    </div>
  );
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-2 flex gap-1.5">
        {options.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded border px-2 py-1.5 text-sm transition-colors ${
              value === v ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}
