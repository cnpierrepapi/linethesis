// Generates the Linescout litepaper -> public/linescout-litepaper.pdf
//   node scripts/gen-litepaper.mjs
// Pure ASCII content (Helvetica/WinAnsi) so every glyph encodes cleanly. No em dashes.
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
const doc = new PDFDocument({
  size: "A4",
  margin: 56,
  info: { Title: "Linescout - Litepaper", Author: "Onenept Studios" },
});
doc.pipe(createWriteStream("public/linescout-litepaper.pdf"));

const INK = "#0a0c0f";
const AMBER = "#9a6a00";
const GREY = "#3c434c";

const h1 = (t) =>
  doc.moveDown(0.5).fillColor(INK).font("Helvetica-Bold").fontSize(13).text(t).moveDown(0.25);
const p = (t) =>
  doc.fillColor(GREY).font("Helvetica").fontSize(10).text(t, { lineGap: 2 }).moveDown(0.3);
const li = (t) =>
  doc.fillColor(GREY).font("Helvetica").fontSize(10).text("- " + t, { indent: 10, lineGap: 2 });

// Title block
doc.fillColor(INK).font("Helvetica-Bold").fontSize(28).text("Linescout");
doc.fillColor(AMBER).font("Helvetica-Bold").fontSize(12).text("Litepaper - v1.0");
doc
  .fillColor(GREY)
  .font("Helvetica")
  .fontSize(9.5)
  .text(
    "Measuring the delay in prediction market prices. Their in-play prices lag the sharp, vig-free consensus. TxLINE publishes that consensus as a de-margined fair probability. Linescout puts the two side by side and measures the gap on real on-chain fills. Built on the TxLINE World Cup data layer by Onenept Studios.",
    { lineGap: 2 },
  )
  .moveDown(0.5);
doc.strokeColor("#cfcfcf").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.4);

h1("1. Abstract");
p(
  "A prediction market sets a price by trading, so its price only moves when someone trades. New information arrives faster than that: a goal, a red card, a wave of pressure. In the seconds around a goal the prediction market price sits behind the true probability, and the underpriced side gets taken before the market catches up. TxLINE removes the bookmaker margin from a live odds feed, so every price it streams is already a clean fair probability. That gives a reference the prediction market book can be measured against, tick for tick.",
);
p(
  "Linescout detects the divergence and then answers two questions on real fills. First: does the prediction market price travel back to the TxLINE fair before the match ends, that is, does the delay close. Across eight matches it closes about 73% of the time. Second: if you buy the cheap side and hold it to resolution, is that a positive-edge trade. The pooled edge is about plus 18% at a 5 point gap, and it grows as the gap grows. The sample is small, so we report a confidence interval that at eight matches still spans zero: this is a pilot, not a proven return. We do not size or trade for you. Sizing, and any price you move by taking size, is your own cost, not part of the signal.",
);

h1("2. The problem: the book lags the sharp price");
p(
  "Every market that quotes a price pays a cost called adverse selection: better informed traders lift a stale price before it updates. In-play sport is where that cost lives, because the fair probability jumps on a goal and a price set by trading needs time to follow. Prediction market makers know the same problem by another name, loss versus rebalancing, where a resting price goes stale as information arrives and is picked off by faster flow.",
);
p(
  "Prediction markets carry real money and deep sports volume, but have no real time, vig-free reference to settle their prices against. So the lag is not noise; it is a repeatable window where one side of the book is cheap. The whole question is simple: right now, is the prediction market price behind the true probability, and on which side.",
);

h1("3. The signal: a measured divergence");
p(
  "Linescout works in probability space. TxLINE's de-margined 1X2 market gives a fair probability that a team wins, summing to one across the three outcomes. A prediction market's moneyline gives the market's probability of the same event. Because both are the probability that a team wins, a difference between them is a real disagreement about price, not a units mismatch.",
);
p(
  "When the fair probability sits above the prediction market price by more than a threshold, the cheap side is underpriced and we mark an entry: which side, how many points off fair, and how much size sat at the stale price. We use a threshold with hysteresis, so one dislocation is one entry, not a burst. That is the entire signal: a divergence, on the cheap side, at a real price. What a trader does with it comes next, and is theirs.",
);

h1("4. The data: TxLINE fair and prediction market fills");
p(
  "Everything rests on TxLINE's de-vig odds stream. The bookmaker margin is stripped out, so each price is a clean implied probability: for a price p, the fair probability is 1 / (p/1000), de-margined across the outcomes. Remove the vig and a price move stops being noise and becomes a measurable shift in the true probability. No ordinary odds feed exposes this, which is why the product can only run on TxLINE. The feed is anchored on Solana, and access is minted by a real on-chain subscribe transaction, so the reference's provenance is public.",
);
p(
  "The other side of the measurement is the prediction market itself. We read the market's fills straight from Polygon: the on-chain order fill logs, decoded to a price and a size for each trade. On one match, Paraguay versus France, that is about 24,000 in-play fills worth 8.6 million dollars. Both legs are public: the fair line is TxLINE's Solana-anchored feed, and the book is the prediction market's trades on Polygon.",
);
p("TxLINE endpoints used (server-held token: guest JWT plus an on-chain Solana subscribe transaction gives an apiToken, sent as Authorization Bearer and X-Api-Token):");
li("GET /api/odds/snapshot/{fixtureId}: live de-margined 1X2 fair, the core reference.");
li("GET /api/scores/snapshot/{fixtureId}: final goals for outcome settlement.");
li("GET /api/scores/stat-validation: validateStat Merkle proof vs the on-chain daily-scores root.");
li("GET /api/fixtures/snapshot: live fixtures, team names, kickoff times.");
li("Polygon OrderFilled logs: prediction market fills, decoded on-chain (the book side).");
doc.moveDown(0.2);

