// Mocked smoke test for the Telegram bot: stubs global.fetch so no real Telegram or network call is
// made, drives the command handlers, and asserts the pushed message text. Chained into `npm test`.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.TELEGRAM_STATE_FILE = path.join(os.tmpdir(), `las-tg-test-${process.pid}.json`);
process.env.TELEGRAM_BOT_TOKEN = "test:token";

// ── canned lagisalpha API + captured Telegram sends ──────────────────────────────────────────────
const sent = []; // { chatId, text }
const REPLAY = {
  matches: [{
    code: "TST", teams: "Alpha v Beta", fid: "999", count: 2,
    signals: [
      { fid: "999", teams: "Alpha v Beta", side: "yes", entry: 0.5, fair: 0.6, tpTarget: 0.6, gapPp: 10, suggestedKellyF: 0.2, sizeAtFair: 1000, ts: 100, minute: 20, reached: true, clv: 0.05 },
      { fid: "999", teams: "Alpha v Beta", side: "no", entry: 0.4, fair: 0.5, tpTarget: 0.5, gapPp: 10, suggestedKellyF: 0.16, sizeAtFair: 0, ts: 200, minute: 70, reached: false, clv: -0.03 },
    ],
    goalWatch: [{ min: 25, ts: 150, team: "Alpha", pressure: 2 }],
    winnerHint: { fid: "999", team: 1, teamName: "Alpha", margin: 5.2, atMin: 30, ts: 180 },
  }],
};

let LIVE = { live: false, signals: [] }; // mutable canned response for /api/v1/divergences?status=live

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/bot")) {
    if (u.includes("/sendMessage")) { const b = JSON.parse(opts.body); sent.push({ chatId: b.chat_id, text: b.text }); }
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  }
  if (u.includes("/api/replay-signals")) return { ok: true, json: async () => REPLAY };
  if (u.includes("/api/v1/divergences")) return { ok: true, json: async () => LIVE };
  return { ok: false, status: 404, json: async () => ({}) };
};

const bot = await import("./telegram_bot.mjs");

let pass = 0, fail = 0;
const has = (needle, label) => {
  const hit = sent.some((m) => m.text.includes(needle));
  if (hit) { pass++; console.log("  ✓", label); } else { fail++; console.log("  ✗", label, `— no message contained "${needle}"`); }
};

// /start → help
await bot.handleCommand(1, "/start");
has("catch the lag", "/start welcomes");
has("/bankroll", "/start lists commands");

// /bankroll → paper mode
sent.length = 0;
await bot.handleCommand(1, "/bankroll 10000");
has("mode: paper", "/bankroll sets paper mode");

// /replay TST → signals, fills, exits, goal-watch, winner-hint
sent.length = 0;
await bot.handleCommand(1, "/replay TST");
has("Beta's side cheap @ 0.500", "replay shows the cheap-side (Beta) signal");
has("paper fill", "replay reports a paper fill");
has("converged, exit @ fair", "replay reports a converged exit");
has("goal watch: Alpha", "replay pushes the goal-watch alert");
has("likely winner: Alpha", "replay pushes the winner-hint");
has("ROI", "replay reports final ROI");

// alerts-only mode: no fills
sent.length = 0;
await bot.handleCommand(1, "/mode alerts");
sent.length = 0;
await bot.handleCommand(1, "/replay TST");
const noFills = !sent.some((m) => m.text.includes("paper fill"));
if (noFills) { pass++; console.log("  ✓", "alerts mode shows no paper fills"); } else { fail++; console.log("  ✗", "alerts mode leaked a paper fill"); }
has("Beta's side cheap @ 0.500", "alerts mode still shows the signal");

// ── live path: fill + episode dedupe + convergence settlement ────────────────────────────────────
await bot.handleCommand(2, "/bankroll 10000");
await bot.handleCommand(2, "/link las_testkey");
await bot.handleCommand(2, "/live");
const liveSig = { fid: "777", teams: "Gamma v Delta", side: "yes", entry: 0.70, fair: 0.76, tpTarget: 0.76, gapPp: 6, suggestedKellyF: 0.2, sizeAtFair: 0, ts: 1000 };
LIVE = { live: true, signals: [liveSig] };
sent.length = 0;
await bot.pushLiveTo(2);
has("Delta's side cheap @ 0.700", "live push shows the signal");
has("watching for convergence to fair", "live paper fill watches for convergence");

// same divergence republished with a NEW ts must NOT re-open (the old fid:ts dedupe bug)
LIVE = { live: true, signals: [{ ...liveSig, ts: 1060 }] };
sent.length = 0;
await bot.pushLiveTo(2);
const noDup = !sent.some((m) => m.text.includes("cheap @"));
if (noDup) { pass++; console.log("  ✓", "republished divergence (new ts) is not re-opened"); } else { fail++; console.log("  ✗", "republished divergence re-opened a position"); }

// pm reaches the entry-time fair → position closes at tpTarget
sent.length = 0;
await bot.settleOpenFor(2, { generatedAt: Date.now(), signals: [{ fid: "777", teams: "Gamma v Delta", fair: 0.755, pm: 0.762, diverged: false, side: "yes", ts: 2000 }] });
has("converged, exit @ fair 0.760", "convergence settles the open position at tpTarget");
const openLeft = bot.chat(2).session.trades.some((t) => t.status === "open");
if (!openLeft) { pass++; console.log("  ✓", "no open positions remain after convergence"); } else { fail++; console.log("  ✗", "position still open after convergence"); }

// gap heals (signal leaves the feed) → episode re-arms → a NEW divergence alerts again
LIVE = { live: true, signals: [] };
await bot.pushLiveTo(2);
LIVE = { live: true, signals: [{ ...liveSig, entry: 0.66, ts: 3000 }] };
sent.length = 0;
await bot.pushLiveTo(2);
has("Delta's side cheap @ 0.660", "healed episode re-arms for a fresh divergence");

try { fs.unlinkSync(process.env.TELEGRAM_STATE_FILE); } catch { /* ignore */ }
console.log(`\n${fail ? "❌" : "✅"} telegram: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
