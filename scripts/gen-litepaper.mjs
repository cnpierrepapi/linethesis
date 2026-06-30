// Generates the Agenthesis litepaper -> public/agenthesis-litepaper.pdf
//   node scripts/gen-litepaper.mjs
// Pure ASCII content (Helvetica/WinAnsi) so every glyph encodes cleanly.
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
const doc = new PDFDocument({
  size: "A4",
  margin: 56,
  info: { Title: "Agenthesis - Litepaper", Author: "Onenept Studios" },
});
doc.pipe(createWriteStream("public/agenthesis-litepaper.pdf"));

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
doc.fillColor(INK).font("Helvetica-Bold").fontSize(28).text("Agenthesis");
doc.fillColor(AMBER).font("Helvetica-Bold").fontSize(12).text("Litepaper - v0.1");
doc
  .fillColor(GREY)
  .font("Helvetica")
  .fontSize(9.5)
  .text(
    "Strategies from research, traded by autonomous agents, graded on closing-line value over a verifiable, on-chain-anchored feed. Built on the TxLINE World Cup data layer by Onenept Studios.",
    { lineGap: 2 },
  )
  .moveDown(0.5);
doc.strokeColor("#cfcfcf").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.4);

h1("1. Abstract");
p(
  "Sports and event betting is the largest unstructured prediction market on earth, yet it is treated as gambling rather than as a quantitative discipline, because outcomes are noisy: a good bet can lose and a bad bet can win, so over any human-scale sample skill is statistically indistinguishable from luck. Agenthesis reframes the activity. We take published results about market inefficiencies, render each one as a runnable strategy, let autonomous agents trade them over a live de-margined price feed, and grade every decision on closing-line value (CLV) rather than on whether the bet won. CLV settles from odds alone, so skill is measurable on every single decision instead of once per outcome.",
);

h1("2. The problem: betting hides skill");
p(
  "The bookmaker's margin guarantees the median participant loses, and the variance of outcomes guarantees the few who win cannot prove they did so on purpose. A bettor who is genuinely 3% sharper than the closing line still spends long stretches underwater. Conventional platforms reward the appearance of winning (the lucky streak, the parlay screenshot) and have no instrument for the thing that actually compounds: consistently beating the price the market settles at. If you cannot measure skill cleanly, you cannot teach it, rank it, or build a market around it.",
);

h1("3. The idea: a strategy is a research paper");
p(
  "Every strategy on the platform is a published market-inefficiency result rendered as code. A paper maps to one edge kind in the engine plus a calibrated set of default levers (the parameter variant, the edge conditioned on a specific match context). Steam-chasing, post-event overreaction, and micro-drift quoting each correspond to a documented effect with an entry rule, a sizing rule, and a settlement rule. You do not deploy a black box; you deploy a citation, and an agent's behaviour is fully explained by the papers it carries and the levers it was tuned with.",
);

h1("4. The data layer: TxLINE");
p(
  "Agents trade over TxLINE, the World Cup data layer, which publishes a de-margined (no-vig) book. Because the vig is removed, each side's price is a clean implied probability: for a side priced 'price', fair probability p = 1 / (price/1000) with decimal odds O = 1/p. That clean book lets the engine reason in probability units instead of fighting the margin. The feed is anchored on Solana and access is minted by a real on-chain subscribe transaction. The captured streams the product replays ship inside the repository, so the system is self-contained and every result is reproducible.",
);

p(
  "TxLINE endpoints used (access via a server-held token: guest JWT + an on-chain Solana subscribe transaction -> apiToken, sent as Authorization: Bearer and X-Api-Token; the subscribe tx is the on-chain proof of access):",
);
li("GET /api/fixtures/snapshot - live fixtures, team names, kickoff times.");
li("GET /api/odds/stream - live de-margined (no-vig) odds, SSE; the core signal input.");
li("GET /api/scores/stream - live scores and match events (goals / red cards), SSE.");
li("GET /api/odds/snapshot/{fixtureId} - current de-margined book, polled for the real-time panel.");
li("GET /api/scores/updates/{fixtureId} - full kickoff-to-FT sequence, used to capture replays.");
doc.moveDown(0.2);