h1("5. Test one: does the delay close");
p(
  "The first test is the pure signal: from the moment we mark the divergence, does the prediction market price ever travel to the TxLINE fair before the match ends. There is no time box; you hold until the price gets there. This is the take-profit view: if the price reaches the fair, the gap you entered on has closed, whether or not the team ends up winning.",
);
p(
  "On the eight backfilled matches, the price reaches the TxLINE fair about 73% of the time at a 5 point gap, and about 74% at a 10 point gap. Convergence is often slow, minutes rather than seconds, which is exactly why a short holding window hides it. Reach is the firmest number we have, because it does not depend on who eventually wins.",
);

h1("6. Test two: does the cheap side pay");
p(
  "The second test settles at resolution. Buy the cheap side at the prediction market price, hold it to the final result, and the side pays one dollar per share if it wins and zero if it does not. If you consistently pay less than the side is worth, that is edge, and it shows up at settlement, not on the price path. Pooled across the matches, the cheap side's realized win rate minus the price paid is about plus 18% at a 5 point gap and about plus 32% at a 10 point gap. The edge grows with the size of the divergence, which is the right direction: a bigger mispricing pays more.",
);
p(
  "We are honest about the sample. We resample at the match level, since every entry in a match shares one result, and the 90% confidence interval on the edge still spans zero at eight matches. So the point estimate is positive and consistent, but it is a pilot, not a proven return. The interval tightens as matches accrue, and new matches settle in automatically.",
);

h1("7. Available size, and whose job sizing is");
p(
  "For each divergence we also report the size available: the dollars that actually traded at the stale price during the window. That is a floor on what was there to take. Pooled, that is several million dollars of fills sitting off the fair. We report it so a reader can judge scale, not so we can promise a fill.",
);
p(
  "What we do not do is grade the signal on a trader's profit and loss. If someone puts in too much and moves the price against themselves, that is slippage: a self inflicted execution cost, and it is not a fault in the signal. The product tells you the price is cheap and by how much, and how much sat there. How much to take is your decision, and your risk.",
);

h1("8. Proof: both sides on-chain");
p(
  "Every fill in the ledger is a Polygon transaction you can open in a block explorer. Every match outcome settles against TxLINE's on-chain daily-scores root, so the win or loss the edge is measured against is not our word; it is the same goal count anyone can verify. The Solana touchpoint is proof of access: a real subscribe transaction, signed with a wallet, mints the right to the TxLINE stream, and that signature is a public hash on Solana Explorer. The proof page publishes the full ledger: the pickoff surface per match with tx hashes, and the graded signal with its reach rate, aggregate edge, and confidence interval.",
);

h1("9. The live detector");
p(
  "The historical tests prove the signal on settled matches. The live detector runs it in real time: it polls TxLINE's live 1X2 fair against the current prediction market book every minute, and flags a divergence the instant the book lags past the threshold. During a match the edge page shows it live; between matches it sits idle. A live product is a latency game, since a divergence is only worth acting on while it is open, so a production version needs direct, low-latency access to the feeds.",
);

h1("10. Why it runs on TxLINE");
p(
  "The signal exists only because TxLINE removes the vig. Without a de-margined fair, a gap between two prices is just two prices; with it, the gap is a distance from the true probability, and that distance is what a sharp gets paid to close. TxLINE also anchors both the odds and the scores on chain, which is what lets the whole measurement be verified rather than believed.",
);
p(
  "The relationship runs both ways. Any market or book already taking the TxLINE feed can use Linescout to see where its prices lag, with no new pricing model and no change to its book, so Linescout is a reason to be on TxLINE. Continued support means two things: low-latency access so a live signal beats the pickoff, and more of the de-margined book beyond goals, such as cards, corners, and match result, so we can measure every line, not only the goals markets.",
);

h1("11. Responsible use");
p(
  "Linescout is a read-only research and measurement layer built on de-margined data. It places no wagers, holds no funds, and moves no prices. It measures a delay in one market's prices against another market's fair; it is not a trading strategy and not financial advice. The historical edge is a pilot over a small sample, calibration does not guarantee live results, and any sizing or execution cost is the reader's own.",
);

doc
  .moveDown(1)
  .fillColor("#999999")
  .fontSize(8)
  .text(
    "Linescout, Onenept Studios, built on the TxLINE / TxODDS World Cup data layer. This document is informational, not an offer of securities or a solicitation to gamble.",
    { align: "center" },
  );

doc.end();
console.log("wrote public/linescout-litepaper.pdf");
