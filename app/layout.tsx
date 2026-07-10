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
  const title = "Lagisalpha: the delay in prediction market prices, measured · built on TxLINE";
  const description = `Prediction markets trade a step behind the true price. TxLINE strips the vig, so its odds are the true price; when a prediction market lags it, the cheap side is underpriced, and it snaps back to fair ${s.reachPct}% of the time. Paper-trade it with npx lagisalpha or on Telegram. Measured live, proven on-chain.`;
  const ogImage = { url: "/lagisalpha-og.png", width: 1280, height: 720, alt: "Lagisalpha — the lag is the alpha" };
  return {
    metadataBase: new URL("https://lagisalpha.vercel.app"),
    title,
    description,
    keywords: ["prediction markets", "Polymarket", "TxLINE", "lead-lag", "Kelly criterion", "arbitrage", "paper trading", "npx lagisalpha"],
    alternates: { canonical: "/" },
    openGraph: { title, description, url: "https://lagisalpha.vercel.app", siteName: "Lagisalpha", type: "website", images: [ogImage] },
    twitter: { card: "summary_large_image", title, description, images: ["/lagisalpha-og.png"] },
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
