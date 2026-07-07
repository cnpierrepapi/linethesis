import Link from "next/link";
import Nav from "@/components/Nav";
import HeroTerminal, { type Div } from "@/components/HeroTerminal";
import { getProof } from "@/lib/proof";
import { getSiteStats } from "@/lib/site-stats";
import { getPickoffs } from "@/lib/pickoff-source";

export const dynamic = "force-dynamic";

const EVIDENCE = [
  { k: "$8.6M", d: "traded in-play on this one match, all of it measured against the sharp fair." },
  { k: "1.25pp", d: "median gap. The market tracks fair to the spread until news hits, then it lags." },
  { k: "$1.03M", d: "changed hands 10+ points below fair, the cheap side left on the table around one goal." },
  { k: "on-chain", d: "every fill a Polygon tx, every outcome a TxLINE on-chain settlement. Verify it." },
];

export default async function Home() {
  const proof = getProof();
  const stats = await getSiteStats();

  // Hero tape rows, computed on the server from the CACHED pickoff ledger (getPickoffs is memoised
  // + fetch-cached), then handed to HeroTerminal as props. The hero must never fetch the ~600KB blob
  // from the client: that pulled the full file off Supabase on every visit and blew the egress budget.
  const led = await getPickoffs();
  const heroItems: Div[] = [];
  for (const m of led?.matches ?? [])
    for (const e of m.divergences?.["5"] ?? [])
      heroItems.push({ teams: m.teams, side: e.side, entry: e.entry, fair: e.fair, gap: e.gap, reached: e.reached, usd: e.usd });
  heroItems.sort((a, b) => b.usd - a.usd);
  const heroTape = heroItems.slice(0, 24);
  const STEPS = [
    { n: "01", t: "The sharp line leads", d: "TxLINE strips the vig from a live odds feed, so its price is the true probability. It moves the instant news hits, seconds before a traded market can follow." },
    { n: "02", t: "The market lags", d: "A prediction market only reprices when someone trades, so it sits behind. When it falls past the threshold below fair, the cheap side is underpriced, and we flag it: which side, how far off, how much size is there." },
    { n: "03", t: "You take the cheap side", d: `The gap closes ${stats.reachPct}% of the time as the market catches up. Take the cheap side and take profit when it reaches TxLINE fair, sized by Kelly on the gap. Ride it to the fair, not the final whistle.` },
    { n: "04", t: "Verify every entry", d: "Each entry is a Polygon fill you can open; each outcome settles on TxLINE's on-chain scores. Don't trust the track record, check it." },
  ];

  return (
    <main className="min-h-screen">
      <Nav />

      {/* HERO */}
      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="label">the lead-lag edge in prediction markets · built on TxLINE</p>
            <h1 className="serif mt-4 text-5xl leading-[1.05] sm:text-6xl">
              Prediction markets trade
              <br />
              a step behind fair.
            </h1>
            <p className="mt-5 max-w-md text-muted">
              TxLINE strips the vig, so its odds are the true price. A prediction market lags it, and the
              cheap side is underpriced. Lagisalpha catches the gap the moment it opens, tells you which
              side to take, and shows it snap back {stats.reachPct}% of the time. A repeatable edge you can act on.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/edge"
                className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20"
              >
                See the edge live →
              </Link>
              <Link
                href="/proof"
                className="rounded border border-ink-600 px-5 py-2.5 font-semibold text-muted hover:text-fg"
              >
                The track record
              </Link>
            </div>
          </div>
          <HeroTerminal items={heroTape} />
        </div>
      </section>

      {/* EVIDENCE — money on the table */}
      <section id="evidence" className="scroll-mt-20 border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="label">the edge, on one match</p>
          <h2 className="serif mt-2 max-w-3xl text-3xl text-paper">
            One match. $1.03M traded 10+ points below fair.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            We aligned a prediction market&apos;s real fills to TxLINE&apos;s vig-free fair for all 90 minutes
            of Paraguay v France. The two prices sat within <span className="text-fg">1 to 2 points</span>,
            the spread, the whole match. Then France scored, the sharp line jumped, and for the minutes the
            market took to catch up, over a million dollars traded <span className="text-fg">10 to 37 points</span>{" "}
            below fair. Every one of those fills was a cheap side sitting there to be taken. Not a claim: a
            measurement, every fill on-chain.
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
            Paraguay v France, in-play. Prediction market fills read on-chain from Polygon, aligned to
            TxLINE&apos;s vig-free 1X2. The full track record, across {stats.matchCount} matches, is on{" "}
            <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link>.
          </p>
        </div>
      </section>

      {/* WHY THE EDGE IS REAL */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">why the edge is there</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            A slow market, a fast reference, a gap that repeats.
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="card p-5">
              <h3 className="text-paper">The market is slow</h3>
              <p className="mt-2 text-sm text-muted">
                A prediction market reprices only when someone trades. New information outruns it, so its
                price lags the truth for real, tradeable seconds.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">The reference is sharp</h3>
              <p className="mt-2 text-sm text-muted">
                TxLINE&apos;s de-vig line is the consensus fair with the margin stripped out. It already
                holds the true price the market has not reached yet.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">The gap repeats</h3>
              <p className="mt-2 text-sm text-muted">
                Not luck on one match. The divergence opens every time news hits and closes {stats.reachPct}%
                of the time. A pattern you can trade, not a story.
              </p>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-sm text-faint">
            The edge is validated on {stats.matchCount} matches so far, so the return is a pilot, not a
            promise. The reach rate is the firmer read, and both tighten as matches accrue. See the numbers,
            with the confidence interval, on <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link>.
          </p>
        </div>
      </section>

      {/* THE EDGE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">the edge</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">The lag is the alpha.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            A prediction market can only move its price by trading, so it is always a step behind the sharp,
            vig-free line. In the seconds around a goal the market sits below fair and the cheap side is
            there for the taking. That is not a one-off: across {stats.matchCount} matches the gap closed{" "}
            <span className="text-fg">{stats.reachPct}%</span> of the time, and taking profit at fair, sized
            by Kelly on the gap, returned <span className="text-fg">+{stats.roiPct}%</span> and grew the
            wider the gap. Find the divergence, take the cheap side, and ride it to the fair.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="label">how you trade it</p>
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

      {/* WE DISPROVED THE OBVIOUS SIGNAL, THEN FOUND THE REAL ONE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="label">we were handed a hypothesis. we tested it, then did one better.</p>
          <h2 className="serif mt-2 max-w-3xl text-3xl text-paper">
            The sharp line moving is not the edge. The market being slow to follow it is.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            The obvious idea is a sharp-movement detector: watch TxLINE for significant odds shifts and see
            if they call the result. We built it and it is a coin flip, {" "}
            <span className="text-fg">58%</span>. The edge is not the line moving; it is the market being
            slow to follow. A goal is new information: TxLINE reprices it instantly, but a prediction market
            only moves when someone trades, so for a window the cheap side sits below fair. That is the
            lead-lag, and it converges about <span className="text-amber">{stats.reachPct}%</span> of the
            time. It is our strongest, most proven signal.
          </p>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            And we know which lags to trust. Every payable lag is a post-goal <span className="text-fg">YES</span>{" "}
            lag, so we keep them all and cut only two buy-NO cases: a <span className="text-fg">giant NO</span>{" "}
            (25pp or more), which is not a fresh-information lag but the market pricing something the de-vig
            does not, and rarely comes back; and a <span className="text-fg">late NO</span> (after the 80th
            minute), where there is no time left to converge and one goal or a closed-out favourite ends it.
            It is the mechanism, not a fit.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="card p-5">
              <p className="serif text-3xl text-muted">58%</p>
              <p className="mt-2 text-sm text-muted">their sharp-movement detector at calling the result, a coin flip</p>
            </div>
            <div className="card p-5">
              <p className="serif text-3xl text-amber">{stats.reachPct}%</p>
              <p className="mt-2 text-sm text-muted">of lead-lag divergences converge to fair, the proven edge</p>
            </div>
            <div className="card p-5">
              <p className="serif text-3xl text-amber">~4×</p>
              <p className="mt-2 text-sm text-muted">a high-danger possession makes a goal that likely; the divergence it flags converges 84% vs 75%</p>
            </div>
          </div>
          <p className="mt-5 text-xs text-faint">
            On the pilot sample of {stats.matchCount} settled matches, in-sample. A promising signal, not a
            settled result.
          </p>
        </div>
      </section>

      {/* WHY TXLINE */}
      <section className="border-t border-ink-600">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">why it runs on TxLINE</p>
          <h2 className="serif mt-2 max-w-2xl text-2xl text-paper">
            The only feed that shows the true price early.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            Strip the vig and a price move stops being noise and becomes a measurable distance from the
            true probability. That distance is the whole signal, and only TxLINE&apos;s de-vig stream
            exposes it. Without it, a gap between two prices is just two prices; with it, the gap is exactly
            how far the market is behind, and which way to trade. To catch it live you want the fastest,
            most direct feed, which is TxLINE.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="card p-5">
              <h3 className="text-paper">The leading indicator</h3>
              <p className="mt-2 text-sm text-muted">
                We difference the market&apos;s book against TxLINE&apos;s vig-free fair, tick for tick. The
                two agree at the spread until news hits, then the fair moves first and the gap is your
                entry. No feed but the de-vig stream makes that visible.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-paper">More markets, more entries</h3>
              <p className="mt-2 text-sm text-muted">
                Today the signal runs on the goals and match-result markets that stream de-vigged. The more
                of the book TxLINE streams beyond goals, cards, corners, the more divergences there are to
                trade.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PROVENANCE */}
      <section className="border-t border-ink-600 bg-ink-850">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <p className="label">check it yourself</p>
          <h2 className="serif mt-2 text-2xl text-paper">Both sides of the edge are anchored on-chain.</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The fair line is TxLINE&apos;s World Cup feed: odds and scores anchored on Solana. The market
            side is real fills read straight from Polygon. Nothing in the track record is asserted; both
            legs are public, so you can recompute the edge yourself.
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
          <span className="prompt">lagisalpha</span>
          <span>Built on TxLINE · AGPL-3.0</span>
        </div>
      </footer>
    </main>
  );
}
