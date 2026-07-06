import Nav from "@/components/Nav";
import Litepaper from "@/components/Litepaper";
import { getSiteStats } from "@/lib/site-stats";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const s = await getSiteStats();
  return {
    title: "Litepaper: Lagisalpha",
    description: `Lagisalpha measures the delay in prediction market prices. TxLINE's vig-free odds are the true price; a prediction market lags them, and the cheap side is underpriced. It reaches the fair ${s.reachPct}% of the time, and Kelly-sized bets taking profit at fair returned about +${s.roiPct}% across ${s.matchWord} matches. Measured on real on-chain fills, proven on-chain.`,
  };
}

export default async function LitepaperPage() {
  const stats = await getSiteStats();
  return (
    <main className="min-h-screen">
      <Nav />
      <Litepaper stats={stats} />
    </main>
  );
}
