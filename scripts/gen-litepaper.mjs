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
doc.fillColor(AMBER).font("Helvetica-Bold").fontSize(12).text("Litepaper - v1.0");
doc
  .fillColor(GREY)
  .font("Helvetica")
  .fontSize(9.5)
  .text(
    "A read-only line-integrity oracle: it benchmarks a betting operator's prices against TxLINE's vig-free consensus, warns the instant a line is stale enough to get picked off, and settles every warning on-chain. You keep the book; it never touches it. Built on the TxLINE World Cup data layer by Onenept Studios.",
    { lineGap: 2 },
  )
  .moveDown(0.5);
doc.strokeColor("#cfcfcf").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.4);

h1("1. Abstract");
p(
  "In-play betting markets move fast, and the operators who post prices lose money at one specific moment: when their line is stale. The consensus re-prices on new information (a goal, a red card, a surge of danger) and a book that has not caught up is lifted at the old number. Agenthesis is a read-only agent that watches that gap. It benchmarks a watched price against TxLINE's de-margined (no-vig) consensus, classifies every reference-line move as a clean move to FOLLOW or an overreaction to FADE, warns before the pickoff, and grades every call against on-chain ground truth. It is not a bookmaker, a market-maker, or a managed-trading service; it is the neutral, provable benchmark that sits beside the book.",
);

h1("2. The problem: the stale line gets picked off");
p(
  "Adverse selection is the structural cost of quoting a price. Sharp money (bots, syndicates, faster books) exists to lift a mispriced line, and in-play is where the mispricing lives: the seconds around a goal, when the fair price has jumped and a lagging in-play number has not. The books most respected by sharps win on speed of price discovery; everyone slower leaks margin to stale-line abuse. Prediction-market makers face the identical phenomenon under the name loss-versus-rebalancing, where static automated prices become stale as information arrives and are picked off by better-informed flow. One phenomenon, two buyers. The question is the same: is my price stale right now, and in which direction am I exposed?",
);

h1("3. The idea: an independent, read-only benchmark");
p(
  "Agenthesis answers that question and stops. It emits a signal (a recommendation with a confidence and a pickoff-risk) and the operator's own rule-set decides whether to widen a margin, cut a limit, or suspend a market. We compute the decision; the book takes the action. That boundary is the entire product: it is why an unknown vendor's agent is something a compliance team will actually deploy, and why the tool carries no wagering or securities surface. The reference is not our opinion; it is TxLINE's de-margined consensus, so the benchmark is neutral by construction. Nothing about the operator's pricing model is required, replaced, or exposed.",
);

h1("4. The data layer: TxLINE");
p(
  "The reference is TxLINE, the World Cup data layer, which publishes a de-margined (no-vig) book. Because the vig is removed, each side's price is a clean implied probability: pRef = 1 / (price/1000). Two goals-settled market families stream in the demargined feed (Asian-handicap goals and over/under goals) and both resolve from the two on-chain goal counts, so every signal is settleable and verifiable. A granular momentum tape rides alongside the scores stream (danger and high-danger possession, goal-imminent flags) that fires seconds before the line jumps. The feed is anchored on Solana and access is minted by a real on-chain subscribe transaction, so the reference's provenance is publicly verifiable.",
);

p("TxLINE endpoints used (server-held token: guest JWT + an on-chain Solana subscribe transaction -> apiToken, sent as Authorization: Bearer and X-Api-Token):");
li("GET /api/odds/stream - live de-margined (no-vig) odds, SSE; the core reference input.");
li("GET /api/scores/stream - live scores, match events, and the momentum tape, SSE.");
li("GET /api/scores/snapshot/{fixtureId} - final goals for outcome settlement.");
li("GET /api/scores/stat-validation - validateStat Merkle proof vs the on-chain daily-scores root.");
li("GET /api/fixtures/snapshot - live fixtures, team names, kickoff times.");
doc.moveDown(0.2);

h1("5. The signal engine");
p("The engine ingests odds and score frames and classifies each reference-line move, grounded in the market-microstructure literature:");
li("steam -> follow. The market prices real news efficiently (Croxson & Reade). A clean move is true; a book that follows late is exposed. Tighten toward the reference.");
li("overreaction -> hold / fade. A surprising goal overshoots and reverts within minutes (Choi & Hui; De Bondt-Thaler). Do not chase it; when confident, lean against it.");
li("pre-goal warning -> suspend. The momentum tape flags a goal-imminent state before the line moves - the earliest notice that an in-play price is about to go stale.");
doc.moveDown(0.2);
p(
  "Overreaction firing is sharpened by surprise: how far the goal moved the scoreline probability from its pre-event value. Signals are scoped to the two on-chain-settleable goals markets, so nothing is emitted that cannot later be proven.",
);

