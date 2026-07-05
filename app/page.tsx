import Link from "next/link";
import Nav from "@/components/Nav";
import HeroTerminal from "@/components/HeroTerminal";
import { getProof } from "@/lib/proof";

const STEPS = [
  { n: "01", t: "Benchmark", d: "Every prediction market fill is measured against TxLINE's vig-free consensus: the one no-margin fair line, tick for tick, in real time." },
  { n: "02", t: "Catch the divergence", d: "When the book lags the fair past the threshold, the cheap side is underpriced. We flag it: which side, how many points off, and how much size sat at the stale price." },
  { n: "03", t: "The delay closes", d: "It's a measurable lag, not noise: 73% of the time the book travels back to TxLINE's price, and the underpriced side is a positive-edge buy at resolution." },
  { n: "04", t: "Proven on-chain", d: "Every entry carries a Polygon tx hash; every outcome settles against TxLINE's on-chain scores. Don't trust the ledger, verify it." },
];

// Measured on a single live match — Paraguay v France, in-play (see /proof for the full ledger).
const EVIDENCE = [
  { k: "$8.6M", d: "of real prediction-market book we measured against TxLINE fair, in-play." },
  { k: "1.25pp", d: "median gap. The two books sit lockstep at the spread for 89 minutes of 90." },
  { k: "$1.03M", d: "traded ≥10pp off fair, almost all of it in the minutes around one goal." },
  { k: "on-chain", d: "every fill a Polygon tx hash, every outcome a TxLINE validate_stat proof." },
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
            <p className="label">built on TxLINE</p>
            <h1 className="serif mt-4 text-5xl leading-[1.05] sm:text-6xl">
              Prediction Markets trade a step
              <br />
              behind the true price.
            </h1>
            <p className="mt-5 max-w-md text-muted">
              TxLINE strips the vig, so its odds are the true price. When a prediction market lags it, the cheap
              side is underpriced, and it snaps back 73% of the time. We measure the gap, live and on-chain.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="#evidence"
                className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20"
              >
                See the evidence →
              </Link>
              <Link
                href="/edge"
                className="rounded border border-ink-600 px-5 py-2.5 font-semibold text-muted hover:text-fg"
              >
                Replay the edge
              </Link>
            </div>
          </div>
          <HeroTerminal />
        </div>
      </section>

      {/* EVIDENCE — measured, not claimed */}
      <section id="evidence" className="scroll-mt-20 border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="label">this is what the frontier looks like without the reference</p>
          <h2 className="serif mt-2 max-w-3xl text-3xl text-paper">
            One live sports market. $8.6M of real book. $1.03M lifted off fair.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            We ran a prediction market&apos;s real fills against TxLINE&apos;s vig-free fair for all 90 minutes of
            Paraguay v France. The two prices tracked inside <span className="text-fg">1 to 2 points</span>,
            the market&apos;s spread, the whole match. Then France scored, and for the minutes around the goal
            they split <span className="text-fg">10 to 37 points</span> while the stale side got taken. That
            split is what the book pays out with no fair to settle against, and what TxLINE closes. Not a
            claim: a measurement, every fill on-chain.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {EVIDENCE.map((e) => (
              <div key={e.k} className="card p-5">
                <p className="serif text-3xl text-amber">{e.k}</p>
                <p className="mt-2 text-sm text-muted">{e.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-faint">
            Paraguay v France, in-play. prediction market order-book fills read on-chain from Polygon, aligned
            to TxLINE&apos;s vig-free 1X2. Full per-match ledger on <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link>.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-ink-600">
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
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">the pain</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            Volume is vanity. Getting picked off is what drains the pool.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            A prediction market doesn&apos;t bleed from low volume, it bleeds from paying out to the
            sharps who lift a stale quote the moment the consensus moves. The book lags the sharp,
            vig-free line: in the seconds around a goal the prediction market price sits behind TxLINE&apos;s
            fair, and the underpriced side gets taken before it catches up. That lag is a{" "}
            <span className="text-fg">measurable delay</span>: the book travels back to TxLINE&apos;s
            price 73% of the time, and buying the cheap side and holding to resolution is a
            positive-edge trade. Linescout turns that leakage into a number you can see, and prove.
          </p>
        </div>
      </section>

      {/* INDEPENDENT REFEREE */}
      <section className="border-t border-ink-600">
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
                We place no bet, move no price, hold no funds. Your rule-set acts, so it clears
                compliance and carries no wagering surface.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">Provable</h3>
              <p className="mt-2 text-sm text-muted">
                Every call is settled on-chain. Audit the track record before you trust it: the one
                thing a black-box pricing vendor can&apos;t show you.
              </p>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm text-faint">
            A production signal is a millisecond game: a warning only pays if it beats the pickoff.
            That needs direct, co-located TxLINE feed access, so a live deployment is a continuing
            partnership with TxOdds, not a one-off.
          </p>
        </div>
      </section>

      {/* BUILT ON TXLINE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">why txline is the unlock</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            The missing price layer for the sports frontier.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            TxLINE publishes a <span className="text-fg">de-vig odds stream</span>: the bookmaker margin
            stripped out, so every price is a clean, real-time fair probability. That is the exact piece a
            sports prediction market has always lacked, and it is TxLINE&apos;s untapped edge in this market.
            That one-of-a-kind
            reference is the whole foundation, and it&apos;s what let us score a real prediction
            market&apos;s book to the point: remove the vig and a price gap stops being noise and becomes
            a measurable distance from the true price, the exact distance a sharp gets paid to close.
            No ordinary odds feed gives you that.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="card p-5">
              <h3 className="text-paper">The reference the market can be graded against</h3>
              <p className="mt-2 text-sm text-muted">
                We difference a live order book against TxLINE&apos;s vig-free fair, tick for tick. The
                books agree at the spread until information hits, then the gap opens, and that gap, timed
                to the goal, is the pickoff surface. No feed but the de-vig stream makes it visible.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">An upgrade for anyone on TxLINE</h3>
              <p className="mt-2 text-sm text-muted">
                Any prediction market or bookmaker already plugged into TxLINE can bolt on Linescout and
                instantly harden its line integrity, no new pricing model, no giving up the book.
                Linescout makes the TxLINE feed worth more to the operators who buy it: adopt TxLINE, get
                a provable stale-line shield on top.
              </p>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm text-faint">
            Because it runs on nothing but TxLINE, a live product needs TxLINE&apos;s continued support:
            direct, low-latency feed access so the warning beats the pickoff by milliseconds, and more of
            the de-vig book <span className="text-muted">beyond goals</span>, cards, corners, match odds,
            so we can watch every line an operator quotes. A win here is the start of that partnership,
            not the end of it.
          </p>
        </div>
      </section>

      {/* PROVENANCE */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">provenance</p>
          <h2 className="serif mt-2 text-2xl text-paper">Both sides of the measurement are anchored on-chain.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The fair line is TxLINE&apos;s World Cup data layer: odds and scores cryptographically anchored
            on Solana. The book is a prediction market&apos;s fills, read straight from Polygon. Nothing in the
            ledger is asserted, both legs are public and verifiable.
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
          <span className="prompt">linescout</span>
          <span>Built on TxLINE · AGPL-3.0</span>
        </div>
      </footer>
    </main>
  );
}
