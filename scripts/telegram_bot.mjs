#!/usr/bin/env node
// LAGISALPHA TELEGRAM BOT — the pro-trader lead-lag edge, pushed to Telegram.
//
// Self-contained (Node builtins + global fetch, no npm install), just like bin/lagisalpha.mjs, so it runs
// on the box straight from a single file regardless of whether the checked-out repo is current. The paper
// engine below MIRRORS lib/paper/engine.mjs and bin/lagisalpha.mjs (keep the three in sync).
//
// Deploy (on the EC2 box, as a systemd service):
//   TELEGRAM_BOT_TOKEN=<botfather token> node scripts/telegram_bot.mjs
// Env:
//   TELEGRAM_BOT_TOKEN   required — the BotFather token
//   LAGISALPHA_BASE      default https://lagisalpha.vercel.app
//   TELEGRAM_STATE_FILE  default ~/.lagisalpha-telegram-state.json  (per-chat subscriber state)
//
// Archival replay only: set a bankroll, /replay a settled match, and watch each divergence play out as a
// real-clock Kelly-sized paper trade with the convergence PnL. Signal only, no real orders. The live-push
// surface (alerts, /live) was retired when the tournament closed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BASE = process.env.LAGISALPHA_BASE || "https://lagisalpha.vercel.app";
const STATE_FILE = process.env.TELEGRAM_STATE_FILE || path.join(os.homedir(), ".lagisalpha-telegram-state.json");
const API = `https://api.telegram.org/bot${TOKEN}`;
const LIVE_POLL_MS = 20000; // how often we poll for live signals to push
const IS_MAIN = process.argv[1] && process.argv[1].endsWith("telegram_bot.mjs");

// ── paper engine (mirror of lib/paper/engine.mjs) ────────────────────────────────────────────────
const CENTS = (n) => Math.round(n * 100) / 100;
// Max fraction of free balance any single Kelly call may stake. MUST match KELLY_CAP in
// lib/signals/policy.ts / lib/paper/engine.mjs. Fractional Kelly bounds single-bet drawdown.
const KELLY_CAP = 0.3;
function newSession(bankroll) {
  const b = Number(bankroll);
  if (!Number.isFinite(b) || b <= 0) throw new Error("bankroll must be positive");
  return { bankroll0: b, bankroll: b, realizedPnl: 0, openStake: 0, trades: [], seq: 0 };
}
const availableCash = (s) => CENTS(s.bankroll - s.openStake);
function openPosition(s, sig) {
  const entry = sig.entry;
  const f = Math.min(KELLY_CAP, Number.isFinite(sig.suggestedKellyF) ? sig.suggestedKellyF : 0);
  const stake = CENTS(availableCash(s) * f); // Kelly on the FREE balance at entry, capped at KELLY_CAP
  const shares = stake > 0 && entry > 0 ? stake / entry : 0;
  const pos = { id: ++s.seq, fid: sig.fid, teams: sig.teams, side: sig.side, entry, fair: sig.fair, tpTarget: sig.tpTarget ?? sig.fair,
    gapPp: sig.gapPp, f: CENTS(f), stake, shares, ts: sig.ts, minute: sig.minute, status: "open", pnl: 0 };
  s.openStake = CENTS(s.openStake + stake); s.trades.push(pos); return pos;
}
function settlePosition(s, pos, exitPrice, reason) {
  const px = Math.max(0, Math.min(1, Number(exitPrice)));
  const pnl = CENTS(pos.shares * px - pos.stake);
  pos.exitPrice = px; pos.exitReason = reason; pos.pnl = pnl; pos.status = "closed";
  s.openStake = CENTS(s.openStake - pos.stake); s.realizedPnl = CENTS(s.realizedPnl + pnl); s.bankroll = CENTS(s.bankroll + pnl);
  return pos;
}
function replayExit(sig) {
  if (sig.reached) return { exitPrice: sig.tpTarget ?? sig.fair, reason: "converged" };
  const close = Number.isFinite(sig.clv) ? sig.entry + sig.clv : sig.entry;
  return { exitPrice: close, reason: "marked_out" };
}
// REAL-CLOCK replay (mirror of lib/paper/engine.mjs replayTimeline): a position stays OPEN from its
// entry (sig.ts) until its real exit — the exit fill's ts on reach, else the match close (matchFt) —
// so a later entry sizes Kelly on the FREE balance while earlier positions are still open. Returns the
// ordered render feed: entry then a later exit per signal, with overlays merged by ts.
function replayTimeline(bankroll, signals, matchFt, overlays = []) {
  const session = newSession(bankroll);
  const events = [];
  for (const sig of signals) {
    events.push({ t: sig.ts, o: 0, kind: "entry", sig });
    const exitT = sig.reached ? (sig.exitFill?.t ?? sig.ts) : (Number.isFinite(matchFt) ? matchFt : sig.ts);
    events.push({ t: exitT, o: 1, kind: "exit", sig });
  }
  for (const ov of overlays) if (ov && Number.isFinite(ov.ts)) events.push({ t: ov.ts, o: 0, kind: ov.kind, data: ov });
  events.sort((a, b) => a.t - b.t || a.o - b.o);
  const feed = []; const posOf = new Map();
  for (const ev of events) {
    if (ev.kind === "entry") {
      const pos = openPosition(session, ev.sig);
      if (pos.stake <= 0) { session.trades.pop(); session.seq -= 1; session.openStake = CENTS(session.openStake - pos.stake); posOf.set(ev.sig, null); feed.push({ kind: "entry", sig: ev.sig, pos: null, noFill: true }); }
      else { posOf.set(ev.sig, pos); feed.push({ kind: "entry", sig: ev.sig, pos, free: availableCash(session) }); }
    } else if (ev.kind === "exit") {
      const pos = posOf.get(ev.sig); if (!pos) continue;
      const { exitPrice, reason } = replayExit(ev.sig);
      settlePosition(session, pos, exitPrice, reason); pos._bankAfter = session.bankroll;
      feed.push({ kind: "exit", sig: ev.sig, pos, bankroll: session.bankroll });
    } else feed.push({ kind: ev.kind, data: ev.data });
  }
  return { session, feed, summary: summarize(session) };
}
// Polygon explorer link for a fill's settling transaction (verifiable, not asserted).
const EXPLORER = (tx) => `https://polygonscan.com/tx/${tx}`;
function summarize(s) {
  const closed = s.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  // bankroll/bankroll0 MUST be returned (the end-of-replay line renders summary.bankroll — omitting it
  // is what produced "$NaN"). Mirrors lib/paper/engine.mjs summarize; keep the three in sync.
  return { trades: closed.length, wins, losses: closed.length - wins,
    bankroll: s.bankroll, bankroll0: s.bankroll0,
    roiPct: CENTS(((s.bankroll - s.bankroll0) / s.bankroll0) * 100) };
}

