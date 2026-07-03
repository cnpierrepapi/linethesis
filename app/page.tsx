import Link from "next/link";
import Nav from "@/components/Nav";
import HeroTerminal from "@/components/HeroTerminal";
import { getProof } from "@/lib/proof";
import { PAPERS } from "@/lib/papers";

const STEPS = [
  { n: "01", t: "Benchmark", d: "Every tick, your posted price is measured against TxLINE's vig-free consensus — the one no-margin fair line." },
  { n: "02", t: "Warn", d: "A clean move to follow, an overreaction to fade, a goal-imminent tape that's about to make your line stale — flagged before the pickoff." },
  { n: "03", t: "Your rule-set acts", d: "You write the policy — widen, cut a limit, suspend. We emit the signal; your book takes the action. We never touch it." },
  { n: "04", t: "Proven on-chain", d: "Every warning is settled against the TxLINE daily-scores Merkle root. Don't trust the track record — verify it on Solana." },
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
            <p className="label">read-only line-integrity oracle · built on TxLINE</p>
            <h1 className="serif mt-4 text-5xl leading-[1.05] sm:text-6xl">
              Your line goes stale.
              <br />
              We see it first.
            </h1>
            <p className="mt-5 max-w-md text-muted">
              Agenthesis benchmarks your prices against TxLINE&apos;s vig-free consensus, warns you the
              instant a line is stale enough to get picked off, and proves every call on-chain. You
              keep the book — we&apos;re the independent referee, not another trading desk.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/live"
                className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20"
              >
                Watch it live →
              </Link>
              <Link
                href="/proof"
                className="rounded border border-ink-600 px-5 py-2.5 font-semibold text-muted hover:text-fg"
              >
                See the on-chain record
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

      {/* THE PAIN */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">the pain</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            The stale line is where the book gets picked off.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Sharp money lives in the seconds around a goal: the consensus moves and a lagging in-play
            price is lifted before it catches up. It&apos;s the same phenomenon prediction-market makers
            call loss-versus-rebalancing — stale prices, picked off by faster, better-informed flow.
            Two literature-backed patterns cover it: <span className="text-fg">follow</span> the clean
            move (the market prices real news efficiently), <span className="text-fg">fade</span> the
            overreaction (a surprising goal overshoots and reverts within minutes).
          </p>
        </div>
      </section>

      {/* INDEPENDENT REFEREE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">why it&apos;s adoptable</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            The neutral referee the incumbents can&apos;t be.
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="card p-5">
              <h3 className="text-paper">Independent</h3>
              <p className="mt-2 text-sm text-muted">
                No managed trading, no shared P&amp;L, no conflict. We benchmark; we don&apos;t compete
                with your book.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">Read-only</h3>
              <p className="mt-2 text-sm text-muted">
                We place no bet, move no price, hold no funds. Your rule-set acts — so it clears
                compliance and carries no wagering surface.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">Provable</h3>
              <p className="mt-2 text-sm text-muted">
                Every call is settled on-chain. Audit the track record before you trust it — the one
                thing a black-box pricing vendor can&apos;t show you.
              </p>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm text-faint">
            A production signal is a millisecond game — a warning only pays if it beats the pickoff.
            That needs direct, co-located TxLINE feed access, so a live deployment is a continuing
            partnership with TxOdds, not a one-off. {PAPERS.length} research papers underpin the calls.
          </p>
        </div>
      </section>

      {/* PROVENANCE */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">provenance</p>
          <h2 className="serif mt-2 text-2xl text-paper">Every reference from an on-chain-anchored feed.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The fair line is TxLINE&apos;s World Cup data layer — odds and scores cryptographically anchored
            on Solana. Access is minted by a real on-chain transaction, so the reference&apos;s provenance is
            publicly verifiable.
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