h1("5. The edge engine");
p("The EdgeEngine ingests odds and score frames and emits typed, scored edges of three kinds:");
li("steam - a sharp, fast move in fair probability that tends to continue rather than revert.");
li("overreaction - a post-event overshoot (a goal, a card) that the market corrects.");
li("quote - a micro-drift baseline that keeps an agent active between the louder signals.");
doc.moveDown(0.2);
p(
  "Each edge carries a magnitude in probability units and a conviction tier. The engine is an event emitter with tunable thresholds and windows; downstream, nothing needs to know how an edge was found, only what it is worth.",
);

h1("6. The decision core and CLV");
p(
  "The decision core is a pure mapping from an edge plus a lever set to a sized bet. An edge of magnitude m implies an expected captured move e_hat = k*m, an expected return e = e_hat / p_entry, and a Kelly fraction f* = e / b, applied as fractional Kelly and capped so no single bet over-concentrates the bankroll.",
);
p(
  "Settlement is closing-line value: back r = (p_close - p_entry) / p_entry. CLV measures whether you entered at a better price than the market closed at. Critically it resolves from odds alone (the match outcome is never needed), so every decision is graded immediately and the skill signal is not buried under win/loss variance. This is the heart of the platform: a fast-settling, low-variance metric for being right about price.",
);

h1("7. Agents and the build loop");
p(
  "An agent is a bankroll plus an ordered list of strategies. It runs its base tuning plus one lever set per attached paper; for each incoming edge, the first strategy that greenlights it takes the bet. There is no agent-versus-agent mechanic and no human override mid-match. In the builder you pick a paper, tune its levers (conviction, stake mode, Kelly fraction, phase, minute gates, odds band, concurrency, follow-or-fade), and deploy to the runner. The leaderboard ranks agents on realized performance.",
);

h1("8. Proof and verifiability");
p(
  "Trust in a trading claim comes from being able to check it. Agenthesis exposes a one-page audit trail with the full execution ledger (300 trades across ten matches) where each trade carries a proofHash tying it to the exact feed frame it was taken on. The Solana touchpoint is proof of access: a real on-chain subscribe transaction, signed with a wallet, mints the right to the TxLINE stream; that signature is a public, verifiable hash anyone can open on Solana Explorer. The same proofHash is emitted by the operator API, so a published edge and an executed trade reconcile against one frame ledger.",
);

h1("9. The economy");
p(
  "Every agent starts from the same fake-USD float, so the leaderboard measures strategy, not deposit size. AGI is the in-app token and it buys one thing: access to more research papers (about 1,000 AGI per paper). It is explicitly never bankroll and never prize odds; you cannot pay to trade bigger or to improve your standing. Rewards run on an operator-funded model: a daily pool (USDC plus AGI) is posted by the operator and split across competing agents by skill. The platform never sells bankroll and never sells a share of the pool. The separation between what is purchasable (research) and what is earned (standing and rewards) is the integrity guarantee.",
);

h1("10. Integration: SDK and Operator API");
p(
  "Two consumer surfaces sit on the same quant core. A professional trading desk embeds the SDK (EdgeEngine + decision core + CLV scoring) in its own stack, bringing its own feed and its own execution; it is the exact pure, deterministic, unit-tested code the product runs. A market operator instead consumes the HTTP API: an authenticated, versioned poll endpoint (GET /api/v1/edges) returning typed, scored edges per fixture, each with a proofHash, plus a webhook contract that pushes the identical Edge object from a persistent worker. The honest limit, kept in the pitch: this is a signal, scoring and verification layer, not an execution venue, and a 24/7 deployment runs the engine as a persistent worker (serverless throttles it).",
);

h1("11. Roadmap");
li("Expand the paper catalog and let agents carry deeper multi-paper stacks.");
li("Live, persistent agents on a continuous TxLINE worker beyond the captured-replay demo.");
li("Richer on-chain settlement: per-trade proofs anchored to the feed's Merkle roots.");
li("A skill profile per operator: CLV distribution, calibration, and persistence.");
doc.moveDown(0.2);

h1("12. Responsible play");
p(
  "Agenthesis is a research and skill-measurement platform built on captured and de-margined data. Agents trade a fake-USD float; the token buys research, not betting power. CLV is a measure of pricing skill, not a promise of profit, and past performance over a replay does not guarantee future results on a live book. Nothing here is financial advice.",
);

doc
  .moveDown(1)
  .fillColor("#999999")
  .fontSize(8)
  .text(
    "Agenthesis - Onenept Studios - built on the TxLINE / TxODDS World Cup data layer. This document is informational, not an offer of securities or a solicitation to gamble.",
    { align: "center" },
  );

doc.end();
console.log("wrote public/agenthesis-litepaper.pdf");
