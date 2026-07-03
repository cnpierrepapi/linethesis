"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// THE ARCHIVE — proven, not asserted. Every recorded match's signals, each anchored to
// THREE real TxLINE demargined quotes (baseline → entry → objective) that show the line
// doing what the model said: an overreaction reverting toward the pre-goal price, or a
// steam move reaching and holding the shifted price. Verdict is settled on the same +180s
// horizon /proof calibrates on. We keep mostly winners with a small, DISCLOSED minority of
// losers so the reel is believable, not suspiciously perfect. Data: /api/v1/archive.

interface Frame {
  ts: number;
  tsISO: string;
  prob: number;
  pct: number;
  odds: number;
}
interface ProofCase {
  fixtureId: string;
  kind: string;
  action: string;
  direction: string;
  confidence: number;
  magnitude: number;
  market: string;
  line: number | null;
  side: string;
  minute: number | null;
  baseline: Frame | null;
  entry: Frame;
  objective: Frame;
  drifted: number | null;
  movedBack: number | null;
  reversionRatio: number | null; // overreaction: fraction of drift recovered (sustained)
  reverted: boolean | null; // overreaction: did the overshoot genuinely revert?
  clvReturn: number;
  clvPositive: boolean;
  success: boolean;
  proofHash: string;
  note: string;
}
interface Totals {
  cases: number;
  reversions: number;
  overreactions: number;
  wins: number;
  losses: number;
  shown: number;
  shownWins: number;
  discarded: number;
}
interface ReelMatch {
  fixtureId: string;
  label: string;
  cases: ProofCase[];
  caseCount: number;
  totals: Totals | null;
  hitRate: number | null;
}

const KIND_COLOR: Record<string, string> = { overreaction: "loss", steam: "amber", pregoal_warning: "text-muted" };
function actionColor(a: string): string {
  return a === "fade" ? "loss" : a === "follow" ? "amber" : "text-muted";
}
function shortMarket(m: string): string {
  return m.replace("OVERUNDER_PARTICIPANT_GOALS", "O/U").replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH").replace("line=", "");
}
function hhmmss(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function gapSec(a: number, b: number): string {
  return `${Math.round(Math.abs(b - a) / 1000)}s`;
}
const pp = (x: number | null) => (x == null ? "" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`);

// the plain-English claim each case makes about the line, told honestly
function narrative(c: ProofCase): string {
  const base = c.baseline ? `${c.baseline.pct}%` : "the pre-move line";
  const entry = `${c.entry.pct}%`;
  const obj = `${c.objective.pct}%`;
  const rr = c.reversionRatio != null ? Math.round(c.reversionRatio * 100) : null;
  if (c.kind === "overreaction") {
    if (c.reverted)
      return `A surprising goal spiked the line ${base}→${entry}. We flagged overreaction → ${c.action}. It reverted ${rr}% of the way back (to ${obj}) and held — the overshoot a chasing book gets picked off on.`;
    return `A goal moved the line ${base}→${entry} and it STUCK (${obj}, only ${rr}% back). We flagged overreaction, but it didn't revert — this was an efficient reprice, not a mispricing. Shown as a disclosed miss: genuine reversions are the minority, the reprice-that-holds is the common case.`;
  }
  if (c.success)
    return `A clean move took the line ${base}→${entry}; it held/continued to ${obj}. Following was right — a book still quoting ${base} gets left behind.`;
  return `Move to ${entry} from ${base} that drifted back to ${obj} — following would have been early here.`;
}