// ── formatting ───────────────────────────────────────────────────────────────────────────────────
const money = (n) => "$" + Math.round(n).toLocaleString();
const pen = (n) => (n >= 0 ? "+" : "") + n;
// which team's side is cheap (yes = second team, no = first). A label for WHICH price is underpriced,
// not a bet on who wins: the trade is the price converging to TxLINE fair.
const teamOf = (sig) => sig.team || (sig.teams || "").split(/\s+v\s+/i)[sig.side === "yes" ? 1 : 0]?.trim() || sig.side.toUpperCase();
function signalLine(sig) {
  const mn = sig.minute != null ? `${Math.max(0, Math.round(sig.minute))}' ` : "";
  return `📈 ${mn}${sig.teams}\n${teamOf(sig)}'s side cheap @ ${sig.entry.toFixed(3)} -> fair ${sig.fair.toFixed(3)} (+${sig.gapPp.toFixed(0)}pp to converge)`;
}
function fillLine(pos) {
  return `  paper fill ${Math.round(pos.shares).toLocaleString()} sh · stake ${money(pos.stake)} (Kelly ${(pos.f * 100).toFixed(0)}%)`;
}
// ENTRY notification: the cheap side, the real on-chain fill that set the entry price, and (paper) the
// Kelly stake taken on the free balance. Its own message — the exit arrives later, on the real clock.
function entryNotif(ev, paper) {
  const sig = ev.sig;
  const lines = [signalLine(sig)];
  if (sig.entryFill?.tx) lines.push(`  entry fill @ ${sig.entry.toFixed(3)} · verify ${EXPLORER(sig.entryFill.tx)}`);
  if (paper) {
    if (ev.pos) lines.push(`  paper fill ${Math.round(ev.pos.shares).toLocaleString()} sh · stake ${money(ev.pos.stake)} (Kelly ${(ev.pos.f * 100).toFixed(0)}% of free ${money(ev.free + ev.pos.stake)}) · watching for convergence…`);
    else lines.push("  (no paper fill — bankroll fully committed to open positions)");
  }
  return lines.join("\n");
}
// EXIT notification: a SEPARATE message when the position closes. On reach it carries the real Polygon
// fill that traded at/through fair (the exit proof); on no-reach it marks out at the close (no fill).
function exitNotif(ev, paper) {
  const sig = ev.sig;
  const reached = sig.reached;
  const paperPx = paper && ev.pos ? ev.pos.exitPrice : (sig.tpTarget ?? sig.fair);
  const tag = reached ? "converged, exit @ fair" : "no reach, marked out @ close";
  const em = paper && ev.pos ? (ev.pos.pnl >= 0 ? "✅" : "🔻") : reached ? "✅" : "🔻";
  const lines = [`${em} ${sig.teams} — ${teamOf(sig)} ${tag} ${paperPx.toFixed(3)}`];
  if (reached && sig.exitFill?.tx) {
    const past = Number.isFinite(sig.exitFill.gapPp) ? ` (+${sig.exitFill.gapPp}pp past fair)` : "";
    lines.push(`  exit fill @ ${(sig.exitFill.price ?? paperPx).toFixed(3)}${past} · verify ${EXPLORER(sig.exitFill.tx)}`);
  }
  if (paper && ev.pos) lines.push(`  PnL ${pen(money(ev.pos.pnl))} · bankroll ${money(ev.bankroll)}`);
  return lines.join("\n");
}
// LIVE exit line: the convergence watcher settles a live position at fair (synthetic — a real exit fill
// only prints after the fact, so there is no tx yet, unlike a settled replay).
function exitLine(pos) {
  const tag = pos.exitReason === "converged" ? "converged, exit @ fair" : "match over, marked out @ close";
  const em = pos.pnl >= 0 ? "✅" : "🔻";
  return `${em} ${tag} ${pos.exitPrice.toFixed(3)} · PnL ${pen(money(pos.pnl))} · bankroll ${money(pos._bankAfter)}`;
}
function goalWatchLine(w) {
  return `⚠️ ${w.min}' goal watch: ${w.team ?? w.teamName} — high-danger pressure${w.pressure > 1 ? ` (x${w.pressure})` : ""}, watch the line`;
}
function winnerHintLine(h) {
  const x = h.margin != null && Number.isFinite(h.margin) ? `${h.margin.toFixed(1)}x` : "far";
  return `🏆 likely winner: ${h.teamName} — volume-per-divergence ${x} ahead${h.atMin != null ? ` (by ${h.atMin}')` : ""}\n(late signal of success · pilot n=12, in-sample)`;
}

// ── telegram API ─────────────────────────────────────────────────────────────────────────────────
async function tg(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { console.error("tg", method, e?.message); return { ok: false }; }
}
const send = (chatId, text) => tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
// Durable send for EXIT fires: an exit message lost to a Telegram hiccup would leave an entry that
// never closes (the exact failure this bot is being fixed for), so failures queue in the chat's outbox
// and are re-flushed at the start of every live tick. Capped so state cannot grow without bound.
const OUTBOX_CAP = 20;
async function sendDurable(chatId, text) {
  const r = await send(chatId, text);
  if (!r?.ok) {
    const c = chat(chatId);
    (c.outbox ||= []).push(text);
    if (c.outbox.length > OUTBOX_CAP) c.outbox = c.outbox.slice(-OUTBOX_CAP);
    saveState();
  }
  return r;
}
async function flushOutbox(chatId) {
  const c = chat(chatId);
  if (!c.outbox?.length) return;
  const pending = c.outbox; c.outbox = [];
  for (const text of pending) await sendDurable(chatId, text);
  saveState();
}

// The slash-command menu Telegram clients pop up when the user types "/". Registered once at startup
// via setMyCommands (BotFather does the same thing under the hood). Names are lowercase, no slash.
const BOT_COMMANDS = [
  { command: "bankroll", description: "set a fake bankroll, or show your balance" },
  { command: "matches", description: "list the settled matches to replay" },
  { command: "replay", description: "watch a settled match play out to PnL" },
  { command: "history", description: "your previous replays" },
  { command: "refresh", description: "reset the session (set a bankroll again)" },
  { command: "status", description: "balance, open positions" },
  { command: "help", description: "show all commands" },
];
const registerCommands = () => tg("setMyCommands", { commands: BOT_COMMANDS });

// ── lagisalpha API ───────────────────────────────────────────────────────────────────────────────
async function apiGet(pathname, key) {
  const r = await fetch(BASE + pathname, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  let body = {}; try { body = await r.json(); } catch { /* ignore */ }
  return r.ok ? body : { __err: r.status, ...body };
}

// ── per-chat state ───────────────────────────────────────────────────────────────────────────────
// chats[chatId] = { apiKey, bankroll, balance, mode: "alerts"|"paper", live: bool, seen: {sigTs...}, session?, history: [] }
//   bankroll = the amount originally set (the "started" reference for ROI)
//   balance  = the TRAILING balance: it persists across replays AND into live — a replay runs from it
//              and writes the ending balance back; live settlement updates it too. One running number.
let state = { offset: 0, chats: {} };
function loadState() { try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { /* fresh */ } }
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error("save", e?.message); } }
function chat(id) {
  const c = (state.chats[id] ||= { bankroll: null, balance: null, session: null, history: [] });
  // migrate older records: seed the trailing balance from a previously-set bankroll, ensure history exists
  if (c.balance == null && c.bankroll != null) c.balance = c.bankroll;
  if (!Array.isArray(c.history)) c.history = [];
  return c;
}
// keep only the most recent N replays so the state file cannot grow without bound
const HISTORY_CAP = 20;

