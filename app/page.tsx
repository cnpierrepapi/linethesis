import Link from "next/link";
import Nav from "@/components/Nav";
import HeroTerminal from "@/components/HeroTerminal";
import { getProof } from "@/lib/proof";
import { PAPERS } from "@/lib/papers";

const STEPS = [
  { n: "01", t: "Pick a paper", d: "Each strategy is a published market-inefficiency result, wired to a real engine edge. Every one is free to attach." },
  { n: "02", t: "Tune & deploy", d: "Set conviction, phase, odds band and direction. Deploy a forecaster in one click." },
  { n: "03", t: "It calls solo", d: "The forecaster ingests the live feed and flags mispriced markets autonomously — no human in the loop." },
  { n: "04", t: "Graded on CLV", d: "Calls are scored on closing-line value — did the market move toward the call. The on-chain record can't be cherry-picked." },
];

export default function Home() {
  const proof = getProof();

  return (
    <main className="min-h-screen">
      <Nav />

      {/* HERO */}
      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="label">research desk · autonomous forecasters</p>
            <h1 className="serif mt-4 text-5xl leading-[1.05] sm:text-6xl">
              Spot the mispricing.
              <br />
              Beat the close.
            </h1>
            <p className="mt-5 max-w-md text-muted">
              Autonomous forecasters, each running a published edge. They flag mispriced
              markets and are graded on closing-line value — no human in the loop.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/desk"
                className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20"
              >
                Open the Signal Desk →
              </Link>
              <Link
                href="/papers"
                className="rounded border border-ink-600 px-5 py-2.5 font-semibold text-muted hover:text-fg"
              >
                Browse research
              </Link>
            </div>
          </div>
          <HeroTerminal />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="label">how it works</p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-5">
                <p className="amber font-mono text-sm">{s.n}</p>
                <h3 className="serif mt-2 text-lg text-paper">{s.t}</h3>
                <p className="mt-2 text-sm text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE EDGES */}
      <section className="border-t border-ink-600">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-12">
          <div className="max-w-xl">
            <p className="label">the edges</p>
            <h2 className="serif mt-2 text-2xl text-paper">Steam and overreaction, from the literature.</h2>
            <p className="mt-2 text-sm text-muted">
              Follow the sharp money when the no-vig line moves; fade the overshoot after a goal or red card.
              {" "}
              {PAPERS.length} papers · all free to run.
            </p>
          </div>
          <Link href="/papers" className="prompt text-sm text-amber hover:text-fg">
            See the library
          </Link>
        </div>
      </section>

      {/* PROVENANCE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">provenance</p>
          <h2 className="serif mt-2 text-2xl text-paper">Every signal from an on-chain-anchored feed.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Forecasters read TxLINE&apos;s World Cup data layer — odds and scores cryptographically anchored on Solana.
            Access is minted by a real on-chain transaction, so the data&apos;s provenance is publicly verifiable.
          </p>
          {proof.signedOnSolana ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="amber">✓ access signed on Solana</span>
              <span className="text-ink-500">·</span>
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-muted underline decoration-ink-500 underline-offset-2 hover:text-fg"
              >
                tx {proof.signupTx?.slice(0, 6)}…{proof.signupTx?.slice(-4)} ({proof.cluster})
              </a>
            </p>
          ) : (
            <p className="mt-4 text-sm text-faint">TxLINE Solana-anchored World Cup feed.</p>
          )}
        </div>
      </section>

      <footer className="border-t border-ink-600">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-xs text-faint">
          <span className="prompt">agenthesis</span>
          <span>Built on TxLINE · AGPL-3.0</span>
        </div>
      </footer>
    </main>
  );
}
