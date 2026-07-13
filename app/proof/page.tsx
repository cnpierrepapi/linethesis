import Nav from "@/components/Nav";
import ProofLedger from "@/components/ProofLedger";
import { getProof } from "@/lib/proof";
import { getPickoffs, getFairProofs } from "@/lib/pickoff-source";

export const metadata = { title: "The track record: Lagisalpha" };
export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();

export default async function ProofPage() {
  const [ledger, proof, fairBlob] = await Promise.all([
    getPickoffs(),
    Promise.resolve(getProof()),
    getFairProofs(),
  ]);
  const hasEntries =
    !!ledger && ledger.matches.some((m) => (m.divergences?.["5"]?.length ?? 0) > 0);
  const anchored = fairBlob
    ? Object.values(fairBlob.proofs).filter((p) => p.status === "anchored" && p.sig).length
    : 0;

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">the track record</p>
        <h1 className="serif mt-2 text-4xl text-paper">Every edge, proven on the real fills.</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          Every claim on this page is a pair of prices at one second of a match, and BOTH sides are proven
          on a public chain. The market side: the actual Polygon transactions that traded at the entry and
          at your take-profit price. The fair side: for each of those seconds, a Solana validate_odds
          transaction that the TxODDS oracle program only confirms when the odds record hashes into the
          Merkle root TxODDS committed on-chain for that day. So &quot;the market printed 0.19 while
          TxLINE&apos;s fair said 0.24&quot; is not our recording; it is two explorer links you can open.
          {anchored > 0 && <> {anchored} fair anchors are live on Solana mainnet so far.</>}
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
              <ProofLedger matches={ledger.matches} pooled={ledger.pooled} fairProofs={fairBlob?.proofs} />
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
            page yourself. The fair anchors work like this: TxODDS commits a Merkle root of every day&apos;s
            odds updates to Solana mainnet. For each fill second in the ledger we fetch the odds record that
            was in force from TxLINE&apos;s public API, take its Merkle proof, and land a validate_odds
            transaction against the oracle program ({fairBlob?.program ? `${fairBlob.program.slice(0, 6)}…${fairBlob.program.slice(-4)}` : "9ExbZj…cKaA"}).
            A tampered price cannot produce a confirming signature, so each Solscan link is the feed
            operator&apos;s own on-chain attestation of the fair at that second, not our word for it.
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