const HELP = [
  "lagisalpha — paper-trade the lead-lag edge. commands:",
  "/bankroll <amount>  set a fake bankroll (Kelly-sized)",
  "/bankroll           show your current trailing balance",
  "/matches            list the settled matches you can replay",
  "/replay <code>      watch a settled match play out to PnL",
  "/history            your previous replays (W/L, ROI, balance)",
  "/refresh            reset the session (set a bankroll again)",
  "/status · /help",
  "",
  "Balance is one running number: it trails across replays.",
  "Paper only: fake bankroll, no real orders. Archival replay (the live feed was retired).",
].join("\n");

// ── command handling ─────────────────────────────────────────────────────────────────────────────
async function replayFor(chatId, code) {
  const c = chat(chatId);
  const data = await apiGet("/api/replay-signals");
  const list = data?.matches ?? [];
  if (!list.length) return send(chatId, "no replay data available right now.");
  const m = code ? list.find((x) => x.code.toLowerCase() === code.toLowerCase() || x.fid === code) : list[0];
  if (!m) return send(chatId, `unknown match "${code}". send /matches to list.`);
  const start = c.balance ?? c.bankroll; // run from the TRAILING balance, not the original bankroll
  if (!(start > 0)) return send(chatId, "set a bankroll first: /bankroll 10000");
  await send(chatId, `replay ${m.teams} — ${m.count} signals — balance ${money(start)}`);
  // overlays (goal-watch / winner-hint) merge into the same real-clock timeline as the entries/exits
  const overlays = [
    ...(m.goalWatch ?? []).map((w) => ({ ts: w.ts, kind: "watch", ...w })),
    ...(m.winnerHint ? [{ ts: m.winnerHint.ts ?? Infinity, kind: "winner", ...m.winnerHint }] : []),
  ];
  const { summary, feed } = replayTimeline(start, m.signals, m.ft, overlays);
  for (const ev of feed) {
    if (ev.kind === "watch") { await send(chatId, goalWatchLine(ev.data)); continue; }
    if (ev.kind === "winner") { await send(chatId, winnerHintLine(ev.data)); continue; }
    if (ev.kind === "entry") { await send(chatId, entryNotif(ev, true)); continue; }
    if (ev.kind === "exit") { await send(chatId, exitNotif(ev, true)); continue; }
  }
  // persist the ending balance as the new trailing balance, and log the replay to history
  c.balance = summary.bankroll;
  c.history.push({ code: m.code, teams: m.teams, at: Date.now(), trades: summary.trades,
    wins: summary.wins, losses: summary.losses, roiPct: summary.roiPct, startBal: start, endBal: c.balance });
  if (c.history.length > HISTORY_CAP) c.history = c.history.slice(-HISTORY_CAP);
  saveState();
  await send(chatId, `— done · ${summary.trades} trades · ${summary.wins}W/${summary.losses}L · ROI ${pen(summary.roiPct.toFixed(1))}% · balance ${money(start)} → ${money(c.balance)}`);
}

