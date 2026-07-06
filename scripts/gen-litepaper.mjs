// Generates the Lagisalpha litepaper -> public/lagisalpha-litepaper.pdf
//   node scripts/gen-litepaper.mjs
// Pulls the live headline numbers (reach, Kelly ROI, match count) from the pooled blob so the PDF
// matches the site; falls back to last-known values if the blob is unavailable. Runs in prebuild, so
// every deploy ships a current PDF. Pure ASCII (Helvetica/WinAnsi), no em dashes.
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const numWord = (n) => WORDS[n] ?? String(n);
const BLOB = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co") +
  "/storage/v1/object/public/desk-archives/pickoffs.json";

async function getStats() {
  const fb = { reachPct: 71, roiPct: 114, roi10Pct: 158, resLoss: 80, res10Loss: 42, matchCount: 10, matchWord: "ten" };
  try {
    const d = await (await fetch(BLOB)).json();
    const p5 = d?.pooled?.["5"], p10 = d?.pooled?.["10"], mc = d?.matchCount ?? d?.matches?.length ?? 0;
    if (!p5 || !p5.n) return { ...fb, matchCount: mc || fb.matchCount, matchWord: numWord(mc || fb.matchCount) };
    return {
      reachPct: Math.round(p5.reachRate * 100),
      roiPct: Math.round(p5.kellyRoi * 100),
      roi10Pct: p10 ? Math.round(p10.kellyRoi * 100) : fb.roi10Pct,
      resLoss: Math.abs(Math.round(p5.kellyRoiRes * 100)),
      res10Loss: p10 ? Math.abs(Math.round((p10.kellyRoiRes ?? 0) * 100)) : fb.res10Loss,
      matchCount: mc, matchWord: numWord(mc),
    };
  } catch {
    return fb;
  }
}

const s = await getStats();

mkdirSync("public", { recursive: true });
const doc = new PDFDocument({
  size: "A4",
  margin: 56,
  info: { Title: "Lagisalpha - Litepaper", Author: "Onenept Studios" },
});
doc.pipe(createWriteStream("public/lagisalpha-litepaper.pdf"));

const INK = "#0a0c0f";
const AMBER = "#9a6a00";
const GREY = "#3c434c";

const h1 = (t) =>
  doc.moveDown(0.5).fillColor(INK).font("Helvetica-Bold").fontSize(13).text(t).moveDown(0.25);
const p = (t) =>
  doc.fillColor(GREY).font("Helvetica").fontSize(10).text(t, { lineGap: 2 }).moveDown(0.3);

// Title block
doc.fillColor(INK).font("Helvetica-Bold").fontSize(28).text("Lagisalpha");
doc.fillColor(AMBER).font("Helvetica-Bold").fontSize(12).text("Litepaper - v1.1");
doc
  .fillColor(GREY)
  .font("Helvetica")
  .fontSize(9.5)
  .text(
    `The lead-lag edge in prediction markets. A prediction market sets its price by trading, so it lags the sharp, vig-free line that already holds the true probability. When it falls below fair, the cheap side is underpriced; across ${s.matchWord} settled World Cup matches it travelled back to fair about ${s.reachPct}% of the time, and Kelly-sized bets that took profit at fair compounded to roughly plus ${s.roiPct}% at a 5 point gap. Built on the TxLINE World Cup data layer by Onenept Studios.`,
    { lineGap: 2 },
  )
  .moveDown(0.5);
doc.strokeColor("#cfcfcf").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.4);

h1("1. The claim");
p(
  "A prediction market moves its price only when someone trades. News moves faster. So in the seconds after a goal the market sits behind the true probability, and one side is cheap. That lag is the edge: measurable, repeatable, and gone the moment the market catches up.",
);

h1("2. Why the edge exists");
p(
  "Two facts. The market is slow: it reprices by trading, not by knowing. The reference is fast: TxLINE strips the bookmaker margin from a live odds feed, so its price is the true probability, and it moves the instant news lands. The gap between them is how far the market is behind, and which way it is about to move.",
);

