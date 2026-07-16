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
    code: "TST", teams: "Alpha v Beta", fid: "999", count: 2, kick: 0, ft: 300,
    signals: [
      // reached: exits LATER (t=250) than the second entry (t=200) → proves real-clock concurrency
      { fid: "999", teams: "Alpha v Beta", side: "yes", entry: 0.5, fair: 0.6, tpTarget: 0.6, gapPp: 10, suggestedKellyF: 0.2, sizeAtFair: 1000, ts: 100, minute: 20, reached: true, clv: 0.05,
        entryFill: { t: 100, price: 0.5, tx: "0xentry1" }, exitFill: { t: 250, price: 0.61, tx: "0xexit1", usd: 500, gapPp: 1 } },
      // no reach → marks out at the match close (ft=300), no exit fill
      { fid: "999", teams: "Alpha v Beta", side: "no", entry: 0.4, fair: 0.5, tpTarget: 0.5, gapPp: 10, suggestedKellyF: 0.16, sizeAtFair: 0, ts: 200, minute: 70, reached: false, clv: -0.03,
        entryFill: { t: 200, price: 0.4, tx: "0xentry2" }, exitFill: null },
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
has("entry fill @ 0.500 · verify https://polygonscan.com/tx/0xentry1", "entry notif carries the entry-fill polygonscan link");
has("converged, exit @ fair", "replay reports a converged exit");
has("exit fill @ 0.610 (+1pp past fair) · verify https://polygonscan.com/tx/0xexit1", "exit notif carries the ≥fair exit-fill polygonscan link");
has("no reach, marked out @ close", "no-reach signal marks out at the close");
// entry and exit are SEPARATE messages (one entry notif, one exit notif), not one combined line
{ const entryMsg = sent.find((m) => m.text.includes("entry fill @ 0.500")); const exitMsg = sent.find((m) => m.text.includes("exit fill @ 0.610"));
  if (entryMsg && exitMsg && entryMsg !== exitMsg) { pass++; console.log("  ✓", "entry and exit are two separate notifications"); } else { fail++; console.log("  ✗", "entry/exit not split into two messages"); } }
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
const liveSig = { fid: "777", teams: "Gamma v Delta", side: "yes", entry: 0.70, fair: 0.76, tpTarget: 0.76, gapPp: 6, suggestedKellyF: 0.2, sizeAtFair: 0, ts: 1000,
  entryFill: { t: 1, price: 0.70, tx: "0xliveentry" } };
LIVE = { live: true, signals: [liveSig] };
sent.length = 0;
await bot.pushLiveTo(2);
has("Delta's side cheap @ 0.700", "live push shows the signal");
has("entry fill @ 0.700 · verify https://polygonscan.com/tx/0xliveentry", "live push carries the real entry-fill link");
has("watching for convergence to fair", "live paper fill watches for convergence");

// same divergence republished with a NEW ts must NOT re-open (the old fid:ts dedupe bug)
LIVE = { live: true, signals: [{ ...liveSig, ts: 1060 }] };
sent.length = 0;
await bot.pushLiveTo(2);
const noDup = !sent.some((m) => m.text.includes("cheap @"));
if (noDup) { pass++; console.log("  ✓", "republished divergence (new ts) is not re-opened"); } else { fail++; console.log("  ✗", "republished divergence re-opened a position"); }

// a quote-based signal (no real entry fill) must NOT alert or open anything: an entry fire is a fill
// (777 stays in the feed so its episode does not re-arm mid-test)
const quoteSig = { fid: "555", teams: "Eta v Theta", side: "yes", entry: 0.30, fair: 0.40, tpTarget: 0.40, gapPp: 10, suggestedKellyF: 0.14, sizeAtFair: 0, ts: 1090 };
LIVE = { live: true, signals: [{ ...liveSig, ts: 1080 }, quoteSig] };
sent.length = 0;
await bot.pushLiveTo(2);
const noQuote = !sent.some((m) => m.text.includes("Theta"));
if (noQuote) { pass++; console.log("  ✓", "quote signal without an entry fill is not alerted"); } else { fail++; console.log("  ✗", "quote signal without an entry fill leaked an alert"); }

// a SECOND signal while the first is open must Kelly-size on the FREE balance, not the start bankroll,
// AND respect the Kelly cap: free = 10000 - 2000 = 8000; suggestedKellyF 0.5 is capped to 0.3, so
// stake = 8000 * 0.3 = $2,400 (uncapped this would have been $4,000).
const liveSig2 = { fid: "888", teams: "Epsilon v Zeta", side: "yes", entry: 0.50, fair: 0.60, tpTarget: 0.60, gapPp: 10, suggestedKellyF: 0.5, sizeAtFair: 0, ts: 1100,
  entryFill: { t: 1100, price: 0.50, tx: "0xliveentry2" } };
LIVE = { live: true, signals: [{ ...liveSig, ts: 1120 }, liveSig2] };
sent.length = 0;
await bot.pushLiveTo(2);
has("stake $2,400", "second entry Kelly-sizes on free balance AND caps f at 0.3");

// /status reflects the live session: current balance, free cash, open positions
sent.length = 0;
await bot.handleCommand(2, "/status");
has("balance $10,000", "/status shows the session balance");
has("free $5,600", "/status shows free cash after two fills (10000 - 2000 - 2400)");
has("open positions (2)", "/status lists both open positions");

// pm reaches the entry-time fair → positions close at tpTarget
sent.length = 0;
await bot.settleOpenFor(2, { generatedAt: Date.now(), signals: [
  // 777 carries a REAL exit fill → settle at fair, attach the fill as proof; 888 has none → pm path
  { fid: "777", teams: "Gamma v Delta", fair: 0.755, pm: 0.762, diverged: false, side: "yes", ts: 2000,
    exitFill: { t: 2000, price: 0.78, tx: "0xliveexit", gapPp: 2 } },
  { fid: "888", teams: "Epsilon v Zeta", fair: 0.61, pm: 0.62, diverged: false, side: "yes", ts: 2000 },
] });
has("converged, exit @ fair 0.760", "convergence settles the open position at tpTarget");
has("exit fill @ 0.780 (+2pp past fair) · verify https://polygonscan.com/tx/0xliveexit", "live settlement attaches the real exit-fill link");
const openLeft = bot.chat(2).session.trades.some((t) => t.status === "open");
if (!openLeft) { pass++; console.log("  ✓", "no open positions remain after convergence"); } else { fail++; console.log("  ✗", "position still open after convergence"); }

// /status after settlement shows the UPDATED balance (10000 + 171.43 + 480; the second stake is
// $2,400 not $4,000 because f was capped to 0.3, so its converged PnL is $480 not $800)
sent.length = 0;
await bot.handleCommand(2, "/status");
has("balance $10,651", "/status shows the updated balance after settlement");

// gap heals (signal leaves the feed) → episode re-arms → a NEW divergence alerts again
LIVE = { live: true, signals: [] };
await bot.pushLiveTo(2);
LIVE = { live: true, signals: [{ ...liveSig, entry: 0.66, ts: 3000 }] };
sent.length = 0;
await bot.pushLiveTo(2);
has("Delta's side cheap @ 0.660", "healed episode re-arms for a fresh divergence");

// ── ALERTS-MODE episode lifecycle (chat 4): entry fire → exit fire, no paper session ─────────────
// This is the Norway v England fix: alerts mode used to have NO exit path at all — three entry
// alerts, zero closes. An announced episode must now close with the real ≥fair exit fill (tx proof),
// or an honest no-reach message once the fixture leaves the live feed.
LIVE = { live: true, signals: [] }; // clean feed so chat 4 tracks only its own episodes
await bot.handleCommand(4, "/link las_testkey");
await bot.handleCommand(4, "/live");
const epSig = { fid: "444", teams: "Iota v Kappa", side: "yes", entry: 0.271, fair: 0.410, tpTarget: 0.410, gapPp: 13.9, suggestedKellyF: 0.19, sizeAtFair: 0, ts: 5000_000,
  entryFill: { t: 5000, price: 0.271, tx: "0xepentry" } };
LIVE = { live: true, signals: [epSig] };
sent.length = 0;
await bot.pushLiveTo(4);
has("Kappa's side cheap @ 0.271", "alerts mode announces the fill-backed entry");
has("watching for the exit fill at fair", "alerts mode says an exit fire will follow");
{ const tracked = Object.keys(bot.chat(4).eps).length === 1;
  if (tracked) { pass++; console.log("  ✓", "alerts mode tracks the announced episode"); } else { fail++; console.log("  ✗", "episode was not tracked in alerts mode"); } }

// the detector reports the real ≥fair exit fill → the exit fire arrives with the tx proof
sent.length = 0;
await bot.settleEpisodesFor(4, { generatedAt: Date.now(), signals: [
  { fid: "444", teams: "Iota v Kappa", fair: 0.410, pm: 0.42, diverged: false, side: "yes", ts: 5000_000,
    entryFill: { t: 5000, price: 0.271, tx: "0xepentry" }, exitFill: { t: 5082, price: 0.4125, tx: "0xepexit", gapPp: 0.2 } },
] });
has("Kappa converged, exit @ fair 0.410", "alerts-mode exit fire closes at the entry-time fair");
has("exit fill @ 0.412 (+0.2pp past fair) · verify https://polygonscan.com/tx/0xepexit", "alerts-mode exit fire carries the exit-fill polygonscan link");
{ const cleared = Object.keys(bot.chat(4).eps).length === 0;
  if (cleared) { pass++; console.log("  ✓", "converged episode is cleared from the watch list"); } else { fail++; console.log("  ✗", "episode still tracked after its exit fire"); } }

// PRICE-convergence exit WITHOUT an exit fill (parity with paper mode's settleOpenFor): pm reaches
// fair on a fill too small to be an exitFill, so alerts mode must still close it as converged — not
// let it linger and misreport as a false no-reach at markout.
LIVE = { live: true, signals: [{ ...epSig, fid: "446", teams: "Nu v Xi", ts: 7000_000, entryFill: { t: 7000, price: 0.271, tx: "0xepentry3" } }] };
sent.length = 0;
await bot.pushLiveTo(4);
sent.length = 0;
await bot.settleEpisodesFor(4, { generatedAt: Date.now(), signals: [
  { fid: "446", teams: "Nu v Xi", fair: 0.410, pm: 0.415, diverged: false, side: "yes", ts: 7000_000,
    entryFill: { t: 7000, price: 0.271, tx: "0xepentry3" } }, // NO exitFill — convergence proven only by pm
] });
has("Xi converged, exit @ fair 0.410", "alerts-mode price-convergence exit closes with no exit fill");
{ const noTx = !sent.some((m) => /polygonscan/.test(m));
  if (noTx) { pass++; console.log("  ✓", "price-convergence exit carries no tx link (no fill to prove)"); } else { fail++; console.log("  ✗", "price-convergence exit wrongly claimed a tx"); } }
{ const cleared = Object.keys(bot.chat(4).eps).length === 0;
  if (cleared) { pass++; console.log("  ✓", "price-converged episode cleared from the watch list"); } else { fail++; console.log("  ✗", "price-converged episode still tracked"); } }

// a second episode that never reaches fair: fixture leaves the feed → honest no-reach close
LIVE = { live: true, signals: [{ ...epSig, fid: "445", teams: "Lambda v Mu", ts: 6000_000, entryFill: { t: 6000, price: 0.271, tx: "0xepentry2" } }] };
sent.length = 0;
await bot.pushLiveTo(4);
sent.length = 0;
for (let i = 0; i < 60; i++) await bot.settleEpisodesFor(4, { generatedAt: Date.now(), signals: [] });
has("never traded at fair 0.410 — episode closed (no reach)", "vanished episode closes honestly as no-reach after the mark-out window");
{ const cleared = Object.keys(bot.chat(4).eps).length === 0;
  if (cleared) { pass++; console.log("  ✓", "no-reach episode is cleared from the watch list"); } else { fail++; console.log("  ✗", "no-reach episode still tracked"); } }

// ── trailing balance + $NaN fix + /history + /bankroll display + /refresh (chat 3) ────────────────
sent.length = 0;
await bot.handleCommand(3, "/bankroll 1000");
await bot.handleCommand(3, "/replay TST");
// $NaN regression: the end-of-replay line must render a real balance, never "$NaN"
const noNaN = !sent.some((m) => m.text.includes("NaN"));
if (noNaN) { pass++; console.log("  ✓", "replay end renders a real balance (no $NaN)"); } else { fail++; console.log("  ✗", "replay end rendered $NaN"); }
has("balance $1,000 →", "replay end shows the balance progression from the start");
const c3 = bot.chat(3);
const bal1 = c3.balance;
// a SECOND replay must start from the TRAILING balance, not the original bankroll
sent.length = 0;
await bot.handleCommand(3, "/replay TST");
const trailed = c3.history.length === 2 && c3.history[1].startBal === bal1 && bal1 !== 1000;
if (trailed) { pass++; console.log("  ✓", "second replay starts from the trailing balance (persists across replays)"); } else { fail++; console.log("  ✗", `trailing balance did not carry over (bal1=${bal1}, hist=${c3.history.length})`); }
// /history lists the previous replays
sent.length = 0;
await bot.handleCommand(3, "/history");
has("last 2 replays", "/history lists previous replays");
has("Alpha v Beta", "/history names the match");
// /bankroll with no argument shows the current trailing balance
sent.length = 0;
await bot.handleCommand(3, "/bankroll");
has("balance $", "/bankroll (no arg) shows the trailing balance");
// /refresh resets the session → must set a bankroll again
sent.length = 0;
await bot.handleCommand(3, "/refresh");
has("session refreshed", "/refresh resets the session");
sent.length = 0;
await bot.handleCommand(3, "/bankroll");
has("no bankroll set", "/bankroll after /refresh reports no bankroll");

try { fs.unlinkSync(process.env.TELEGRAM_STATE_FILE); } catch { /* ignore */ }
console.log(`\n${fail ? "❌" : "✅"} telegram: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
