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
// which team's side is cheap (yes = second team, no = first). A label for WHICH price is underpriced,
// not a bet on who wins: the trade is the price converging to TxLINE fair.
const teamOf = (sig) => sig.team || (sig.teams || "").split(/\s+v\s+/i)[sig.side === "yes" ? 1 : 0]?.trim() || sig.side.toUpperCase();
// volume-to-divergence winner hint (pilot n=12, in-sample): the side with more real money per point of
// divergence tends to win. A late, directional read, kept caveated.
function winnerHintText(h) {
  const x = h.margin != null && Number.isFinite(h.margin) ? `${h.margin.toFixed(1)}x` : "far";
  const mn = h.atMin != null ? `${h.atMin}' ` : "";
  return `🏆 ${mn}likely winner: ${h.teamName} — volume-per-divergence ${x} ahead (pilot n=12, in-sample)`;
}
const host = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async fetchJson(path, key) {
    const res = await fetch(BASE + path, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
    let body = {}; try { body = await res.json(); } catch { /* ignore */ }
    return res.ok ? body : { __err: res.status, ...body };
  },
};

// ── REPL ─────────────────────────────────────────────────────────────────────────────────────────
const state = { bankroll: null, apiKey: null, session: null, seen: {}, liveOn: false, liveTimer: null, ticking: false };
function emit(text, cls = "sig") { if (text === "__clear__") { console.clear(); return; } console.log(paint(text, cls)); }
const HELP = [
  "commands:",
  "  bankroll <amount>   set your paper bankroll (Kelly sizing, locked; resets the live session)",
  "  matches             list the settled matches you can replay",
  "  replay <code|fid>   paper-trade a settled match (omit to pick the biggest)",
  "  load <las_key>      load your API key (needed for live)",
  "  live                watch the live feed: paper-fill each divergence, close at fair on convergence",
  "  stop                stop the live watch (open positions stay; 'live' resumes)",
  "  status              balance, free cash, realized PnL, open positions",
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
  // merge goal-imminent alerts (high-danger pressure that preceded a goal) and the volume-to-divergence
  // winner hint (a late, directional read on the match winner) into the timeline
  const items = [
    ...m.signals.map((x) => ({ ts: x.ts, kind: "sig", sig: x })),
    ...(m.goalWatch ?? []).map((w) => ({ ts: w.ts, kind: "watch", w })),
    ...(m.winnerHint ? [{ ts: m.winnerHint.ts ?? Infinity, kind: "winner", h: m.winnerHint }] : []),
  ].sort((a, b) => a.ts - b.ts);
  for (const it of items) {
    if (it.kind === "watch") {
      emit(`⚠ ${it.w.min}' goal watch: ${it.w.team} — high-danger pressure${it.w.pressure > 1 ? ` (x${it.w.pressure})` : ""}, watch the line`, "warn");
      await host.sleep(300);
      continue;
    }
    if (it.kind === "winner") {
      emit(winnerHintText(it.h), "warn");
      await host.sleep(300);
      continue;
    }
    const sig = it.sig;
    const pos = openPosition(s, sig);
    if (pos.stake <= 0) { s.trades.pop(); s.seq -= 1; continue; }
    const mn = sig.minute != null ? Math.max(0, Math.round(sig.minute)) + "' " : "";
    emit(`${mn}${m.code}  ${teamOf(sig)}'s side cheap @ ${sig.entry.toFixed(3)} -> fair ${sig.fair.toFixed(3)}  (+${sig.gapPp.toFixed(0)}pp to converge)`, "sig");
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

// ── live watch loop (mirrors the Telegram bot's watcher) ────────────────────────────────────────
// Entries: /api/v1/divergences?status=live (gated), deduped per divergence EPISODE (fid:side, cleared
// when it leaves the list, so a fresh dislocation re-arms). Exits: /api/live-edge (ungated, current
// pm + fair for every live fixture) — converged when the bought side's price reaches the entry-time
// tpTarget (exit AT target, the backtest's "reached" rule); marked out at the last seen price once the
// fixture has been gone from a fresh feed for ~20 min (rides out halftime).
const LIVE_POLL_MS = 20000;
const EDGE_STALE_MS = 10 * 60 * 1000;
const MARKOUT_MISSES = 60;

function exitText(pos) {
  const tag = pos.exitReason === "converged" ? "converged, exit @ fair" : "match over, marked out @ close";
  return `${teamOf(pos)}  ${tag} ${pos.exitPrice.toFixed(3)} · PnL ${pen(money(pos.pnl))} · balance ${money(state.session.bankroll)}`;
}

async function liveTick() {
  if (state.ticking) return; state.ticking = true;
  let printed = false;
  const say = (t, c) => { emit(t, c); printed = true; };
  try {
    const q = await host.fetchJson("/api/v1/divergences?status=live", state.apiKey).catch(() => null);
    if (q?.__err === 401) {
      say(state.apiKey ? "your key is invalid or expired — live watch off." : "live is a paid feature — watch off.", "loss");
      say(`  get a key at ${BASE}/api  —  $97.99 USDC / 30 days  ·  $699.99 USDC lifetime  · then:  load las_<key>`, "sys");
      stopLive(false);
      return;
    }
    if (q) {
      const sigs = q.live === false ? [] : (q.signals ?? []);
      const active = new Set(sigs.map((x) => `${x.fid}:${x.side}`));
      for (const k of Object.keys(state.seen)) if (!active.has(k)) delete state.seen[k];
      for (const sig of sigs) {
        const id = `${sig.fid}:${sig.side}`;
        if (state.seen[id]) continue;
        state.seen[id] = 1;
        state.session ||= newSession(state.bankroll);
        const pos = openPosition(state.session, sig);
        say(`${sig.teams}  ${teamOf(sig)}'s side cheap @ ${sig.entry.toFixed(3)} -> fair ${sig.fair.toFixed(3)}  (+${sig.gapPp.toFixed(0)}pp to converge)`, "sig");
        if (pos.stake > 0) say(`  paper fill ${Math.round(pos.shares).toLocaleString()} sh · stake ${money(pos.stake)} (Kelly ${(pos.f * 100).toFixed(0)}% of free ${money(availableCash(state.session) + pos.stake)}) · watching…`, "fill");
        else { state.session.trades.pop(); state.session.seq -= 1; say("  (no paper fill — balance fully committed to open positions)", "muted"); }
      }
      if (q.winnerHint) {
        const id = `wh:${q.winnerHint.fid}`;
        if (!state.seen[id]) { state.seen[id] = 1; say(winnerHintText(q.winnerHint), "warn"); }
      }
    }
    // settle open positions against the live edge snapshot
    const s = state.session;
    const open = s ? s.trades.filter((t) => t.status === "open") : [];
    if (open.length) {
      const edge = await host.fetchJson("/api/live-edge").catch(() => null);
      const fresh = edge && !edge.__err && Number.isFinite(edge.generatedAt) && Date.now() - edge.generatedAt < EDGE_STALE_MS;
      if (fresh) {
        const byFid = new Map((edge.signals ?? []).map((x) => [String(x.fid), x]));
        for (const pos of open) {
          const lv = byFid.get(String(pos.fid)) ?? (edge.signals ?? []).find((x) => x.teams === pos.teams);
          if (lv) {
            const px = pos.side === "yes" ? lv.pm : 1 - lv.pm;
            if (!Number.isFinite(px)) continue;
            pos.lastPx = px; pos.misses = 0;
            if (px >= pos.tpTarget - 1e-6) { settlePosition(s, pos, pos.tpTarget, "converged"); say(exitText(pos), pos.pnl >= 0 ? "win" : "loss"); }
          } else if ((pos.misses = (pos.misses ?? 0) + 1) >= MARKOUT_MISSES) {
            settlePosition(s, pos, pos.lastPx ?? pos.entry, "marked_out");
            say(exitText(pos), pos.pnl >= 0 ? "win" : "loss");
          }
        }
      }
    }
  } catch { /* transient network error — next tick retries */ }
  finally {
    state.ticking = false;
    if (printed && !closed) rl.prompt(true);
  }
}

function stopLive(announce = true) {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null; state.liveOn = false;
  if (announce) {
    const open = state.session ? state.session.trades.filter((t) => t.status === "open").length : 0;
    emit(`live watch OFF${open ? ` · ${open} position(s) still open — 'live' resumes watching them` : ""}`, "sys");
  }
}

async function doLive() {
  if (!state.bankroll) return emit("set a bankroll first, e.g.  bankroll 10000", "loss");
  if (state.liveOn) return emit("live watch already on — type 'stop' to end.", "muted");
  state.liveOn = true;
  emit(`live watch ON — polling every ${LIVE_POLL_MS / 1000}s: paper fill on each divergence, close at fair on convergence. type 'stop' to end.`, "sys");
  await liveTick();
  if (state.liveOn) state.liveTimer = setInterval(liveTick, LIVE_POLL_MS); // first tick may have turned it off (401)
}

function doStatus() {
  const s = state.session;
  if (!s) {
    emit(`bankroll ${state.bankroll ? money(state.bankroll) : "— (set one: bankroll 10000)"} · no live session yet · key ${state.apiKey ? "loaded" : "none"} · watch ${state.liveOn ? "on" : "off"}`, "sys");
    return;
  }
  const open = s.trades.filter((t) => t.status === "open");
  const sum = summarize(s);
  emit(`balance ${money(s.bankroll)} (started ${money(s.bankroll0)}) · free ${money(availableCash(s))} · realized PnL ${pen(money(s.realizedPnl))} · ${sum.trades} closed (${sum.wins}W/${sum.losses}L) · watch ${state.liveOn ? "on" : "off"}`, "sys");
  for (const p of open) emit(`  open: ${teamOf(p)} @ ${p.entry.toFixed(3)} -> ${p.tpTarget.toFixed(3)} · stake ${money(p.stake)} (${p.teams})`, "fill");
}

async function handle(line) {
  const raw = line.trim(); if (!raw) return;
  const [cmd, ...rest] = raw.split(/\s+/); const arg = rest.join(" ");
  switch (cmd.toLowerCase()) {
    case "help": case "?": HELP.forEach((l) => emit(l, "muted")); return;
    case "bankroll": { const n = Number(arg.replace(/[$,\s]/g, "")); if (!Number.isFinite(n) || n <= 0) return emit("usage: bankroll 10000", "loss");
      const hadOpen = state.session?.trades?.some((t) => t.status === "open");
      state.bankroll = n; state.session = null; state.seen = {};
      return emit(`bankroll ${money(n)} · sizing: Kelly (default, locked)${hadOpen ? " · previous session (incl. open positions) cleared" : ""}`, "sys"); }
    case "load": { if (!/^las_/.test(arg)) return emit("usage: load las_<key>", "loss"); state.apiKey = arg; return emit(`key loaded (${arg.slice(0, 8)}…) · live unlocked`, "sys"); }
    case "status": return doStatus();
    case "stop": return state.liveOn ? stopLive() : emit("live watch is not on.", "muted");
    case "matches": { const data = await host.fetchJson("/api/replay-signals").catch(() => null); const list = data?.matches ?? [];
      if (!list.length) return emit("no replay data available.", "loss"); emit("settled matches (code · signals):", "muted");
      list.forEach((m) => emit(`  ${m.code.padEnd(9)} ${m.teams}  ·  ${m.count} signals`, "sig")); return emit("run:  replay <code>", "muted"); }
    case "replay": return doReplay(arg);
    case "live": return doLive();
    case "clear": return emit("__clear__");
    case "exit": case "quit": stopLive(false); rl.close(); return;
    default: return emit(`unknown command "${cmd}". type 'help'.`, "loss");
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: paint("lagisalpha> ", "prompt") });
[ "lagisalpha paper terminal — catch the lag, take the cheap side, Kelly-sized.",
  "each call = a team's price converging to TxLINE fair, not a bet on who wins.",
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
rl.on("close", () => { closed = true; stopLive(false); if (!processing) { emit("bye.", "muted"); process.exit(0); } });