h1("3. The signal: a divergence");
p(
  "We work in probability space. TxLINE's de-vig 1X2 gives the fair probability a team wins. The market's moneyline gives its own probability of the same event. When the fair sits above the market price by more than a threshold, the cheap side is underpriced, and we mark an entry: which side, how far off fair, and how much size you could later exit into at fair. One dislocation is one entry, not a burst.",
);

h1("4. The proof: does it close, does it pay");
p(
  `Two tests, on ${s.matchWord} settled matches, on the real fills. Reach: from the entry, does the market price travel to the fair before the match ends. It does about ${s.reachPct}% of the time, and the move often takes minutes, so a short holding window hides it. Reach does not depend on who eventually wins, so it is the firmer number.`,
);
p(
  `Return: the trade is to buy the cheap side and take profit at fair when the market catches up. Sized by Kelly on the gap, f = gap / (1 - price), and compounded across every call, that returned about plus ${s.roiPct}% at a 5 point gap and plus ${s.roi10Pct}% at 10. The same bets held to the final result instead lost about ${s.resLoss}% and ${s.res10Loss}%: the convergence is where the money is, the outcome is a coin-flip that only adds variance. The return is concentrated, a couple of high-volume matches carry most of it, so it is a pilot, not a promise.`,
);

h1("5. The data, verifiable both sides");
p(
  "The fair is TxLINE's World Cup feed: odds and scores anchored on Solana, access minted by a real on-chain subscribe transaction. The market side is real fills read straight from Polygon, decoded to a price and a size per trade. Both legs are public: open any fill as a Polygon transaction, settle any outcome on TxLINE's on-chain scores, and recompute the edge yourself. Nothing here is asserted.",
);
p("TxLINE endpoints used (server-held token: guest JWT plus an on-chain Solana subscribe transaction gives an apiToken, sent as Authorization Bearer and X-Api-Token):");
p("  GET /api/odds/snapshot/{fixtureId}: live de-margined 1X2 fair, the core reference.");
p("  GET /api/scores/snapshot/{fixtureId}: final goals for outcome settlement.");
p("  GET /api/scores/stat-validation: validateStat Merkle proof vs the on-chain daily-scores root.");
p("  GET /api/fixtures/snapshot: live fixtures, team names, kickoff times.");
p("  Polygon OrderFilled logs: the prediction market fills, decoded on-chain (the market side).");

h1("6. How to trade it");
p(
  "Catch the divergence live, take the cheap side at the market price, and take profit at TxLINE fair when the market catches up. Size each bet by Kelly on the gap, so a bigger dislocation gets a bigger bet and you never over-bet into ruin. Holding to the final result instead is a losing trade on this data, so the play is the take-profit, not the settlement.",
);
p(
  "The size we show is the liquidity you could have exited into at fair or better, counted only when the price actually reached fair; when it never does, the size is zero, because you could never have exited there. How much you take, and any price you move by taking it, is your own execution cost. It is not part of the signal.",
);

h1("7. What we do not claim");
p(
  `The edge is validated on ${s.matchWord} matches, so the return is a pilot, not a promise. The confidence interval still spans zero at this sample, and the return leans on a few high-volume matches; the reach rate is the firmer read, and both tighten as matches accrue. This measures a delay between two markets. It is not a trading strategy, it is not financial advice, and any sizing or slippage is your own.`,
);

doc
  .moveDown(1)
  .fillColor("#999999")
  .fontSize(8)
  .text(
    "Lagisalpha, Onenept Studios, built on the TxLINE / TxODDS World Cup data layer. This document is informational, not an offer of securities or a solicitation to gamble.",
    { align: "center" },
  );

doc.end();
console.log(`wrote public/lagisalpha-litepaper.pdf (reach ${s.reachPct}%, roi +${s.roiPct}%, ${s.matchCount} matches)`);
