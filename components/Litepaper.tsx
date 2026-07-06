import Link from "next/link";

const SECTIONS = [
  ["01", "The claim"],
  ["02", "Why the edge exists"],
  ["03", "The signal: a divergence"],
  ["04", "The proof: does it close, does it pay"],
  ["05", "The data, verifiable both sides"],
  ["06", "How to trade it"],
  ["07", "What we do not claim"],
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
          Lagisalpha: the lead-lag edge in prediction markets
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          A prediction market sets its price by trading, so it lags the sharp, vig-free line that already
          holds the true probability. When it falls below fair, the cheap side is underpriced; it travels
          back to fair 73% of the time, and buying it paid a positive edge. This is the writeup: why the
          edge exists, how we measure it on real fills, and how honest the numbers are.
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
          Two tests, on eight settled matches, on the real fills. <span className="text-fg">Reach</span>:
          from the entry, does the market price travel to the fair before the match ends. It does about
          73% of the time, and the move often takes minutes, so a short holding window hides it.
        </p>
        <p>
          <span className="text-fg">Edge</span>: buy the cheap side and hold it to the result, which pays
          one dollar per share if it wins and zero if it does not. Pooled, that paid about{" "}
          <span className="text-amber">+18%</span> at a 5 point gap and <span className="text-amber">+32%</span>{" "}
          at 10, and the edge grew with the gap. Reach does not depend on who eventually wins, so it is the
          firmer number.
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
          the market price, and exit one of two ways: at the fair when the market catches up (a
          take-profit), or at the result (hold to resolution). We show the size you could exit into at fair,
          only counted when the price actually reached fair, so you can judge scale.
        </p>
        <p>
          How much you take, and any price you move by taking it, is your own execution cost. It is not part
          of the signal. The signal says the price is cheap and by how much; sizing is yours.
        </p>
      </Section>

      <Section id="s07" num="07" title="What we do not claim">
        <p>
          The edge is validated on eight matches, so the return is a pilot, not a promise. The confidence
          interval on the edge still spans zero at this sample; the reach rate is the firmer read, and both
          tighten as matches accrue. This measures a delay between two markets. It is not a trading
          strategy, it is not financial advice, and any sizing or slippage is your own.
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
