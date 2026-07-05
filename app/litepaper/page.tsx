import Nav from "@/components/Nav";
import Litepaper from "@/components/Litepaper";

export const metadata = {
  title: "Litepaper: Linethesis",
  description:
    "The Linethesis thesis: a read-only line-integrity oracle that benchmarks a prediction market's real order book against TxLINE's de-vig consensus, warns before the stale-line pickoff, and settles every call on-chain. Measured on live Polymarket vs TxLINE.",
};

export default function LitepaperPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Litepaper />
    </main>
  );
}