h1("6. Grading: CLV and on-chain self-scoring");
p(
  "Every signal is graded two ways. The skill leg is closing-line value: did the fair line keep moving toward the call to its closing value, measured over the reversion window? CLV resolves from odds alone, so it settles fast and with low variance. On our own captures, overreaction/fade calls are consistently CLV-positive while steam/follow, as the efficiency literature predicts, carries no standalone edge.",
);
p(
  "The outcome leg settles against the final goals on the TxLINE daily-scores Merkle root via a validateStat proof. The result is a public calibration ledger where the agent grades itself on-chain: hit-rate and average CLV per signal type, per action, with per-match breadth and single-match concentration surfaced so a headline cannot hide behind one lucky match.",
);

h1("7. The read-only boundary");
p(
  "Agenthesis places no bet, moves no price, and holds no funds. The action is always the operator's. The Control Room makes the boundary visible: each signal, the gap between a watched book and the reference (the pickoff surface), and the action the operator's policy chose (widen, cut, or suspend). The policy is a rule-set the operator controls; we report which rule fired. This is also the answer to 'what if the agent is wrong?': it is wrong a knowable fraction of the time, and the design makes wrong cheap. Recommendations are confidence-weighted, the default under uncertainty is the safe action, and the operator sets the exposure envelope. It is a positive-expectation risk policy, not a must-be-right prediction.",
);

h1("8. Why it's adoptable: the independent referee");
p(
  "Incumbents already sell repricing: managed trading services and dynamic-pricing engines that adjust an operator's odds in real time. Agenthesis deliberately does not compete there. That lane is both the most contested and the one an operator is least willing to hand a startup, because it means giving up control of the book. The incumbents' structural weakness is that they are player and referee at once: they price your book, they may share your P&L, and they sell you the integrity feed, an unauditable black box. Agenthesis is the neutral referee they cannot be: no managed trading, no shared P&L, no conflict; read-only; and uniquely provable, because the track record settles on-chain. Verify-before-trust is the antidote to the black-box problem, and it is the one thing a non-anchored feed cannot offer.",
);

h1("9. Proof and verifiability");
p(
  "Every signal carries a proofHash tying it to the exact TxLINE frame it was derived from, reconcilable against a downloadable frame ledger (join on fixture and frame timestamp to confirm our reference matches yours). The Solana touchpoint is proof of access: a real on-chain subscribe transaction, signed with a wallet, mints the right to the TxLINE stream; that signature is a public, verifiable hash anyone can open on Solana Explorer. Outcome settlement anchors to the same chain via the daily-scores Merkle root.",
);

h1("10. The SDK and Operator API");
p(
  "Two surfaces sit on the same core. A desk embeds the SDK (the classifier, the detector, and the CLV grader) in its own stack: pure, deterministic, unit-tested code with no I/O and no clock reads, safe to place next to a live book. An operator instead consumes the HTTP API: authenticated, versioned endpoints for the signals (GET /api/v1/signals), the calibration ledger (GET /api/v1/calibration), and the read-only boundary timeline (GET /api/v1/control-room), each signal carrying a proofHash, plus a webhook that pushes the identical signal from a persistent worker.",
);

h1("11. Infrastructure: why this needs TxOdds");
p(
  "A production line-integrity signal is a latency game. The warning is only worth money if it beats the pickoff by milliseconds, which requires direct, co-located access to the TxLINE feed and low-latency infrastructure that only TxOdds can provision. The deterministic poll and replay in this build prove the logic on real captured frames; a live deployment is a different class of system. A win here is therefore the start of a continuing partnership (direct-feed and infrastructure support), not a finished artifact. The value compounds with every logged match, and the moat (an on-chain-provable calibration record) is one no non-anchored competitor can reproduce.",
);

h1("12. Responsible use");
p(
  "Agenthesis is a read-only research and risk-analytics layer built on de-margined data. It places no wagers, holds no funds, and moves no prices; the operator's rule-set takes every action. CLV is a measure of pricing skill, not a promise of profit, and calibration over a replay does not guarantee live results. Nothing here is financial advice.",
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
