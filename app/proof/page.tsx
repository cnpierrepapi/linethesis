import Nav from "@/components/Nav";
import ProofLedger from "@/components/ProofLedger";
import { getProof } from "@/lib/proof";
import { getPickoffs } from "@/lib/pickoff-source";

export const metadata = { title: "The track record: Lagisalpha" };
export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();

export default async function ProofPage() {
  const [ledger, proof] = await Promise.all([getPickoffs(), Promise.resolve(getProof())]);
  const hasEntries =
    !!ledger && ledger.matches.some((m) => (m.divergences?.["5"]?.length ?? 0) > 0);

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">the track record</p>
        <h1 className="serif mt-2 text-4xl text-paper">Every edge, proven on the real fills.</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          This is the same divergence ledger you drive on the Edge page, with one thing added: each entry
          opens into the actual Polygon transactions that traded at your take-profit price (TxLINE fair or
          better). TxLINE&apos;s vig-free fair leads; the prediction market lags; when the gap opens past the
          threshold the cheap side sits there to be taken. We show whether that gap closes, the ROI from
          taking profit at fair, and then the on-chain fills that prove the exitable size was real. Nothing
          here is asserted; open any transaction and confirm it yourself.
        </p>

        {ledger && hasEntries ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{ledger.matchCount}</p>
                <p className="text-xs text-muted">matches measured</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{usd(ledger.totals.usd)}</p>
                <p className="text-xs text-muted">traded in-play, measured vs fair</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-amber">{usd(ledger.totals.ge5pp_usd)}</p>
                <p className="text-xs text-muted">cheap side traded ≥5pp below fair</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-amber">{usd(ledger.totals.ge10pp_usd)}</p>
                <p className="text-xs text-muted">cheap side traded ≥10pp below fair</p>
              </div>
            </div>

            <div className="mt-8">
              <ProofLedger matches={ledger.matches} pooled={ledger.pooled} />
            </div>

            <p className="mt-4 text-xs text-faint">
              Updated {new Date(ledger.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC ·
              new matches settle into the ledger automatically as the tournament plays out.
            </p>
          </>
        ) : (
          <p className="mt-8 text-sm text-faint">
            The ledger publishes after each match settles on-chain. Check back once the next match closes.
          </p>
        )}

        {/* PROVENANCE */}
        <div className="mt-10 border-t border-ink-600 pt-6">
          <p className="label">provenance</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The fair line is TxLINE&apos;s Solana-anchored World Cup feed; the book is a prediction market&apos;s
            fills read straight from Polygon. Both legs are public, so you can recompute every number on this
            page yourself.
          </p>
          {proof.signedOnSolana && (
            <p className="mt-3 text-sm">
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-muted underline decoration-ink-500 underline-offset-2 hover:text-fg"
              >
                access signed on Solana · tx {proof.signupTx?.slice(0, 6)}…{proof.signupTx?.slice(-4)} ({proof.cluster})
              </a>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
