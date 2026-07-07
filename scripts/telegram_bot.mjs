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
// Modes per chat: alerts-only (just the signal + goal-watch + winner-hint) or paper (also sizes a Kelly
// paper trade on a fake bankroll and reports the fill + convergence PnL). Signal only, no real orders.

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
  return { trades: closed.length, wins, losses: closed.length - wins,
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

// ── lagisalpha API ───────────────────────────────────────────────────────────────────────────────
async function apiGet(pathname, key) {
  const r = await fetch(BASE + pathname, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  let body = {}; try { body = await r.json(); } catch { /* ignore */ }
  return r.ok ? body : { __err: r.status, ...body };
}

// ── per-chat state ───────────────────────────────────────────────────────────────────────────────
// chats[chatId] = { apiKey, bankroll, mode: "alerts"|"paper", live: bool, seen: {sigTs...}, session? }
let state = { offset: 0, chats: {} };
function loadState() { try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { /* fresh */ } }
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error("save", e?.message); } }
function chat(id) { return (state.chats[id] ||= { apiKey: null, bankroll: null, mode: "alerts", live: false, seen: {} }); }

const HELP = [
  "lagisalpha — paper-trade the lead-lag edge. commands:",
  "/bankroll <amount>  set a fake bankroll (turns on paper mode, Kelly-sized)",
  "/mode alerts|paper  alerts only, or paper trades on your bankroll",
  "/link las_<key>     link your API key (needed for live)",
  "/matches            list the settled matches you can replay",
  "/replay <code>      watch a settled match play out to PnL",
  "/live               push live signals as they fire (needs a key)",
  "/stop               stop live pushes",
  "/status · /help",
  "",
  "Paper only: fake bankroll, no real orders.",
].join("\n");

// ── command handling ─────────────────────────────────────────────────────────────────────────────
async function replayFor(chatId, code) {
  const c = chat(chatId);
  const data = await apiGet("/api/replay-signals");
  const list = data?.matches ?? [];
  if (!list.length) return send(chatId, "no replay data available right now.");
  const m = code ? list.find((x) => x.code.toLowerCase() === code.toLowerCase() || x.fid === code) : list[0];
  if (!m) return send(chatId, `unknown match "${code}". send /matches to list.`);
  const paper = c.mode === "paper" && c.bankroll;
  await send(chatId, `replay ${m.teams} — ${m.count} signals${paper ? ` — bankroll ${money(c.bankroll)}` : " — alerts only"}`);
  // overlays (goal-watch / winner-hint) merge into the same real-clock timeline as the entries/exits
  const overlays = [
    ...(m.goalWatch ?? []).map((w) => ({ ts: w.ts, kind: "watch", ...w })),
    ...(m.winnerHint ? [{ ts: m.winnerHint.ts ?? Infinity, kind: "winner", ...m.winnerHint }] : []),
  ];
  // a nominal bankroll drives ordering even in alerts mode (we just don't render the paper lines)
  const { feed, summary } = replayTimeline(paper ? c.bankroll : 1000, m.signals, m.ft, overlays);
  for (const ev of feed) {
    if (ev.kind === "watch") { await send(chatId, goalWatchLine(ev.data)); continue; }
    if (ev.kind === "winner") { await send(chatId, winnerHintLine(ev.data)); continue; }
    if (ev.kind === "entry") { await send(chatId, entryNotif(ev, paper)); continue; }
    if (ev.kind === "exit") { await send(chatId, exitNotif(ev, paper)); continue; }
  }
  if (paper) await send(chatId, `— done · ${summary.trades} trades · ${summary.wins}W/${summary.losses}L · ROI ${pen(summary.roiPct.toFixed(1))}% · bankroll ${money(summary.bankroll)}`);
}

