import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { getSiteStats } from "@/lib/site-stats";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteStats();
  return {
    title: "Lagisalpha: the delay in prediction market prices, measured · built on TxLINE",
    description: `Prediction markets trade a step behind the true price. TxLINE strips the vig, so its odds are the true price; when a prediction market lags it, the cheap side is underpriced, and it snaps back to fair ${s.reachPct}% of the time. Measured live, proven on-chain.`,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
