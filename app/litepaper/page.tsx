import Nav from "@/components/Nav";
import Litepaper from "@/components/Litepaper";

export const metadata = {
  title: "Litepaper: Linescout",
  description:
    "Linescout measures the delay in prediction market prices. TxLINE's vig-free odds are the true price; a prediction market lags them, and the cheap side is underpriced. It reaches the fair 73% of the time. Measured on real on-chain fills, proven on-chain.",
};

export default function LitepaperPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Litepaper />
    </main>
  );
}
