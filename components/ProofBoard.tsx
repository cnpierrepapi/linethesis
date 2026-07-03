"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// PROOF: the provable track record (C). The read-only agent grades ITSELF: every signal
// settled against its market's fair line at the reversion horizon (CLV leg) and, live,
// against the on-chain goals via validateStat (outcome leg). We report the honest numbers:
// overall + per kind + per action + per-fixture breadth and single-match concentration,
// so a "pilot, not proof" pattern can't hide behind a headline. Plus the reconcile-against-
// your-DB CSV and the Solana proof-of-access.

interface Bucket {
  n: number;
  right: number;
  hitRate: number | null;
  avgClv: number | null;
  pending: number;
  outcome: { n: number; right: number; hitRate: number | null } | null;
}
interface FixtureRow {
  fixtureId: string;
  n: number;
  hitRate: number | null;
  avgClv: number | null;
  netPositive: boolean;
}
interface Ledger {
  overall: Bucket;
  byKind: Record<string, Bucket>;
  byAction: Record<string, Bucket>;
  byLiquidity: Record<string, Bucket>; // edge #2: hit-rate by book regime (thick vs thin)
  breadth: { matches: number; matchesNetPositive: number; topMatchShareOfNetPct: number | null; fixtures: FixtureRow[] };
  headline: string;
  imminent?: {
    n: number;
    arrived: number;
    arrivalRate: number | null;
    baseRate: number | null;
    lift: number | null;
    windowMs: number;
  };
}
interface SettledRow {
  fixtureId: string;
  match: string;
  kind: string;
  action: string;
  side: string;
  line: number | null;
  pRef: number;
  clvReturn: number | null;
  clvRight: boolean | null;
  status: string;
  liquidity: "thin" | "thick" | null; // edge #2 book regime (neutral fact)
  lateMatch: boolean;
  proofHash: string;
}
interface Proof {
  signedOnSolana: boolean;
  cluster: string;
  signupTx: string | null;
  apiBase: string | null;
  explorerUrl: string | null;
}

