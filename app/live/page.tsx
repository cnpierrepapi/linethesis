import Link from "next/link";
import Nav from "@/components/Nav";
import LiveStream from "@/components/LiveStream";
import { getPickoffs } from "@/lib/pickoff-source";

export const metadata = { title: "Live: Lagisalpha" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const ledger = await getPickoffs();
  const matches = ledger?.matches ?? [];

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-4xl px-5 py-12">
        <p className="label">live · TxLINE vs the market, tick by tick</p>
        <h1 className="serif mt-2 text-4xl text-paper">Watch the lag open in real time.</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Two prices, one clock: TxLINE&apos;s vig-free fair and the market price. In Live mode the detector
          polls the current match; in Replay mode a settled match plays back on a virtual clock. When the
          gap opens past the threshold, the row turns orange. That orange is the lead-lag, the cheap side
          sitting there to be taken.
        </p>
        <div className="mt-6">
          <LiveStream matches={matches} />
        </div>
        <p className="mt-4 text-xs text-faint">
          Live mode fills at kickoff; between matches it waits. For the interactive chart and the full track
          record, see <Link href="/edge" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">Edge</Link>{" "}
          and <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">Proof</Link>.
        </p>
      </section>
    </main>
  );
}
