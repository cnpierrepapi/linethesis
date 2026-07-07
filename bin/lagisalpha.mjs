#!/usr/bin/env node
// lagisalpha — the paper-trading terminal, as a SINGLE self-contained file so it runs straight from git
// with no clone and no npm install:
//   Windows (PowerShell):  irm https://raw.githubusercontent.com/cnpierrepapi/lagisalpha/master/bin/lagisalpha.mjs -o lagisalpha.mjs; node lagisalpha.mjs
//   macOS / Linux:         curl -sL https://raw.githubusercontent.com/cnpierrepapi/lagisalpha/master/bin/lagisalpha.mjs -o lagisalpha.mjs && node lagisalpha.mjs
// Code comes from git (this file), signals from the cloud API (Supabase blob published by the EC2 box).
// Paper only: fake bankroll, no real trades. The engine below MIRRORS lib/paper/engine.mjs (keep in sync).

import readline from "node:readline";

const BASE = process.env.LAGISALPHA_BASE || "https://lagisalpha.vercel.app";
const NO_COLOR = !!process.env.NO_COLOR;

// ── paper engine (mirror of lib/paper/engine.mjs) ────────────────────────────────────────────────
const CENTS = (n) => Math.round(n * 100) / 100;
function newSession(bankroll) {
  const b = Number(bankroll);
  if (!Number.isFinite(b) || b <= 0) throw new Error("bankroll must be positive");
  return { bankroll0: b, bankroll: b, realizedPnl: 0, openStake: 0, trades: [], seq: 0 };
}
const availableCash = (s) => CENTS(s.bankroll - s.openStake);
function openPosition(s, sig) {
  const entry = sig.entry;
  const f = Number.isFinite(sig.suggestedKellyF) ? sig.suggestedKellyF : 0;
  const stake = CENTS(Math.min(availableCash(s), s.bankroll * f));
  const shares = stake > 0 && entry > 0 ? stake / entry : 0;
  const pos = { id: ++s.seq, teams: sig.teams, side: sig.side, entry, fair: sig.fair, tpTarget: sig.tpTarget ?? sig.fair,
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
function summarize(s) {
  const closed = s.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  return { trades: closed.length, wins, losses: closed.length - wins,
    roiPct: CENTS(((s.bankroll - s.bankroll0) / s.bankroll0) * 100) };
}

// ── colour + host ────────────────────────────────────────────────────────────────────────────────
const COLORS = { sys: "33", sig: "37", fill: "90", win: "32", loss: "31", muted: "90", echo: "90", prompt: "33", warn: "35" };
const paint = (t, c) => (NO_COLOR || !COLORS[c] ? t : `\x1b[${COLORS[c]}m${t}\x1b[0m`);
const money = (n) => "$" + Math.round(n).toLocaleString();
const pen = (n) => (n >= 0 ? "+" : "") + n;
const host = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async fetchJson(path, key) {
    const res = await fetch(BASE + path, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
    let body = {}; try { body = await res.json(); } catch { /* ignore */ }
    return res.ok ? body : { __err: res.status, ...body };
  },
};

// ── REPL ─────────────────────────────────────────────────────────────────────────────────────────
const state = { bankroll: null, apiKey: null };
function emit(text, cls = "sig") { if (text === "__clear__") { console.clear(); return; } console.log(paint(text, cls)); }
const HELP = [
  "commands:",
  "  bankroll <amount>   set your paper bankroll (Kelly sizing, locked)",
  "  matches             list the settled matches you can replay",
  "  replay <code|fid>   paper-trade a settled match (omit to pick the biggest)",
  "  load <las_key>      load your API key (needed for live)",
  "  live                paper-trade the live match, if one is in play",
  "  clear · help · exit",
];

async function doReplay(arg) {
  if (!state.bankroll) return emit("set a bankroll first, e.g.  bankroll 10000", "loss");
  const data = await host.fetchJson("/api/replay-signals").catch(() => null);
  const list = data?.matches ?? [];
  if (!list.length) return emit("no replay data available right now.", "loss");
  const m = arg ? list.find((x) => x.code.toLowerCase() === arg.toLowerCase() || x.fid === arg) : list[0];
  if (!m) return emit(`unknown match "${arg}". type 'matches' to list.`, "loss");
  emit(`replay ${m.teams} — ${m.count} signals — bankroll ${money(state.bankroll)}`, "sys");
  const s = newSession(state.bankroll);
  // merge goal-imminent alerts (high-danger pressure that preceded a goal) into the timeline
  const items = [
    ...m.signals.map((x) => ({ ts: x.ts, kind: "sig", sig: x })),
    ...(m.goalWatch ?? []).map((w) => ({ ts: w.ts, kind: "watch", w })),
  ].sort((a, b) => a.ts - b.ts);
  for (const it of items) {
    if (it.kind === "watch") {
      emit(`⚠ ${it.w.min}' goal watch: ${it.w.team} — high-danger pressure${it.w.pressure > 1 ? ` (x${it.w.pressure})` : ""}, watch the line`, "warn");
      await host.sleep(300);
      continue;
    }
    const sig = it.sig;
    const pos = openPosition(s, sig);
    if (pos.stake <= 0) { s.trades.pop(); s.seq -= 1; continue; }
    const mn = sig.minute != null ? Math.max(0, Math.round(sig.minute)) + "' " : "";
    emit(`${mn}${m.code}  buy ${sig.side.toUpperCase()} @ ${sig.entry.toFixed(3)}  fair ${sig.fair.toFixed(3)}  +${sig.gapPp.toFixed(0)}pp`, "sig");
    emit(`  paper fill ${Math.round(pos.shares).toLocaleString()} sh · stake ${money(pos.stake)} (Kelly ${(pos.f * 100).toFixed(0)}%)`, "fill");
    await host.sleep(650);
    const { exitPrice, reason } = replayExit(sig);
    settlePosition(s, pos, exitPrice, reason);
    const tag = reason === "converged" ? "converged, exit @ fair" : "no reach, marked out @ close";
    emit(`  ${tag} ${exitPrice.toFixed(3)} · PnL ${pen(money(pos.pnl))} · bankroll ${money(s.bankroll)}`, pos.pnl >= 0 ? "win" : "loss");
    await host.sleep(350);
  }
  const sum = summarize(s);
  emit(`— done · ${sum.trades} trades · ${sum.wins}W/${sum.losses}L · ROI ${pen(sum.roiPct.toFixed(1))}% · bankroll ${money(s.bankroll)}`, sum.roiPct >= 0 ? "win" : "loss");
}

async function doLive() {
  if (!state.bankroll) return emit("set a bankroll first, e.g.  bankroll 10000", "loss");
  const q = await host.fetchJson("/api/v1/divergences?status=live", state.apiKey).catch((e) => ({ __err: e?.status }));
  if (q?.__err === 401) {
    emit(state.apiKey ? "that key is invalid or expired." : "live is a paid feature.", "loss");
    emit(`  get a key at ${BASE}/api  —  $97.99 USDC / 30 days  ·  $699.99 USDC lifetime`, "sys");
    emit("  then:  load las_<key>", "muted");
    return;
  }
  if (!q || q.live === false || !(q.signals || []).length) return emit("no matches live right now — try:  replay", "muted");
  emit(`live: ${q.signals.length} open divergence(s) — paper bankroll ${money(state.bankroll)}`, "sys");
  const s = newSession(state.bankroll);
  for (const sig of q.signals) {
    const pos = openPosition(s, sig);
    if (pos.stake <= 0) { s.trades.pop(); s.seq -= 1; continue; }
    emit(`${sig.teams}  buy ${sig.side.toUpperCase()} @ ${sig.entry.toFixed(3)}  fair ${sig.fair.toFixed(3)}  +${sig.gapPp.toFixed(0)}pp`, "sig");
    emit(`  paper fill ${Math.round(pos.shares).toLocaleString()} sh · stake ${money(pos.stake)} (Kelly ${(pos.f * 100).toFixed(0)}%) · watching…`, "fill");
  }
}

async function handle(line) {
  const raw = line.trim(); if (!raw) return;
  const [cmd, ...rest] = raw.split(/\s+/); const arg = rest.join(" ");
  switch (cmd.toLowerCase()) {
    case "help": case "?": HELP.forEach((l) => emit(l, "muted")); return;
    case "bankroll": { const n = Number(arg.replace(/[$,\s]/g, "")); if (!Number.isFinite(n) || n <= 0) return emit("usage: bankroll 10000", "loss");
      state.bankroll = n; return emit(`bankroll ${money(n)} · sizing: Kelly (default, locked)`, "sys"); }
    case "load": { if (!/^las_/.test(arg)) return emit("usage: load las_<key>", "loss"); state.apiKey = arg; return emit(`key loaded (${arg.slice(0, 8)}…) · live unlocked`, "sys"); }
    case "matches": { const data = await host.fetchJson("/api/replay-signals").catch(() => null); const list = data?.matches ?? [];
      if (!list.length) return emit("no replay data available.", "loss"); emit("settled matches (code · signals):", "muted");
      list.forEach((m) => emit(`  ${m.code.padEnd(9)} ${m.teams}  ·  ${m.count} signals`, "sig")); return emit("run:  replay <code>", "muted"); }
    case "replay": return doReplay(arg);
    case "live": return doLive();
    case "clear": return emit("__clear__");
    case "exit": case "quit": rl.close(); return;
    default: return emit(`unknown command "${cmd}". type 'help'.`, "loss");
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: paint("lagisalpha> ", "prompt") });
[ "lagisalpha paper terminal — catch the lag, take the cheap side, Kelly-sized.",
  "paper only: fake bankroll, no real trades. type 'help' to begin." ].forEach((l) => emit(l, "muted"));
emit(`connected to ${BASE}`, "muted");
rl.prompt();

const queue = []; let processing = false, closed = false;
async function pump() {
  if (processing) return; processing = true;
  while (queue.length) { const line = queue.shift();
    try { await handle(line); } catch { emit("terminal error — try again", "loss"); }
    if (!closed) rl.prompt(); }
  processing = false; if (closed) { emit("bye.", "muted"); process.exit(0); }
}
rl.on("line", (line) => { queue.push(line); pump(); });
rl.on("close", () => { closed = true; if (!processing) { emit("bye.", "muted"); process.exit(0); } });