async function handleCommand(chatId, text) {
  const c = chat(chatId);
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase().replace(/@.*$/, "")) {
    case "/start": await send(chatId, "welcome to lagisalpha — catch the lag, take the cheap side, Kelly-sized.\n\n" + HELP); break;
    case "/help": await send(chatId, HELP); break;
    case "/bankroll": {
      const n = Number(arg.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n <= 0) { await send(chatId, "usage: /bankroll 10000"); break; }
      const hadOpen = c.session?.trades?.some((t) => t.status === "open");
      c.bankroll = n; c.mode = "paper"; c.session = null; saveState();
      await send(chatId, `bankroll ${money(n)} · mode: paper (Kelly sizing, locked)${hadOpen ? " · previous paper session (incl. open positions) cleared" : ""}`); break;
    }
    case "/mode": {
      const m = arg.toLowerCase();
      if (m !== "alerts" && m !== "paper") { await send(chatId, "usage: /mode alerts   or   /mode paper"); break; }
      if (m === "paper" && !c.bankroll) { await send(chatId, "set a bankroll first: /bankroll 10000"); break; }
      c.mode = m; saveState(); await send(chatId, `mode: ${m}`); break;
    }
    case "/link": {
      if (!/^las_/.test(arg)) { await send(chatId, "usage: /link las_<key>"); break; }
      // probe the key against the gated endpoint
      const probe = await apiGet("/api/v1/divergences?status=live", arg);
      if (probe?.__err === 401) { await send(chatId, "that key is invalid or expired. get one at " + BASE + "/api"); break; }
      c.apiKey = arg; saveState();
      await send(chatId, `key linked (${arg.slice(0, 8)}…) · live unlocked. send /live to start.`); break;
    }
    case "/matches": {
      const data = await apiGet("/api/replay-signals"); const list = data?.matches ?? [];
      if (!list.length) { await send(chatId, "no replay data available."); break; }
      await send(chatId, "settled matches:\n" + list.map((m) => `  ${m.code} — ${m.teams} (${m.count})`).join("\n") + "\n\nrun: /replay <code>"); break;
    }
    case "/replay": await replayFor(chatId, arg); break;
    case "/live": {
      if (!c.apiKey) { await send(chatId, "live is a paid feature. link a key: /link las_<key> (get one at " + BASE + "/api, $97.99/mo or $699.99 lifetime)"); break; }
      c.live = true; saveState();
      await send(chatId, "live pushes ON. you'll get each divergence as it fires" + (c.mode === "paper" ? ", plus paper fills + PnL." : ".") + " send /stop to end.");
      await pushLiveTo(chatId); break;
    }
    case "/stop": c.live = false; saveState(); await send(chatId, "live pushes OFF."); break;
    case "/status": {
      const s = c.session;
      const open = s ? s.trades.filter((t) => t.status === "open") : [];
      const lines = s
        ? [`balance ${money(s.bankroll)} (started ${money(s.bankroll0)}) · free ${money(availableCash(s))} · realized PnL ${pen(money(s.realizedPnl))}`]
        : [`bankroll ${c.bankroll ? money(c.bankroll) : "—"} (no live paper session yet)`];
      lines.push(`mode ${c.mode} · key ${c.apiKey ? "linked" : "none"} · live ${c.live ? "on" : "off"}`);
      if (open.length) {
        lines.push(`open positions (${open.length}):`);
        for (const p of open) lines.push(`  ${teamOf(p)} @ ${p.entry.toFixed(3)} -> ${p.tpTarget.toFixed(3)} · stake ${money(p.stake)} (${p.teams})`);
      }
      await send(chatId, lines.join("\n")); break;
    }
    default: if (cmd.startsWith("/")) await send(chatId, `unknown command ${cmd}. /help`); break;
  }
}

// ── live push loop ───────────────────────────────────────────────────────────────────────────────
async function pushLiveTo(chatId) {
  const c = chat(chatId);
  if (!c.live || !c.apiKey) return;
  const q = await apiGet("/api/v1/divergences?status=live", c.apiKey);
  if (q?.__err === 401) { c.live = false; saveState(); return send(chatId, "your key expired; live off. renew at " + BASE + "/api"); }
  if (!q) return;
  const sigs = q.live === false ? [] : (q.signals ?? []);
  // ONE alert/fill per divergence EPISODE: the key is fid:side (NOT fid:ts — the box republishes the
  // same divergence with a fresh ts every minute, which used to re-open a Kelly stake per poll until
  // the bankroll was fully tied up). A key is cleared when its fid:side leaves the live signal list
  // (gap healed or match over), so a genuinely new divergence on that side re-arms — mirroring the
  // detector's hysteresis. Legacy fid:ts keys are pruned.
  const active = new Set(sigs.map((s) => `${s.fid}:${s.side}`));
  for (const k of Object.keys(c.seen)) {
    if (/^[^:]+:(yes|no)$/.test(k)) { if (!active.has(k)) delete c.seen[k]; }
    else if (/^\d+:\d+$/.test(k)) delete c.seen[k];
  }
  c.session ||= c.mode === "paper" && c.bankroll ? newSession(c.bankroll) : null;
  for (const sig of sigs) {
    const id = `${sig.fid}:${sig.side}`;
    if (c.seen[id]) continue;
    c.seen[id] = 1;
    if (c.mode === "paper" && c.session) {
      const pos = openPosition(c.session, sig);
      if (pos.stake > 0) await send(chatId, `${signalLine(sig)}\n${fillLine(pos)}\n  watching for convergence to fair…`);
      else { c.session.trades.pop(); c.session.seq -= 1; await send(chatId, `${signalLine(sig)}\n  (no paper fill — bankroll fully committed to open positions)`); }
    } else {
      await send(chatId, signalLine(sig));
    }
  }
  // goal-watch on live fixtures (present once live_edge publishes goalWatch)
  for (const w of q.goalWatch ?? []) {
    const id = `gw:${w.ts}:${w.team}`;
    if (c.seen[id]) continue; c.seen[id] = 1;
    await send(chatId, goalWatchLine(w));
  }
  if (q.winnerHint) {
    const id = `wh:${q.winnerHint.fid}`;
    if (!c.seen[id]) { c.seen[id] = 1; await send(chatId, winnerHintLine(q.winnerHint)); }
  }
  saveState();
}

