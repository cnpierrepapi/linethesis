import Link from "next/link";
import PaperTerminal from "@/components/PaperTerminal";

// /launch is the pro-trader flagship: a live paper-trading terminal for the lead-lag edge. Set a
// bankroll, pick live or replay, and watch each divergence play out as a paper trade, Kelly-sized,
// taken at the market and exited at TxLINE fair, with the PnL. No real money moves. The terminal
// (components/PaperTerminal) runs the shared engine in the browser.

export default function LaunchDoc() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <header className="mb-10 border-b border-ink-600 pb-8">
        <p className="label">the pro-trader terminal · built on TxLINE</p>
        <h1 className="serif mt-2 text-4xl leading-tight text-paper">
          Paper-trade the lag before you risk a dollar.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          The edge is simple: a prediction market trades a step behind TxLINE&apos;s vig-free fair, so the
          cheap side is underpriced until it catches up. Lagisalpha streams every divergence, takes the cheap
          side on a fake bankroll, sizes it by Kelly, and exits at fair so you watch the convergence turn into
          PnL. No wallet, no real fills, no risk. Just the edge, played out on real matches.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link href="/api" className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20">
            Get an API key →
          </Link>
          <Link href="/proof" className="card px-4 py-2 text-muted hover:text-fg">
            See the track record
          </Link>
        </div>
      </header>

      {/* THE COMMAND FLOW */}
      <section className="mb-12">
        <p className="label mb-3">how it runs</p>
        <h2 className="serif mb-4 text-2xl text-paper">Four commands, then you watch.</h2>
        <p className="mb-3 text-sm text-muted">
          Live, right here. Try: <span className="text-amber">bankroll 10000</span>, then{" "}
          <span className="text-amber">matches</span>, then <span className="text-amber">replay POR-CRO</span>.
        </p>
        <PaperTerminal />
        <p className="mt-3 text-xs text-faint">
          Bankroll is fake and no order is ever placed. Sizing is Kelly by default. Live only runs when a match
          is in play; otherwise use <span className="text-muted">replay</span> on a recorded match.
        </p>
      </section>

      {/* TWO WAYS TO RUN */}
      <section className="mb-12">
        <p className="label mb-3">two ways to run it</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <h3 className="text-paper">Web terminal</h3>
            <p className="mt-2 text-sm text-muted">
              Open it here in the browser, paste your key, and go. Nothing to install.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Your own terminal</h3>
            <p className="mt-2 text-sm text-muted">
              The same commands run as a CLI in PowerShell, cmd, or any shell:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-ink-900 px-3 py-2 font-mono text-xs text-amber">npx lagisalpha</pre>
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="mb-12">
        <p className="label mb-3">what you get</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card p-5">
            <h3 className="text-paper">The fair, fed to you</h3>
            <p className="mt-2 text-sm text-muted">
              We hold the TxLINE token and stream the de-vig fair through the API. You do not need your own
              TxLINE access.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Paper trades, Kelly-sized</h3>
            <p className="mt-2 text-sm text-muted">
              Every divergence becomes a paper trade on your bankroll, taken at the market and exited at fair,
              with the PnL the same math the track record uses.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Telegram alerts</h3>
            <p className="mt-2 text-sm text-muted">
              Get the signals pushed to Telegram, alerts only or as paper trades on a bankroll you set.
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Paper trading only. Nothing here is an order, a position, or financial advice. Sizing and slippage on
        any real trade are your own. Built on TxLINE ·{" "}
        <Link href="/proof" className="text-amber hover:text-fg">see the track record →</Link>
      </footer>
    </div>
  );
}
