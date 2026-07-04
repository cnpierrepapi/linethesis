import Link from "next/link";

const SECTIONS = [
  ["01", "Abstract"],
  ["02", "The problem: the stale line gets picked off"],
  ["03", "The idea: an independent, read-only benchmark"],
  ["04", "The data layer: TxLINE"],
  ["05", "The signal engine"],
  ["06", "Grading: Fair Close Value and on-chain self-scoring"],
  ["07", "The read-only boundary"],
  ["08", "Why it's adoptable: the independent referee"],
  ["09", "Proof and verifiability"],
  ["10", "The Operator API and SDK"],
  ["11", "Infrastructure: why this needs TxOdds"],
  ["12", "Responsible use"],
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

export default function Litepaper() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-10 border-b border-ink-600 pb-8">
        <p className="label">litepaper · v1.0</p>
        <h1 className="serif mt-2 text-4xl leading-tight text-paper">
          Agenthesis: a read-only line-integrity oracle
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          An independent agent that benchmarks a betting operator&apos;s prices against TxLINE&apos;s
          vig-free consensus, warns them the instant a line is stale enough to get picked off, and
          settles every warning on-chain, so its track record is provable, not asserted. You keep
          the book. We never touch it.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <a
            href="/agenthesis-litepaper.pdf"
            download
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ↓ Download PDF
          </a>
          <Link href="/sdk" className="card px-4 py-2 text-muted hover:text-fg">
            Integrate (API + SDK) →
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

      <Section id="s01" num="01" title="Abstract">
        <p>
          In-play betting markets move fast, and the operators who post prices into them lose money at
          one specific moment: when their line is <em className="text-fg">stale</em>. The consensus
          re-prices on new information: a goal, a red card, a surge of danger; and a book that hasn&apos;t
          caught up is lifted at the old number before it can adjust. Agenthesis is a read-only agent
          that watches that gap. It benchmarks a watched price against TxLINE&apos;s de-margined (no-vig)
          consensus, classifies every reference-line move as a clean move to{" "}
          <span className="amber">follow</span> or an overreaction to <span className="amber">fade</span>,
          warns before the pickoff, and grades every call it makes against on-chain ground truth. It is
          not a bookmaker, a market-maker, or a managed-trading service. It is the neutral, provable
          benchmark that sits beside the book.
        </p>
      </Section>

      <Section id="s02" num="02" title="The problem: the stale line gets picked off">
        <p>
          Adverse selection is the structural cost of quoting a price. Sharp money, bots, syndicates,
          faster books, exists to lift a mispriced line, and in-play is where the mispricing lives:
          the seconds around a goal, when the fair price has jumped and a lagging in-play number has
          not. The books most respected by sharps (Pinnacle, Circa) win on one thing: speed of price
          discovery. Everyone slower leaks margin to stale-line abuse.
        </p>
        <p>
          Prediction-market makers face the identical phenomenon under a different name,
          loss-versus-rebalancing, where static automated prices become stale as information arrives
          and are picked off by better-informed flow. One phenomenon, two buyers. The question every
          operator asks is the same: <span className="text-fg">is my price stale right now, and in
          which direction am I exposed?</span>
        </p>
      </Section>

      <Section id="s03" num="03" title="The idea: an independent, read-only benchmark">
        <p>
          Agenthesis answers that question and stops. It emits a signal, a recommendation with a
          confidence and a pickoff-risk, and the operator&apos;s own rule-set decides whether to widen a
          margin, cut a limit, or suspend a market. We compute the decision; the book takes the action.
          That boundary is the entire product: it is why an unknown vendor&apos;s agent is something a real
          operator&apos;s compliance team will actually deploy, and why the tool carries no wagering or
          securities surface; it is a data and analytics layer, not a betting operator.
        </p>
        <p>
          The reference is not our opinion. It is TxLINE&apos;s de-margined consensus, so the benchmark is
          neutral by construction. We transform TxLINE&apos;s frames into a fair line and measure the
          operator&apos;s distance from it. Nothing about the operator&apos;s pricing model is required, replaced,
          or exposed.
        </p>
      </Section>

      <Section id="s04" num="04" title="The data layer: TxLINE">
        <p>
          Everything Agenthesis does rests on one thing only TxLINE provides: a{" "}
          <span className="text-fg">de-vig (de-margined) odds stream</span>. The bookmaker margin is
          stripped out, so each side&apos;s price is already a clean implied probability, for a side priced{" "}
          <code className="text-info">price</code>, the fair probability is{" "}
          <code className="text-info">pRef = 1 / (price/1000)</code>. That is the whole trick: with the
          vig removed, a line move is no longer noise, it is a measurable shift in the{" "}
          <em className="text-fg">true</em> price, which is what lets us separate a real move to follow
          from an overreaction to fade. No ordinary odds feed exposes this; it is why the product can
          only run on TxLINE. Two goals-settled families stream demargined today, Asian-handicap goals
          and over/under goals, and both resolve from the two on-chain goal counts, so every signal is
          settleable and verifiable.
        </p>
        <p>
          TxLINE serves a second stream we depend on just as much: a granular{" "}
          <span className="text-fg">possession tape</span> alongside the scores feed, danger and
          high-danger possession, goal-imminent flags, that reads the attacking pressure seconds before
          the line jumps. Our <code className="text-info">goal_imminent</code> signal is built entirely
          on that tape, and it is where the next generation of signals comes from: the more of the
          possession stream we read, the more we can flag before a price ever moves. So Agenthesis
          consumes <span className="text-fg">two TxLINE streams, and only TxLINE streams</span>. The
          feed is anchored on Solana, and access is minted by a real on-chain subscribe transaction, so
          the reference&apos;s provenance is publicly verifiable.
        </p>
        <p>
          The natural next step is coverage. Today the signals are scoped to the goals markets that
          stream demargined; the more of the de-vig book TxLINE streams{" "}
          <span className="text-fg">beyond goals</span>, cards, corners, match-result, shots, the more of
          an operator&apos;s book Agenthesis can watch. Broader demargined coverage is a direct multiplier
          on how many of an operator&apos;s lines we can protect.
        </p>
      </Section>

      <Section id="s05" num="05" title="The signal engine">
        <p>
          The engine ingests odds and score frames and classifies each reference-line move, grounded in
          the market-microstructure literature:
        </p>
        <ul className="ml-1 space-y-2">
          <li>
            <span className="amber">steam → follow.</span> The <span className="text-fg">primary
            edge</span>. The market prices real news efficiently and momentum persists (Croxson &amp;
            Reade; Moskowitz): on our captures a flagged move held ~89% of the time. A clean move is
            true; a book that follows it late is exactly the stale price a sharp lifts. Tighten toward
            the reference.
          </li>
          <li>
            <span className="amber">overreaction → hold / fade.</span> The exception, not the rule.
            Bettors underreact to most goals and overreact only to <em className="text-fg">surprising</em>{" "}
            ones (Choi &amp; Hui; De Bondt–Thaler), so only a minority of goal-moves overshoot and revert
            (~18% in our data). The default is hold; we escalate to fade only on the surprise path, never
            on magnitude alone; big goal-moves are usually decisive and stick.
          </li>
          <li>
            <span className="amber">goal_imminent → suspend.</span> A first-class signal off the
            momentum tape (high-danger possession / an explicit goal-imminent flag) that fires seconds
            before a goal lands, carrying a <span className="text-fg">quantified</span>{" "}
            <code className="text-info">goalProb</code> = the calibrated P(goal ≤120s); high-danger
            possession runs a measured 1.9× the base arrival rate. It does not assume the line will
            pre-drift (our drift test found no tradeable pre-goal move; the consensus already prices the
            danger), so the action is suspend/widen only: the earliest notice that an in-play price is
            about to go stale.
          </li>
        </ul>
        <p>
          Overreaction firing is sharpened by <em className="text-fg">surprise</em>: how far the goal
          moved the scoreline probability from its pre-event value. Steam and overreaction signals are
          scoped to the two on-chain-settleable goals markets, so nothing is emitted that can&apos;t later
          be proven.
        </p>
      </Section>

      <Section id="s06" num="06" title="Grading: Fair Close Value and on-chain self-scoring">
        <p>
          A call is right when the line behaves as the signal said it would, and for a{" "}
          <span className="amber">follow</span> that is not &quot;CLV is positive.&quot; A follow is taken
          at fair value, so its expected closing-line value is ~0 by construction; grading it on CLV&gt;0
          would fail about half the continuations that were, in fact, correct. So the skill leg is{" "}
          <span className="amber">Fair Close Value (FCV)</span>: the demargined fair probability at the{" "}
          <code className="text-info">+180s</code> close. A follow or hold is right when the line{" "}
          <span className="text-fg">held</span> in the region it moved to, FCV stayed within{" "}
          <code className="text-info">±10pp</code> of entry, because a book still quoting the old number
          is then left behind. A <span className="amber">fade</span> keeps the reversion test: the
          overshoot came back. FCV resolves from odds alone, so it settles fast and with low variance;
          CLV is retained as an auxiliary diagnostic.
        </p>
        <p>
          <span className="amber">goal_imminent</span> has no line to close against, so it is graded on a
          third axis entirely: goal <span className="text-fg">arrival</span>. We settle it against
          whether a goal actually landed inside the window and report the lift over the base arrival rate
          (~1.9× on our captures): the honest proof for an anticipation signal is not &quot;the line
          moved&quot; but &quot;the goal came disproportionately often.&quot;
        </p>
        <p>
          The outcome leg settles against the final goals on the TxLINE daily-scores Merkle root via a{" "}
          <code className="text-info">validateStat</code> proof. The result is a public calibration
          ledger where the agent grades itself on-chain: follow/hold held-rate, fade reversion-rate, and
          goal_imminent arrival-lift per signal type and action, with per-match breadth and single-match
          concentration surfaced so a headline can&apos;t hide behind one lucky match.
        </p>
      </Section>

      <Section id="s07" num="07" title="The read-only boundary">
        <p>
          Agenthesis places no bet, moves no price, and holds no funds. The action is always the
          operator&apos;s. The{" "}
          <Link href="/desk" className="text-amber hover:text-fg">
            Control Room
          </Link>{" "}
          makes the boundary visible: each signal, the gap between a watched book and the reference (the
          pickoff surface), and the action the operator&apos;s policy chose: widen, cut, or suspend. The
          policy is a rule-set the operator controls; we report which rule fired.
        </p>
        <p>
          This is also the answer to &quot;what if the agent is wrong?&quot; It is wrong a knowable fraction
          of the time, and the design makes wrong cheap: recommendations are confidence-weighted, the
          default under uncertainty is the safe action, and the operator sets the exposure envelope. It
          is a positive-expectation risk policy, not a must-be-right prediction.
        </p>
      </Section>

      <Section id="s08" num="08" title="Why it's adoptable: the independent referee">
        <p>
          Incumbents already sell repricing: managed trading services and dynamic-pricing engines that
          adjust an operator&apos;s odds in real time. Agenthesis deliberately does not compete there. That
          lane is both the most contested and the one an operator is least willing to hand a startup,
          because it means giving up control of the book.
        </p>
        <p>
          The incumbents&apos; structural weakness is that they are player and referee at once: they price
          your book, they may share your P&amp;L, and they sell you the integrity feed, an unauditable
          black box. Agenthesis is the neutral referee they cannot be. No managed trading, no shared
          P&amp;L, no conflict; read-only; and, uniquely, <span className="text-fg">provable</span>,
          because the track record settles on-chain. Verify-before-trust is the antidote to the
          black-box problem, and it is the one thing a non-anchored feed cannot offer.
        </p>
      </Section>

      <Section id="s09" num="09" title="Proof and verifiability">
        <p>
          Every signal carries a <code className="text-info">proofHash</code> tying it to the exact
          TxLINE frame it was derived from, reconcilable against a downloadable frame ledger; join on
          fixture and frame timestamp to confirm our reference matches yours. The{" "}
          <Link href="/proof" className="text-amber hover:text-fg">
            proof page
          </Link>{" "}
          publishes the full calibration ledger.
        </p>
        <p>
          The Solana touchpoint is <span className="text-fg">proof of access</span>: a real on-chain
          subscribe transaction, signed with a wallet, mints the right to the TxLINE stream. That
          signature is a public, verifiable hash anyone can open on Solana Explorer, anchoring the claim
          that the reference is the genuine, authorized feed. Outcome settlement anchors to the same
          chain via the daily-scores Merkle root.
        </p>
      </Section>

      <Section id="s10" num="10" title="The Operator API and SDK">
        <p>
          The product is the <span className="text-fg">API</span>. Agenthesis is delivered as{" "}
          <code className="text-info">GET /api/v1/signals</code>, an authenticated, versioned HTTP feed
          of read-only signals, alongside <code className="text-info">/api/v1/calibration</code> (the
          provable track record) and <code className="text-info">/api/v1/control-room</code> (the
          read-only boundary timeline). Every signal carries a proofHash, and a webhook pushes the
          identical payload from a persistent worker. An operator integrates in an afternoon with no
          code to embed and nothing of their pricing model exposed.
        </p>
        <p>
          The <span className="text-fg">SDK</span> is an optional thin wrapper around the identical pure
          functions, the detector, the classifier, and the grader, for latency-sensitive consumers
          that run the classifier in-process, where a network round-trip can&apos;t sit inside a
          millisecond pickoff loop. It is the exact code the API serves (SDK↔API parity): pure,
          deterministic, unit-tested, safe to place next to a live book.
        </p>
        <p>
          Read the integration guide on the{" "}
          <Link href="/sdk" className="text-amber hover:text-fg">
            API &amp; SDK page
          </Link>
          .
        </p>
      </Section>

      <Section id="s11" num="11" title="Infrastructure: why this needs TxOdds">
        <p>
          A production line-integrity signal is a latency game. The warning is only worth money if it
          beats the pickoff by milliseconds, which requires direct, co-located access to the TxLINE
          feed and low-latency infrastructure that only TxOdds can provision. The deterministic poll and
          replay in this build prove the logic on real captured frames; a live deployment is a different
          class of system.
        </p>
        <p>
          So a win here is the <span className="text-fg">start of a continuing partnership</span>,
          direct-feed and infrastructure support, not a finished artifact. The value compounds with
          every logged match, and the moat (an on-chain-provable calibration record) is one no
          non-anchored competitor can reproduce.
        </p>
        <p>
          And the partnership runs both ways. Agenthesis is also a <span className="text-fg">reason to be
          on TxLINE</span>: any bookmaker or prediction market already taking the feed can bolt it on and
          instantly harden its line integrity, no new pricing model, no giving up the book, so it makes
          the de-vig feed worth more to the operators who buy it, an upgrade sitting on top of the data
          layer. Concretely, continued support means two things: low-latency direct access to{" "}
          <span className="text-fg">both streams</span> (the de-vig odds and the possession tape), and
          more of the demargined book beyond goals, so the shield can cover every line an operator
          quotes, not only the goals markets.
        </p>
      </Section>

      <Section id="s12" num="12" title="Responsible use">
        <p>
          Agenthesis is a read-only research and risk-analytics layer built on de-margined data. It
          places no wagers, holds no funds, and moves no prices; the operator&apos;s rule-set takes every
          action. Fair Close Value and reversion are measures of pricing skill, not a promise of profit,
          and calibration over a replay does not guarantee live results. Nothing here is financial
          advice.
        </p>
      </Section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Agenthesis · built on the TxLINE World Cup data layer ·{" "}
        <Link href="/desk" className="text-amber hover:text-fg">
          see the read-only boundary in the Control Room →
        </Link>
      </footer>
    </div>
  );
}