// ── convergence watcher ──────────────────────────────────────────────────────────────────────────
// Settles open paper positions against /api/live-edge (ungated; the box republishes every minute with
// the CURRENT pm + fair for every live fixture, diverged or not). Exit rule mirrors the backtest
// (compute_edge.py): converged when the bought side's current price reaches the entry-time fair
// (tpTarget) → exit AT tpTarget; if the fixture leaves the live feed for good (match over), mark out
// at the last price seen — the live analogue of marking out at the close.
const EDGE_STALE_MS = 10 * 60 * 1000; // ignore a live-edge blob older than this (box cron down)
const MARKOUT_MISSES = 60; // polls (~20 min at 20s) a fixture must be absent before marking out — rides out halftime
async function settleOpenFor(chatId, edge) {
  const c = chat(chatId);
  const s = c.session;
  if (!s) return;
  const open = s.trades.filter((t) => t.status === "open");
  if (!open.length) return;
  const byFid = new Map((edge.signals ?? []).map((x) => [String(x.fid), x]));
  for (const pos of open) {
    // fid was added to positions later; fall back to the teams string for positions opened before that
    const lv = byFid.get(String(pos.fid)) ?? (edge.signals ?? []).find((x) => x.teams === pos.teams);
    if (lv) {
      const px = pos.side === "yes" ? lv.pm : 1 - lv.pm;
      if (!Number.isFinite(px)) continue;
      pos.lastPx = px; pos.misses = 0;
      if (px >= pos.tpTarget - 1e-6) {
        settlePosition(s, pos, pos.tpTarget, "converged");
        pos._bankAfter = s.bankroll;
        await send(chatId, `${pos.teams} — ${teamOf(pos)}\n${exitLine(pos)}`);
      }
    } else {
      pos.misses = (pos.misses ?? 0) + 1;
      if (pos.misses >= MARKOUT_MISSES) {
        settlePosition(s, pos, pos.lastPx ?? pos.entry, "marked_out");
        pos._bankAfter = s.bankroll;
        await send(chatId, `${pos.teams} — ${teamOf(pos)}\n${exitLine(pos)}`);
      }
    }
  }
  saveState();
}

async function liveLoop() {
  // one shared live-edge fetch per tick; skip settlement entirely on a stale/failed read so a box
  // hiccup can never mark positions out
  let edge = null;
  try {
    const e = await apiGet("/api/live-edge");
    if (e && !e.__err && Number.isFinite(e.generatedAt) && Date.now() - e.generatedAt < EDGE_STALE_MS) edge = e;
  } catch (e) { console.error("edge", e?.message); }
  for (const chatId of Object.keys(state.chats)) {
    const c = state.chats[chatId];
    if (c.live) { try { await pushLiveTo(chatId); } catch (e) { console.error("push", e?.message); } }
    // settle even when live pushes are off: an open position must still close at fair
    if (edge && c.session) { try { await settleOpenFor(chatId, edge); } catch (e) { console.error("settle", e?.message); } }
  }
  setTimeout(liveLoop, LIVE_POLL_MS);
}

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
  console.log(`lagisalpha telegram bot up · base ${BASE} · ${Object.keys(state.chats).length} chats`);
  pollLoop();
  liveLoop();
}

// exported for the mocked smoke test (scripts/telegram_test.mjs); no-op when run as the bot.
export { handleCommand, replayFor, pushLiveTo, settleOpenFor, chat, state, newSession, openPosition, settlePosition, replayExit, summarize };