async function handleCommand(chatId, text) {
  const c = chat(chatId);
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase().replace(/@.*$/, "")) {
    case "/start": await send(chatId, "welcome to lagisalpha — catch the lag, take the cheap side, Kelly-sized.\n\n" + HELP); break;
    case "/help": await send(chatId, HELP); break;
    case "/bankroll": {
      const raw = arg.replace(/[$,\s]/g, "");
      if (!raw) {
        // no amount → SHOW the current trailing balance (it persists across replays and into live)
        if (c.balance == null) { await send(chatId, "no bankroll set. usage: /bankroll 10000"); break; }
        const s = c.session;
        const parts = [`balance ${money(c.balance)} (started ${money(c.bankroll ?? c.balance)})`];
        if (s && s.openStake > 0) parts.push(`free ${money(c.balance - s.openStake)} · ${money(s.openStake)} in open positions`);
        await send(chatId, parts.join(" · ")); break;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) { await send(chatId, "usage: /bankroll 10000   ·   /bankroll  (no amount) shows your balance"); break; }
      const hadOpen = c.session?.trades?.some((t) => t.status === "open");
      c.bankroll = n; c.balance = n; c.session = null; saveState();
      await send(chatId, `bankroll ${money(n)} · Kelly sizing (locked)${hadOpen ? " · previous session (incl. open positions) cleared" : ""}`); break;
    }
    case "/matches": {
      const data = await apiGet("/api/replay-signals"); const list = data?.matches ?? [];
      if (!list.length) { await send(chatId, "no replay data available."); break; }
      await send(chatId, "settled matches:\n" + list.map((m) => `  ${m.code} — ${m.teams} (${m.count})`).join("\n") + "\n\nrun: /replay <code>"); break;
    }
    case "/replay": await replayFor(chatId, arg); break;
    case "/status": {
      const s = c.session;
      const open = s ? s.trades.filter((t) => t.status === "open") : [];
      const lines = s
        ? [`balance ${money(s.bankroll)} (started ${money(s.bankroll0)}) · free ${money(availableCash(s))} · realized PnL ${pen(money(s.realizedPnl))}`]
        : [`balance ${c.balance != null ? money(c.balance) : "—"}${c.bankroll ? ` (started ${money(c.bankroll)})` : ""} · no open positions`];
      if (open.length) {
        lines.push(`open positions (${open.length}):`);
        for (const p of open) lines.push(`  ${teamOf(p)} @ ${p.entry.toFixed(3)} -> ${p.tpTarget.toFixed(3)} · stake ${money(p.stake)} (${p.teams})`);
      }
      await send(chatId, lines.join("\n")); break;
    }
    case "/refresh": {
      // wipe the paper session so the user starts clean — they must set a bankroll again. Keeps the
      // replay history (that record is the point of /history).
      const hadOpen = c.session?.trades?.some((t) => t.status === "open");
      c.bankroll = null; c.balance = null; c.session = null;
      saveState();
      await send(chatId, `session refreshed${hadOpen ? " · open positions cleared" : ""} · set a bankroll to begin again: /bankroll 10000`); break;
    }
    case "/history": {
      const h = c.history ?? [];
      if (!h.length) { await send(chatId, "no replays yet — run /replay <code> (see /matches)."); break; }
      const rows = h.slice(-10).reverse().map((r) => {
        const d = new Date(r.at).toISOString().slice(5, 16).replace("T", " ");
        return `${d} · ${r.teams} · ${r.wins}W/${r.losses}L · ROI ${pen(r.roiPct.toFixed(1))}% · ${money(r.startBal)}→${money(r.endBal)}`;
      });
      await send(chatId, `last ${rows.length} replay${rows.length > 1 ? "s" : ""}:\n` + rows.join("\n")); break;
    }
    default: if (cmd.startsWith("/")) await send(chatId, `unknown command ${cmd}. /help`); break;
  }
}

