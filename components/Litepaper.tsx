import Link from "next/link";
import type { SiteStats } from "@/lib/site-stats";

const SECTIONS = [
  ["01", "The claim"],
  ["02", "Why the edge exists"],
  ["03", "The signal: a divergence"],
  ["04", "The proof: does it close, does it pay"],
  ["05", "The data, verifiable both sides"],
  ["06", "How to trade it"],
  ["07", "What we do not claim"],
  ["08", "What we found"],
  ["09", "Roadmap: 75 leagues, forecasting done honestly"],
] as const;

function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-20">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="label tabular-nums text-amber">{num}</span>
        <h2 className="serif text-2xl text-paper">{title}</h2>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function Litepaper({ stats }: { stats: SiteStats }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-10 border-b border-ink-600 pb-8">
        <p className="label">litepaper · v1.1</p>
        <h1 className="serif mt-2 text-4xl leading-tight text-paper">
          Lagisalpha: the lead-lag edge in prediction markets
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          A prediction market sets its price by trading, so it lags the sharp, vig-free line that already
          holds the true probability. When it falls below fair, the cheap side is underpriced; across{" "}
          {stats.matchWord} settled World Cup matches it travelled back to fair about {stats.reachPct}% of the
          time, on every call the detector fired, none filtered out. This is the writeup: why the edge
          exists, how we measure it on the real fills, and how honest the numbers are.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <a
            href="/lagisalpha-litepaper.pdf"
            download
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ↓ Download PDF
          </a>
          <Link href="/edge" className="card px-4 py-2 text-muted hover:text-fg">
            See the edge live →
          </Link>
        </div>
      </header>

      {/* TOC */}
      <nav className="card mb-12 p-5">
        <p className="label mb-3">contents</p>
        <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SECTIONS.map(([num, title]) => (
            <li key={num}>
              <a href={`#s${num}`} className="flex gap-2 text-sm text-muted hover:text-amber">
                <span className="tabular-nums text-faint">{num}</span>
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="s01" num="01" title="The claim">
        <p>
          A prediction market moves its price only when someone trades. News moves faster. So in the
          seconds after a goal the market sits behind the true probability, and one side is cheap. That lag
          is the edge: measurable, repeatable, and gone the moment the market catches up.
        </p>
      </Section>

      <Section id="s02" num="02" title="Why the edge exists">
        <p>
          Two facts. The market is slow: it reprices by trading, not by knowing. The reference is fast:
          TxLINE strips the bookmaker margin from a live odds feed, so its price is the true probability,
          and it moves the instant news lands. The gap between them is how far the market is behind, and
          which way it is about to move.
        </p>
      </Section>

      <Section id="s03" num="03" title="The signal: a divergence">
        <p>
          We work in probability space. TxLINE&apos;s de-vig 1X2 gives the fair probability a team wins. The
          market&apos;s moneyline gives its own probability of the same event. When the fair sits above the
          market price by more than a threshold, the cheap side is underpriced, and we mark an entry: which
          side, how far off fair, and how much size you could later exit into at fair. One dislocation is one
          entry, not a burst.
        </p>
      </Section>

      <Section id="s04" num="04" title="The proof: does it close, does it pay">
        <p>
          Two tests, on {stats.matchWord} settled matches, on the real fills. <span className="text-fg">Reach</span>:
          from the entry, does the market price travel to the fair before the match ends. It does about{" "}
          <span className="text-amber">{stats.reachPct}%</span> of the time, and the move often takes minutes,
          so a short holding window hides it. Reach does not depend on who eventually wins, so it is the
          firmer number.
        </p>
        <p>
          <span className="text-fg">Return</span>: the trade is to buy the cheap side and take profit at
          fair when the market catches up. Sized by Kelly on the gap, f = gap / (1 - price), capped at 30%
          of the balance per call, and compounded across every call with nothing excluded, that stands at
          about <span className="text-amber">{stats.roiPct >= 0 ? "+" : ""}{stats.roiPct}%</span> at a 5
          point gap and <span className="text-amber">{stats.roi10Pct >= 0 ? "+" : ""}{stats.roi10Pct}%</span>
          {" "}at 10. The same bets held to the final result instead returned about {stats.resPct >= 0 ? "+" : ""}
          {stats.resPct}% and {stats.res10Pct >= 0 ? "+" : ""}{stats.res10Pct}%: whichever exit you pick,
          the convergence leg is where the money is, and holding to the outcome does far worse. The cap is
          what earns that: full Kelly, uncapped, once staked 81% of the balance on a single call and gave
          back 76% of it — capping any one bet at 30% bounds the damage while keeping every call in the
          record. The compounded number is still concentrated, a couple of high-volume matches carry it, so
          reach is the firmer read; the return is published as-is and moves as each match settles.
        </p>
      </Section>

      <Section id="s05" num="05" title="The data, verifiable both sides">
        <p>
          The fair is TxLINE&apos;s World Cup feed: odds and scores anchored on Solana, access minted by a
          real on-chain subscribe transaction. The market side is real fills read straight from Polygon,
          decoded to a price and a size per trade. Both legs are public: open any fill as a Polygon
          transaction, settle any outcome on TxLINE&apos;s on-chain scores, and recompute the edge yourself.
          Nothing here is asserted.
        </p>
      </Section>

      <Section id="s06" num="06" title="How to trade it">
        <p>
          Catch the divergence live on the{" "}
          <Link href="/edge" className="text-amber hover:text-fg">edge page</Link>, take the cheap side at
          the market price, and take profit at TxLINE fair when the market catches up. Size each bet by Kelly
          on the gap, capped at 30% of the balance, so a bigger dislocation gets a bigger bet but no single
          call can over-bet into ruin. Holding to
          the final result instead is a losing trade on this data, so the play is the take-profit, not the
          settlement.
        </p>
        <p>
          The size we show is the liquidity you could have exited into at fair or better, counted only when
          the price actually reached fair; when it never does, the size is zero, because you could never have
          exited there. How much you take, and any price you move by taking it, is your own execution cost. It
          is not part of the signal.
        </p>
      </Section>

      <Section id="s07" num="07" title="What we do not claim">
        <p>
          The edge is validated on {stats.matchWord} matches, so the return is a pilot, not a promise. The
          confidence interval still spans zero at this sample, and the return leans on a few high-volume matches; the
          reach rate is the firmer read, and both tighten as matches accrue. This measures a delay between
          two markets. It is not a trading strategy, it is not financial advice, and any sizing or slippage
          is your own.
        </p>
      </Section>

      <Section id="s08" num="08" title="What we found">
        <p>
          The obvious idea is a sharp-movement detector: flag significant TxLINE odds shifts and track
          whether they call the result. We built it and killed it twice. Graded early, a significant fair
          shift by the 45th minute called the winner <span className="text-muted">58%</span> of the time, a
          coin flip. Graded whenever a big shift fires (10pp inside a minute, any time in the match) it looks
          strong at <span className="text-muted">83%</span>, but that number is hollow: a rule that ignores
          the shift entirely and just backs whichever team the fair currently rates higher makes the
          <span className="text-fg"> identical call in 12 of 12 matches</span>, with the identical score.
          Nine of twelve shifts sit within two minutes of a goal, so the shift is the goal being repriced;
          all of the predictive content is in the level of the fair, none is in the move itself. The
          forecast has no alpha.
        </p>
        <p>
          The edge is not the line moving; it is the market being slow to follow it. A goal is new
          information: TxLINE reprices it instantly, but a prediction market only moves when someone trades,
          so for a window the cheap side sits below fair. That lead-lag converges about{" "}
          <span className="text-amber">{stats.reachPct}%</span> of the time, and it is our strongest, most
          proven signal. The line move carries no forecast; the lag in the market&apos;s reaction to it is
          the entire product.
        </p>
        <p>
          And the record rolls on its own. Every divergence the detector fires is published and scored:
          either side, any size, any minute of the match, each side named by its team. There is no exclusion
          filter and no curated subset; sizing is the only risk control, and it is Kelly on the gap capped at
          30% of the balance per call. An earlier version instead cut two classes of buy-NO call; we retired
          that filter and cap the sizing instead, so the mechanism is shown whole, with the calls that hurt
          it left in and bounded rather than removed.
        </p>
        <p>
          Separately, a TxLINE high-danger possession makes a goal by that team about {" "}
          <span className="text-amber">four times</span> more likely within two minutes, and a divergence it
          flags converges to fair <span className="text-amber">84%</span> of the time versus{" "}
          <span className="text-fg">75%</span> without. All of this is on {stats.matchWord} settled matches,
          in-sample; it is a promising pilot, not a settled result.
        </p>
      </Section>

      <Section id="s09" num="09" title="Roadmap: 75 leagues, forecasting done honestly">
        <p>
          <span className="text-fg">Scale the measurement.</span> TxLINE carries the demargined consensus
          for around 75 leagues, and the lag is structural: every prediction market reprices by trading, so
          it sits behind a fast, vig-free reference in any league that has one. The same divergence
          detection runs per league and per market, and the first deliverable is a{" "}
          <span className="text-fg">lag profile</span> for each: how wide the average dislocation opens, how
          long it takes to converge, and how much size sits in the window. That map, which leagues lag
          longest, is itself the product, and every league gets the same public calibration ledger this
          pilot has.
        </p>
        <p>
          <span className="text-fg">Model the outcome as unknown.</span> We killed the sharp-movement
          detector, but the flaw was the grading, not the ambition. Scoring a shift by &quot;did that team
          win&quot; assumes the winner is knowable from history and lets late, goal-driven shifts grade
          themselves. The honest frame is Bayesian: the pre-match de-vig consensus is the prior, each early
          odds shift updates a posterior over the result, and the model is scored on calibration (Brier and
          log score) across thousands of matches in 75 leagues, never on hit-rate over twelve. This is the
          approach of Robberechts, Van Haaren and Davis,{" "}
          <span className="text-fg">&quot;A Bayesian Approach to In-Game Win Probability in Soccer&quot;</span>{" "}
          (KDD 2021): treat the in-play outcome as uncertain throughout, seed the prior from pre-match
          strength, update sequentially, and judge the posterior, with the dynamic-prior lineage going back
          to Rue and Salvesen (2000).
        </p>
        <p>
          <span className="text-fg">Where the two meet.</span> The test that matters is whether an
          early-shift posterior moves before the traded market does. If it does, the lead-lag gains a
          forward leg on top of the post-goal reactive one; if it does not, we will publish that, the same
          way we published the coin flip. Either answer sharpens the signal API: per-league divergence
          feeds, portfolio Kelly across simultaneous matches, and new markets (cards, corners) as TxLINE
          streams them de-vigged.
        </p>
      </Section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Lagisalpha · built on the TxLINE World Cup data layer ·{" "}
        <Link href="/edge" className="text-amber hover:text-fg">
          see the edge live →
        </Link>
      </footer>
    </div>
  );
}
