import Link from "next/link";

const SECTIONS = [
  ["01", "Abstract"],
  ["02", "The problem: the book lags the sharp price"],
  ["03", "The signal: a measured divergence"],
  ["04", "The data: TxLINE fair and prediction market fills"],
  ["05", "Test one: does the delay close"],
  ["06", "Test two: does the cheap side pay"],
  ["07", "Available size, and whose job sizing is"],
  ["08", "Proof: both sides on-chain"],
  ["09", "The live detector"],
  ["10", "Why it runs on TxLINE"],
  ["11", "Responsible use"],
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
          Linescout: measuring the delay in prediction market prices
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Prediction markets carry real money and deep sports volume, and their in-play prices lag the
          sharp, vig-free consensus. TxLINE publishes that consensus as a de-margined fair probability.
          Linescout puts the two side by side. When the prediction market price sits far enough below the TxLINE
          fair, the cheap side is underpriced; that gap is a divergence. We measure it on real on-chain
          fills, and we grade the signal, not a trader&apos;s profit and loss.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <a
            href="/linescout-litepaper.pdf"
            download
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ↓ Download PDF
          </a>
          <Link href="/edge" className="card px-4 py-2 text-muted hover:text-fg">
            Replay the edge →
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
          A prediction market sets a price by trading, so its price only moves when someone trades. New
          information arrives faster than that: a goal, a red card, a wave of pressure. In the seconds
          around a goal the prediction market price sits behind the true probability, and the underpriced side
          gets taken before the market catches up. TxLINE removes the bookmaker margin from a live odds
          feed, so every price it streams is already a clean fair probability. That gives us a reference
          the prediction market book can be measured against, tick for tick.
        </p>
        <p>
          Linescout detects the divergence and then answers two questions on real fills. First, does the
          prediction market price travel back to the TxLINE fair before the match ends: does the delay close.
          Across eight matches it closes about 73% of the time. Second, if you buy the cheap side and
          hold it to resolution, is that a positive-edge trade: the pooled edge is about plus 18% at a
          5 point gap, and it grows as the gap grows. The sample is still small, so we report a
          confidence interval that at eight matches still spans zero: this is a pilot, not a proven
          return. We do not size or trade for you. Sizing, and any price you move by taking size, is your
          own cost, not part of the signal.
        </p>
      </Section>

      <Section id="s02" num="02" title="The problem: the book lags the sharp price">
        <p>
          Every market that quotes a price pays a cost called adverse selection: better informed traders
          lift a stale price before it updates. In-play sport is where that cost lives, because the fair
          probability jumps on a goal and a price set by trading needs time to follow. Prediction market
          makers know the same problem by another name, loss versus rebalancing, where a resting price
          goes stale as information arrives and is picked off by faster flow.
        </p>
        <p>
          Prediction markets carry real money and deep sports volume, but have no real time, vig-free
          reference to settle their prices against. So the lag is not noise you can wave away; it is a
          repeatable window where one side of the book is cheap. The whole question is simple: right now,
          is the prediction market price behind the true probability, and on which side.
        </p>
      </Section>

      <Section id="s03" num="03" title="The signal: a measured divergence">
        <p>
          Linescout works in probability space. TxLINE&apos;s de-margined 1X2 market gives a fair
          probability that a team wins, summing to one across the three outcomes. A prediction market&apos;s
          moneyline gives the market&apos;s probability of the same event. Because both are the probability
          that a team wins, a difference between them is a real disagreement about price, not a units
          mismatch.
        </p>
        <p>
          When the fair probability sits above the prediction market price by more than a threshold, the cheap
          side is underpriced and we mark an entry: which side, how many points off fair, and how much
          size sat at the stale price. We use a threshold with hysteresis, so one dislocation is one
          entry, not a burst. That is the entire signal: a divergence, on the cheap side, at a real
          price. What a trader does with it comes next, and is theirs.
        </p>
      </Section>

      <Section id="s04" num="04" title="The data: TxLINE fair and prediction market fills">
        <p>
          Everything rests on TxLINE&apos;s de-vig odds stream. The bookmaker margin is stripped out, so
          each price is a clean implied probability: for a price <code className="text-info">p</code>, the
          fair probability is <code className="text-info">1 / (p/1000)</code>, de-margined across the
          outcomes. Remove the vig and a price move stops being noise and becomes a measurable shift in
          the true probability. No ordinary odds feed exposes this, which is why the product can only run
          on TxLINE. The feed is anchored on Solana, and access is minted by a real on-chain subscribe
          transaction, so the reference&apos;s provenance is public.
        </p>
        <p>
          The other side of the measurement is the prediction market itself. We read the market&apos;s fills straight
          from Polygon: the on-chain order fill logs, decoded to a price and a size for each trade. On
          one match, Paraguay versus France, that is about 24,000 in-play fills worth 8.6 million dollars.
          Both legs are public: the fair line is TxLINE&apos;s Solana-anchored feed, and the book is
          a prediction market&apos;s trades on Polygon. Nothing in the ledger is asserted; it is read from two
          chains.
        </p>
      </Section>

      <Section id="s05" num="05" title="Test one: does the delay close">
        <p>
          The first test is the pure signal: from the moment we mark the divergence, does the prediction market
          price ever travel to the TxLINE fair before the match ends. There is no time box; you hold until
          the price gets there. This is the take-profit view: if the price reaches the fair, the gap you
          entered on has closed, whether or not the team ends up winning.
        </p>
        <p>
          On the eight backfilled matches, the price reaches the TxLINE fair about 73% of the time at a
          5 point gap, and about 74% at a 10 point gap. Convergence is often slow, minutes rather than
          seconds, which is exactly why a short holding window hides it. Reach is the firmest number we
          have, because it does not depend on who eventually wins.
        </p>
      </Section>

      <Section id="s06" num="06" title="Test two: does the cheap side pay">
        <p>
          The second test settles at resolution. Buy the cheap side at the prediction market price, hold it to
          the final result, and the side pays one dollar per share if it wins and zero if it does not. If
          you consistently pay less than the side is worth, that is edge, and it shows up at settlement,
          not on the price path. Pooled across the matches, the cheap side&apos;s realized win rate minus
          the price paid is about plus 18% at a 5 point gap and about plus 32% at a 10 point gap. The edge
          grows with the size of the divergence, which is the right direction: a bigger mispricing pays
          more.
        </p>
        <p>
          We are honest about the sample. We resample at the match level, since every entry in a match
          shares one result, and the 90% confidence interval on the edge still spans zero at eight
          matches. So the point estimate is positive and consistent, but it is a pilot, not a proven
          return. The interval tightens as matches accrue, and new matches settle in automatically.
        </p>
      </Section>

      <Section id="s07" num="07" title="Available size, and whose job sizing is">
        <p>
          For each divergence we also report the size available: the dollars that actually traded at the
          stale price during the window. That is a floor on what was there to take. Pooled, that is
          several million dollars of fills sitting off the fair. We report it so a reader can judge scale,
          not so we can promise a fill.
        </p>
        <p>
          What we do not do is grade the signal on a trader&apos;s profit and loss. If someone puts in too
          much and moves the price against themselves, that is slippage: a self inflicted execution cost,
          and it is not a fault in the signal. The product tells you the price is cheap and by how much,
          and how much sat there. How much to take is your decision, and your risk.
        </p>
      </Section>

      <Section id="s08" num="08" title="Proof: both sides on-chain">
        <p>
          Every fill in the ledger is a Polygon transaction you can open in a block explorer. Every match
          outcome settles against TxLINE&apos;s on-chain daily-scores root, so the win or loss the edge is
          measured against is not our word; it is the same goal count anyone can verify. The Solana
          touchpoint is proof of access: a real subscribe transaction, signed with a wallet, mints the
          right to the TxLINE stream, and that signature is a public hash on Solana Explorer.
        </p>
        <p>
          The <Link href="/proof" className="text-amber hover:text-fg">proof page</Link> publishes the
          full ledger: the pickoff surface per match with tx hashes, and the graded signal with its reach
          rate, aggregate edge, and confidence interval. Do not trust the numbers; open them.
        </p>
      </Section>

      <Section id="s09" num="09" title="The live detector">
        <p>
          The historical tests prove the signal on settled matches. The live detector runs it in real
          time: it polls TxLINE&apos;s live 1X2 fair against the current prediction market book every minute, and
          flags a divergence the instant the book lags past the threshold. During a match the{" "}
          <Link href="/edge" className="text-amber hover:text-fg">edge page</Link> shows it live; between
          matches it sits idle. A live product is a latency game, since a divergence is only worth acting
          on while it is open, so a production version needs direct, low-latency access to the feeds.
        </p>
      </Section>

      <Section id="s10" num="10" title="Why it runs on TxLINE">
        <p>
          The signal exists only because TxLINE removes the vig. Without a de-margined fair, a gap between
          two prices is just two prices; with it, the gap is a distance from the true probability, and
          that distance is what a sharp gets paid to close. TxLINE also anchors both the odds and the
          scores on chain, which is what lets the whole measurement be verified rather than believed.
        </p>
        <p>
          The relationship runs both ways. Any market or book already taking the TxLINE feed can use
          Linescout to see where its prices lag, with no new pricing model and no change to its book, so
          Linescout is a reason to be on TxLINE. Continued support means two things: low-latency access so
          a live signal beats the pickoff, and more of the de-margined book beyond goals, such as cards,
          corners, and match result, so we can measure every line, not only the goals markets.
        </p>
      </Section>

      <Section id="s11" num="11" title="Responsible use">
        <p>
          Linescout is a read-only research and measurement layer built on de-margined data. It places no
          wagers, holds no funds, and moves no prices. It measures a delay in one market&apos;s prices
          against another market&apos;s fair; it is not a trading strategy and not financial advice. The
          historical edge is a pilot over a small sample, calibration does not guarantee live results, and
          any sizing or execution cost is the reader&apos;s own.
        </p>
      </Section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Linescout · built on the TxLINE World Cup data layer ·{" "}
        <Link href="/edge" className="text-amber hover:text-fg">
          replay the edge →
        </Link>
      </footer>
    </div>
  );
}