function pct(x: number | null): string {
  return x == null ? "-" : `${(x * 100).toFixed(0)}%`;
}
function clv(x: number | null): string {
  return x == null ? "-" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

export default function ProofBoard({ proof }: { proof: Proof }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [rows, setRows] = useState<SettledRow[]>([]);
  const [caveat, setCaveat] = useState<string>("");

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/calibration?detail=1", { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setLedger(j.ledger);
        setRows(j.settled ?? []);
        setCaveat(j.caveat ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const over = ledger?.byKind.overreaction;
  const steam = ledger?.byKind.steam;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6">
        <p className="label">proof</p>
        <h1 className="serif mt-1 text-3xl">The agent grades itself, on-chain.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every signal is settled against the market&apos;s fair line at the reversion horizon (the
          skill metric), and, live, against the final goals on the TxLINE daily-scores Merkle root.
          Don&apos;t trust the track record. Verify it.
        </p>
      </header>

      {/* HEADLINE CALIBRATION */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="steam / follow" value={pct(steam?.hitRate ?? null)} sub={steam ? `${steam.right}/${steam.n} held · FCV in ±10pp` : ""} tone="gain" />
        <Stat label="overreaction" value={pct(over?.hitRate ?? null)} sub={over ? `${over.right}/${over.n} correct (hold held / fade reverted)` : ""} />
        <Stat label="matches" value={`${ledger?.breadth.matches ?? 0}`} sub={ledger ? `${ledger.breadth.matchesNetPositive} net-positive` : ""} />
        <Stat label="concentration" value={ledger?.breadth.topMatchShareOfNetPct != null ? `${ledger.breadth.topMatchShareOfNetPct}%` : "-"} sub="top match share of net" tone="loss" />
      </div>

      {caveat && (
        <p className="mt-4 rounded border border-ink-600 bg-ink-850 px-4 py-2.5 text-sm text-muted">
          <span className="amber">Honest status:</span> {caveat}
        </p>
      )}

      {/* BY SIGNAL TYPE + BY ACTION */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <p className="label mb-3">by signal type</p>
          <BreakTable
            rows={[
              ["overreaction", ledger?.byKind.overreaction],
              ["steam", ledger?.byKind.steam],
            ]}
          />
        </section>
        <section className="panel p-5">
          <p className="label mb-3">by recommended action</p>
          <BreakTable
            rows={[
              ["fade", ledger?.byAction.fade],
              ["hold", ledger?.byAction.hold],
              ["follow", ledger?.byAction.follow],
            ]}
          />
        </section>
      </div>
      <p className="mt-2 text-xs text-faint">
        <span className="text-muted">correct</span> = the per-action verdict, not CLV sign:{" "}
        <span className="amber">follow / hold</span> is right if the Fair Close Value held inside ±10pp of entry (the
        line stayed where it moved); <span className="loss">fade</span> is right if the overshoot genuinely reverted.
        A follow is taken at fair value, so its expected CLV is ~0; <span className="text-muted">avg clv</span> is
        shown only as an auxiliary, never the pass/fail test.
      </p>

      {/* BY BOOK LIQUIDITY (edge #2) — does the gate actually separate the calls? */}
      {ledger?.byLiquidity && (ledger.byLiquidity.thick?.n > 0 || ledger.byLiquidity.thin?.n > 0) && (
        <section className="panel mt-5 p-5">
          <p className="label mb-1">steam follows by book liquidity — pickoff exposure (edge #2)</p>
          <p className="mb-3 max-w-3xl text-xs text-faint">
            Liquidity is a <em>pickoff-exposure</em> gate, not a revert prediction: a steam move is a large crosser and
            <span className="text-fg"> carries regardless of how thin the book is</span> — the reversion base-rate (edge #2
            β&lt;0) lives on small non-steam wobble, measured in the edge lab, not in these follow outcomes. Its use here is
            that a <span className="loss">thin</span> book lagging a real move is picked off harder. Both regimes should hold
            (carry); the split just confirms thin isn&apos;t worse on the <em>call</em>. ⚠️ current captures are pre-match
            monotonic drifts, so hit-rates read high until more in-play matches land.
          </p>
          <BreakTable
            rows={[
              ["thick book", ledger.byLiquidity.thick],
              ["thin book", ledger.byLiquidity.thin],
            ]}
          />
        </section>
      )}

      {/* GOAL-IMMINENT ANTICIPATION: arrival-settled, not CLV */}
      {ledger?.imminent && ledger.imminent.n > 0 && (
        <section className="panel mt-5 p-5">
          <p className="label mb-1">goal-imminent anticipation: settled on goal-ARRIVAL (not CLV)</p>
          <p className="mb-3 text-xs text-faint">
            A high-danger warning has no closing line to grade; its value is that a goal actually lands
            disproportionately often. We grade every warning on whether a real goal arrived within{" "}
            {Math.round((ledger.imminent.windowMs || 120000) / 1000)}s. The line itself does NOT pre-drift
            tradeably (drift test), so the action is suspend/widen, never over-lean.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="goal within 120s"
              value={pct(ledger.imminent.arrivalRate)}
              sub={`${ledger.imminent.arrived}/${ledger.imminent.n} warnings`}
              tone="gain"
            />
            <Stat label="base rate" value={pct(ledger.imminent.baseRate)} sub="uniform-arrival null" />
            <Stat
              label="lift"
              value={ledger.imminent.lift != null ? `${ledger.imminent.lift.toFixed(2)}×` : "-"}
              sub="vs base (Bundesliga 1.92×)"
              tone="gain"
            />
            <Stat label="action" value="suspend" sub="no over-lean, line doesn't pre-drift" />
          </div>
        </section>
      )}

      {/* BREADTH / CONCENTRATION */}
      <section className="panel mt-5 p-5">
        <p className="label mb-1">breadth: per match (guards against the one-match illusion)</p>
        <p className="mb-3 text-xs text-faint">
          A headline means nothing if one match carries it. Every settled match, its hit-rate and average CLV.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-xs text-faint">
                <Th>fixture</Th>
                <Th right>signals</Th>
                <Th right>hit-rate</Th>
                <Th right>avg clv</Th>
                <Th right>net</Th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {(ledger?.breadth.fixtures ?? []).map((f) => (
                <tr key={f.fixtureId} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 text-muted">#{f.fixtureId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.n}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(f.hitRate)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${(f.avgClv ?? 0) >= 0 ? "gain" : "loss"}`}>{clv(f.avgClv)}</td>
                  <td className={`px-3 py-2 text-right ${f.netPositive ? "gain" : "loss"}`}>{f.netPositive ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SETTLED SIGNAL LEDGER */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="label">the settled signal ledger: every call, graded</p>
            <p className="mt-0.5 text-xs text-faint">
              Each signal fingerprinted to the real TxLINE frame it was derived from, settled on closing-line value.
            </p>
          </div>
          <p className="shrink-0 text-xs text-faint">{rows.length} signals</p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-xs text-faint">
                <Th>match</Th>
                <Th>signal</Th>
                <Th>market</Th>
                <Th right>ref</Th>
                <Th>frame</Th>
                <Th right>clv</Th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-faint">
                    settling signals…
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.proofHash}-${i}`} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 text-fg">{r.match}</td>
                  <td className="px-3 py-2">
                    <span className={r.kind === "overreaction" ? "loss" : "amber"}>{r.kind}</span>{" "}
                    <span className="text-faint">→ {r.action}</span>
                    {r.liquidity && (
                      <span className="text-faint" title={`fired in a ${r.liquidity} book — a neutral pickoff-exposure fact (not a revert prediction)`}>
                        {" "}· {r.liquidity}
                      </span>
                    )}
                    {r.lateMatch && <span className="text-faint"> · late</span>}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {r.side} {r.line}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{r.pRef?.toFixed(3)}</td>
                  <td className="px-3 py-2">
                    <span className="amber" title="fingerprint of the real TxLINE frame">
                      ⛓ {r.proofHash}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${(r.clvReturn ?? 0) >= 0 ? "gain" : "loss"}`}>
                    {r.status === "settled" ? clv(r.clvReturn) : <span className="text-faint">pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* RECONCILE AGAINST YOUR DB */}
      <section className="panel mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="label mb-1">reconcile against your database</p>
          <p className="text-sm text-muted">
            Download every real TxLINE frame we ingested: original timestamp, market, and demargined prices.
            Join on <code className="rounded border border-ink-600 bg-ink-800 px-1 text-xs text-fg">fixture_id</code> +{" "}
            <code className="rounded border border-ink-600 bg-ink-800 px-1 text-xs text-fg">frame_ts_ms</code> to confirm
            our reference matches yours.
          </p>
        </div>
        <a
          href="/api/verify-csv"
          className="shrink-0 rounded border border-amber-dim bg-amber/10 px-4 py-2 text-center text-sm text-amber hover:bg-amber/20"
        >
          ↓ Download verification CSV
        </a>
      </section>

      {/* SOLANA PROOF OF ACCESS */}
      <section className="panel mt-6 p-5">
        <p className="label mb-3">on-chain proof of access (Solana)</p>
        {proof?.signedOnSolana ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted">
              Access to the TxLINE reference feed was minted by a real <span className="text-fg">SUBSCRIBE</span>{" "}
              transaction signed with a Solana wallet. The signature is a public, verifiable hash.
            </p>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="label">cluster</span>
              <span className="amber">{proof.cluster}</span>
              <span className="text-ink-500">·</span>
              <span className="label">api</span>
              <span className="text-muted">{proof.apiBase}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">signup tx</span>
              <code className="break-all rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-fg">
                {proof.signupTx}
              </code>
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-amber-dim bg-amber/10 px-3 py-1 text-xs text-amber hover:bg-amber/20"
              >
                verify on Solana Explorer ↗
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-faint">no on-chain proof configured.</p>
        )}
      </section>

      <p className="mt-6 text-xs text-faint">
        Watch signals fire against the live book in the{" "}
        <Link href="/desk" className="amber hover:text-fg">
          Control Room
        </Link>
        .
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-xl tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}
function BreakTable({ rows }: { rows: [string, Bucket | undefined][] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-ink-600 text-xs text-faint">
          <Th>-</Th>
          <Th right>n</Th>
          <Th right>correct</Th>
          <Th right>avg clv</Th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {rows.map(([name, b]) => (
          <tr key={name} className="border-b border-ink-700 last:border-0">
            <td className="px-3 py-2 text-fg">{name}</td>
            <td className="px-3 py-2 text-right tabular-nums">{b?.n ?? 0}</td>
            <td className="px-3 py-2 text-right tabular-nums">{pct(b?.hitRate ?? null)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${(b?.avgClv ?? 0) >= 0 ? "gain" : "loss"}`}>{clv(b?.avgClv ?? null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