export default function Desk() {
  const [matches, setMatches] = useState<ReelMatch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/archive", { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const ms: ReelMatch[] = j.matches ?? [];
        setMatches(ms);
        if (ms.length && !selected) setSelected(ms[0].fixtureId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const match = matches.find((m) => m.fixtureId === selected) ?? null;
  const t = match?.totals ?? null;
  const overallRev = matches.reduce((s, m) => s + (m.totals?.reversions ?? 0), 0);
  const overallOver = matches.reduce((s, m) => s + (m.totals?.overreactions ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">the archive — proven against real TxLINE frames</p>
          <h1 className="serif mt-1 text-2xl">Don&apos;t trust the call. Check the frames.</h1>
          <p className="mt-1 text-sm text-muted">
            Three real demargined quotes per case — pre-event, the drift, and where the line went — so you see the
            overshoot revert (or stick) yourself. A genuine reversion means the line came back and <em>held</em>, not
            a one-tick wiggle. Watching a match live?{" "}
            <Link href="/live" className="amber hover:text-fg">
              Open the live sandbox →
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="genuine reversions" value={`${overallRev}`} tone="gain" />
          <Stat label="of flagged" value={`${overallOver}`} />
          <Stat label="matches" value={`${matches.length}`} />
        </div>
      </header>

      {/* MATCH SELECTOR */}
      <div className="mb-4 flex flex-wrap gap-2">
        {matches.length === 0 && <span className="text-sm text-faint">loading proof reel…</span>}
        {matches.map((m) => (
          <button
            key={m.fixtureId}
            onClick={() => setSelected(m.fixtureId)}
            className={`rounded border px-3 py-1.5 text-sm transition-colors ${
              selected === m.fixtureId ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"
            }`}
          >
            {m.label} <span className="text-faint tabular-nums">· {m.caseCount}</span>
          </button>
        ))}
      </div>

      {/* DISCLOSURE — the honest rate, transparent selection */}
      {t && (
        <p className="mb-5 rounded border border-ink-600 bg-ink-800/50 px-4 py-2 text-xs text-faint">
          Of <span className="text-fg">{t.overreactions}</span> overreactions flagged this match,{" "}
          <span className="gain">{t.reversions} genuinely reverted</span> (held ≥30% of the drift back) — the rest were
          efficient reprices that stuck. Showing all reversions + a capped few misses ({t.shown} of {t.cases} cases,{" "}
          {t.discarded} trimmed). Genuine reversions are the minority; that&apos;s the honest signal. Full set:{" "}
          <code className="text-muted">/api/v1/archive?raw=1</code>.
        </p>
      )}

      {/* PROOF CARDS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {match?.cases.length === 0 && <p className="text-sm text-faint">No proof cases for this match.</p>}
        {match?.cases.map((c, i) => (
          <ProofCard key={`${c.proofHash}-${i}`} c={c} />
        ))}
      </div>
    </div>
  );
}

function ProofCard({ c }: { c: ProofCase }) {
  const driftGap = c.baseline ? gapSec(c.baseline.ts, c.entry.ts) : null;
  const settle = gapSec(c.entry.ts, c.objective.ts);
  const rr = c.reversionRatio != null ? Math.round(c.reversionRatio * 100) : null;
  const isOver = c.kind === "overreaction";
  // badge states the model's claim: did the overshoot REVERT? (not just any CLV wiggle)
  const badge = isOver ? (c.reverted ? "✓ reverted" : "✗ reprice held") : c.success ? "✓ held" : "✗ faded";
  const revNote = isOver ? (c.reverted ? `revert ${rr}%` : `stuck ${rr}%`) : c.success ? "held" : "faded";
  const objLabel = isOver ? (c.reverted ? `reversion · +${settle}` : `held · +${settle}`) : `close · +${settle}`;
  return (
    <div className={`card p-4 ${c.success ? "" : "opacity-90"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm">
            <span className="text-muted">{shortMarket(c.market)}</span> <span className="text-faint">· {c.side}</span>
            {c.minute != null && <span className="text-faint"> · {c.minute}&apos;</span>}
          </p>
          <p className="mt-0.5 text-xs">
            <span className={KIND_COLOR[c.kind] ?? "text-muted"}>{c.kind}</span>{" "}
            <span className="text-faint">→</span> <span className={actionColor(c.action)}>{c.action}</span>{" "}
            <span className="text-faint">· conf {c.confidence.toFixed(2)}</span>
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs ${c.success ? "bg-gain/10 gain" : "bg-loss/10 loss"}`}>{badge}</span>
      </div>

      {/* three real frames: baseline → entry → objective */}
      <div className="mt-3 flex items-stretch gap-1.5 text-center font-mono text-xs">
        <FrameCell label="pre-event" f={c.baseline} tone="text-muted" />
        <Arrow note={c.drifted != null ? pp(c.drifted) : "drift"} tone="amber" />
        <FrameCell label="entry · the drift" f={c.entry} tone="amber" />
        <Arrow note={revNote} tone={c.success ? "gain" : "loss"} />
        <FrameCell label={objLabel} f={c.objective} tone={c.success ? "gain" : "loss"} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{narrative(c)}</p>

      <div className="mt-2 flex items-center justify-between text-[0.66rem] text-faint">
        <span title="fingerprint of the real TxLINE entry frame">⛓ {c.proofHash}</span>
        <span className="tabular-nums">
          {isOver && rr != null && (
            <>
              <span className={c.reverted ? "gain" : "loss"}>{rr}% reverted</span>
              <span className="text-faint"> · </span>
            </>
          )}
          CLV <span className={c.clvReturn >= 0 ? "gain" : "loss"}>{c.clvReturn >= 0 ? "+" : ""}{(c.clvReturn * 100).toFixed(1)}%</span>
          {driftGap && <span className="text-faint"> · goal→drift {driftGap}</span>}
        </span>
      </div>
    </div>
  );
}

function FrameCell({ label, f, tone }: { label: string; f: Frame | null; tone: string }) {
  return (
    <div className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-800/60 px-1.5 py-2">
      <p className="label truncate normal-case tracking-normal">{label}</p>
      {f ? (
        <>
          <p className={`mt-1 text-sm tabular-nums ${tone}`}>{f.pct}%</p>
          <p className="text-[0.66rem] text-faint tabular-nums">@ {f.odds}</p>
          <p className="text-[0.6rem] text-faint tabular-nums">{hhmmss(f.ts)}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-faint">—</p>
      )}
    </div>
  );
}

function Arrow({ note, tone }: { note: string; tone: string }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center">
      <span className="text-faint">→</span>
      <span className={`text-[0.6rem] leading-tight ${tone}`}>{note}</span>
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
