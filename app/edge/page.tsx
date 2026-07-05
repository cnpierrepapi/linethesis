import Nav from "@/components/Nav";
import ReplayEdge from "@/components/ReplayEdge";
import LiveEdgePanel from "@/components/LiveEdgePanel";
import { getPickoffs } from "@/lib/pickoff-source";

export const metadata = { title: "Replay the edge: Linescout" };
export const dynamic = "force-dynamic";

export default async function EdgePage() {
  const ledger = await getPickoffs();
  const matches = ledger?.matches ?? [];

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">replay the edge</p>
        <h1 className="serif mt-2 text-4xl text-paper">The delay in prediction market, measured.</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          TxLINE&apos;s vig-free fair leads; the prediction market book lags. When the gap opens past the threshold,
          the cheap side is underpriced: a divergence. Two things say the signal is real: whether the book
          then travels back to TxLINE&apos;s price (the delay closing), and whether the cheap side is a
          positive-edge buy at resolution. Both are measured on the real fills, pooled across matches.
        </p>
        <div className="mt-6">
          <LiveEdgePanel />
        </div>
        <div className="mt-5">
          <ReplayEdge matches={matches} pooled={ledger?.pooled} />
        </div>
        <p className="mt-4 text-xs text-faint">
          This measures the mispricing, not a trading strategy: how much someone stakes, and any price they
          move doing it, is their own execution cost, not part of the signal. Fills and outcomes are the same
          on-chain data the ledger settles against.
        </p>
      </section>
    </main>
  );
}
