import Link from "next/link";

const SECTIONS = [
  ["01", "Abstract"],
  ["02", "The problem: the stale line gets picked off"],
  ["03", "The idea: an independent, read-only benchmark"],
  ["04", "The data layer: TxLINE"],
  ["05", "The signal engine"],
  ["06", "Grading: CLV and on-chain self-scoring"],
  ["07", "The read-only boundary"],
  ["08", "Why it's adoptable: the independent referee"],
  ["09", "Proof and verifiability"],
  ["10", "The SDK and Operator API"],
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
          settles every warning on-chain — so its track record is provable, not asserted. You keep
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
            Integrate (SDK + API) →
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
          re-prices on new information — a goal, a red card, a surge of danger — and a book that hasn&apos;t
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
          Adverse selection is the structural cost of quoting a price. Sharp money — bots, syndicates,
          faster books — exists to lift a mispriced line, and in-play is where the mispricing lives:
          the seconds around a goal, when the fair price has jumped and a lagging in-play number has
          not. The books most respected by sharps (Pinnacle, Circa) win on one thing: speed of price
          discovery. Everyone slower leaks margin to stale-line abuse.
        </p>
        <p>
          Prediction-market makers face the identical phenomenon under a different name —
          loss-versus-rebalancing — where static automated prices become stale as information arrives
          and are picked off by better-informed flow. One phenomenon, two buyers. The question every
          operator asks is the same: <span className="text-fg">is my price stale right now, and in
          which direction am I exposed?</span>
        </p>
      </Section>

      <Section id="s03" num="03" title="The idea: an independent, read-only benchmark">
        <p>
          Agenthesis answers that question and stops. It emits a signal — a recommendation with a
          confidence and a pickoff-risk — and the operator&apos;s own rule-set decides whether to widen a
          margin, cut a limit, or suspend a market. We compute the decision; the book takes the action.
          That boundary is the entire product: it is why an unknown vendor&apos;s agent is something a real
          operator&apos;s compliance team will actually deploy, and why the tool carries no wagering or
          securities surface — it is a data and analytics layer, not a betting operator.
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
          The reference is TxLINE, the World Cup data layer, which publishes a{" "}
          <span className="text-fg">de-margined (no-vig) book</span>. Because the vig is removed, each
          side&apos;s price is a clean implied probability: for a side priced{" "}
          <code className="text-info">price</code>, the fair probability is{" "}
          <code className="text-info">pRef = 1 / (price/1000)</code>. Two goals-settled market families
          stream in the demargined feed — Asian-handicap goals and over/under goals — and both resolve
          from the two on-chain goal counts, so every signal is settleable and verifiable.
        </p>
        <p>
          A granular momentum tape rides alongside the scores stream — danger and high-danger
          possession, goal-imminent flags — that fires seconds before the line jumps. The feed is
          anchored on Solana, and access is minted by a real on-chain subscribe transaction, so the
          reference&apos;s provenance is publicly verifiable.
        </p>
      </Section>

      <Section id="s05" num="05" title="The signal engine">
        <p>
          The engine ingests odds and score frames and classifies each reference-line move, grounded in
          the market-microstructure literature:
        </p>
        <ul className="ml-1 space-y-2">
          <li>
            <span className="amber">steam → follow.</span> The market prices real news efficiently
            (Croxson &amp; Reade). A clean move is true; a book that follows it late is exposed. Tighten
            toward the reference.
          </li>
          <li>
            <span className="amber">overreaction → hold / fade.</span> A surprising goal overshoots and
            reverts within minutes (Choi &amp; Hui; De Bondt–Thaler). Don&apos;t chase it — and, when confident,
            lean against it.
          </li>
          <li>
            <span className="amber">pre-goal warning → suspend.</span> The momentum tape flags a
            goal-imminent state before the line moves — the earliest possible notice that an in-play
            price is about to go stale.
          </li>
        </ul>
        <p>
          Overreaction firing is sharpened by <em className="text-fg">surprise</em>: how far the goal
          moved the scoreline probability from its pre-event value. Signals are scoped to the two
          on-chain-settleable goals markets, so nothing is emitted that can&apos;t later be proven.
        </p>
      </Section>

      <Section id="s06" num="06" title="Grading: CLV and on-chain self-scoring">
        <p>
          Every signal is graded two ways. The skill leg is{" "}
          <span className="amber">closing-line value</span>: did the fair line keep moving toward the
          call to its closing value, measured over the reversion window? CLV resolves from odds alone,
          so it settles fast and with low variance. On our own captures, overreaction/fade calls are
          consistently CLV-positive while steam/follow — as the efficiency literature predicts — carries
          no standalone edge.
        </p>
        <p>
          The outcome leg settles against the final goals on the TxLINE daily-scores Merkle root via a{" "}
          <code className="text-info">validateStat</code> proof. The result is a public calibration
          ledger where the agent grades itself on-chain — hit-rate and average CLV per signal type, per
          action, with per-match breadth and single-match concentration surfaced so a headline can&apos;t
          hide behind one lucky match.
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
          pickoff surface), and the action the operator&apos;s policy chose — widen, cut, or suspend. The
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
          Incumbents already sell repricing — managed trading services and dynamic-pricing engines that
          adjust an operator&apos;s odds in real time. Agenthesis deliberately does not compete there. That
          lane is both the most contested and the one an operator is least willing to hand a startup,
          because it means giving up control of the book.
        </p>
        <p>
          The incumbents&apos; structural weakness is that they are player and referee at once: they price
          your book, they may share your P&amp;L, and they sell you the integrity feed — an unauditable
          black box. Agenthesis is the neutral referee they cannot be. No managed trading, no shared
          P&amp;L, no conflict; read-only; and — uniquely — <span className="text-fg">provable</span>,
          because the track record settles on-chain. Verify-before-trust is the antidote to the
          black-box problem, and it is the one thing a non-anchored feed cannot offer.
        </p>
      </Section>

      <Section id="s09" num="09" title="Proof and verifiability">
        <p>
          Every signal carries a <code className="text-info">proofHash</code> tying it to the exact
          TxLINE frame it was derived from, reconcilable against a downloadable frame ledger — join on
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

      <Section id="s10" num="10" title="The SDK and Operator API">
        <p>
          Two surfaces sit on the same core. A desk embeds the <span className="text-fg">SDK</span> —
          the classifier, the detector, and the CLV grader — in its own stack: pure, deterministic,
          unit-tested code with no I/O and no clock reads, safe to place next to a live book. An
          operator instead consumes the <span className="text-fg">HTTP API</span>: authenticated,
          versioned endpoints for the signals, the calibration ledger, and the read-only boundary
          timeline, each signal carrying a proofHash, plus a webhook that pushes the identical signal
          from a persistent worker.
        </p>
        <p>
          Read the integration guide on the{" "}
          <Link href="/sdk" className="text-amber hover:text-fg">
            SDK page
          </Link>
          .
        </p>
      </Section>

      <Section id="s11" num="11" title="Infrastructure: why this needs TxOdds">
        <p>
          A production line-integrity signal is a latency game. The warning is only worth money if it
          beats the pickoff by milliseconds — which requires direct, co-located access to the TxLINE
          feed and low-latency infrastructure that only TxOdds can provision. The deterministic poll and
          replay in this build prove the logic on real captured frames; a live deployment is a different
          class of system.
        </p>
        <p>
          So a win here is the <span className="text-fg">start of a continuing partnership</span> —
          direct-feed and infrastructure support — not a finished artifact. The value compounds with
          every logged match, and the moat (an on-chain-provable calibration record) is one no
          non-anchored competitor can reproduce.
        </p>
      </Section>

      <Section id="s12" num="12" title="Responsible use">
        <p>
          Agenthesis is a read-only research and risk-analytics layer built on de-margined data. It
          places no wagers, holds no funds, and moves no prices — the operator&apos;s rule-set takes every
          action. CLV is a measure of pricing skill, not a promise of profit, and calibration over a
          replay does not guarantee live results. Nothing here is financial advice.
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
