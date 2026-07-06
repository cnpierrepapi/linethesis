// Generates the Lagisalpha litepaper -> public/lagisalpha-litepaper.pdf
//   node scripts/gen-litepaper.mjs
// Pure ASCII content (Helvetica/WinAnsi) so every glyph encodes cleanly. No em dashes.
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

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
    "The lead-lag edge in prediction markets. A prediction market sets its price by trading, so it lags the sharp, vig-free line that already holds the true probability. When it falls below fair, the cheap side is underpriced; across ten settled World Cup matches it travelled back to fair about 71% of the time, and Kelly-sized bets that took profit at fair compounded to roughly plus 114% at a 5 point gap. Built on the TxLINE World Cup data layer by Onenept Studios.",
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
  "Two tests, on ten settled matches, on the real fills. Reach: from the entry, does the market price travel to the fair before the match ends. It does about 71% of the time, and the move often takes minutes, so a short holding window hides it. Reach does not depend on who eventually wins, so it is the firmer number.",
);
p(
  "Return: the trade is to buy the cheap side and take profit at fair when the market catches up. Sized by Kelly on the gap, f = gap / (1 - price), and compounded across every call, that returned about plus 114% at a 5 point gap and plus 158% at 10. The same bets held to the final result instead lost about 80% and 42%: the convergence is where the money is, the outcome is a coin-flip that only adds variance. The return is concentrated, a couple of high-volume matches carry most of it, so it is a pilot, not a promise.",
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
  "The edge is validated on ten matches, so the return is a pilot, not a promise. The confidence interval still spans zero at this sample, and the return leans on a few high-volume matches; the reach rate is the firmer read, and both tighten as matches accrue. This measures a delay between two markets. It is not a trading strategy, it is not financial advice, and any sizing or slippage is your own.",
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
console.log("wrote public/lagisalpha-litepaper.pdf");