// The live push loop, convergence watcher, and episode settlement were removed with the live surface.
// The bot is archival replay only: /replay drives replayTimeline (real-clock paper trade) synchronously.

// ── long-poll updates ────────────────────────────────────────────────────────────────────────────
async function pollLoop() {
  try {
    const r = await fetch(`${API}/getUpdates?timeout=30&offset=${state.offset}`);
    const data = await r.json();
    for (const u of data.result ?? []) {
      state.offset = u.update_id + 1;
      const msg = u.message || u.edited_message;
      if (!msg || !msg.text) continue;
      const chatId = msg.chat.id;
      try { await handleCommand(chatId, msg.text); } catch (e) { console.error("cmd", e?.message); await send(chatId, "something went wrong — try again"); }
    }
    saveState();
  } catch (e) { console.error("poll", e?.message); await new Promise((r) => setTimeout(r, 3000)); }
  setImmediate(pollLoop);
}

if (IS_MAIN) {
  if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN is required"); process.exit(1); }
  loadState();
  registerCommands(); // publish the "/" command menu to Telegram (fire-and-forget)
  console.log(`lagisalpha telegram bot up · base ${BASE} · ${Object.keys(state.chats).length} chats`);
  pollLoop();
}

// exported for the mocked smoke test (scripts/telegram_test.mjs); no-op when run as the bot.
export { handleCommand, replayFor, chat, state, newSession, openPosition, settlePosition, replayExit, summarize };
