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
// REAL-CLOCK replay (mirror of lib/paper/engine.mjs replayTimeline): a position stays OPEN from entry
// (sig.ts) to its real exit — the exit fill's ts on reach, else the match close (matchFt) — so a later
// entry sizes Kelly on the FREE balance while earlier positions are open. Returns the ordered feed.
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
      settlePosition(session, pos, exitPrice, reason);
      feed.push({ kind: "exit", sig: ev.sig, pos, bankroll: session.bankroll });
    } else feed.push({ kind: ev.kind, data: ev.data });
  }
  return { session, feed, summary: summarize(session) };
}
const EXPLORER = (tx) => `https://polygonscan.com/tx/${tx}`;
function summarize(s) {
  const closed = s.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  return { trades: closed.length, wins, losses: closed.length - wins,
    bankroll: s.bankroll, bankroll0: s.bankroll0,
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
// bankroll = the original stake (for "started $X"); balance = the TRAILING balance that persists across
// replays and into live (mirrors the Telegram bot's c.balance), so runs compound instead of resetting.
const state = { bankroll: null, balance: null, apiKey: null, session: null, seen: {}, liveOn: false, liveTimer: null, ticking: false };
function emit(text, cls = "sig") { if (text === "__clear__") { console.clear(); return; } console.log(paint(text, cls)); }
const HELP = [
  "commands:",
  "  bankroll [amount]   set the paper bankroll, or show the trailing balance (persists across replays + into live)",
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
  const start = state.balance ?? state.bankroll; // run from the TRAILING balance so replays compound
  emit(`replay ${m.teams} — ${m.count} signals — bankroll ${money(start)}`, "sys");
  // one real-clock timeline: entries open and stay open, exits land at the exit fill's ts (or the close
  // for a mark-out), goal-watch + winner-hint merged in by ts. A later entry sizes on the free balance.
  const overlays = [
    ...(m.goalWatch ?? []).map((w) => ({ ts: w.ts, kind: "watch", ...w })),
    ...(m.winnerHint ? [{ ts: m.winnerHint.ts ?? Infinity, kind: "winner", ...m.winnerHint }] : []),
  ];
  const { feed, summary } = replayTimeline(start, m.signals, m.ft, overlays);
  for (const ev of feed) {
    if (ev.kind === "watch") { emit(`⚠ ${ev.data.min}' goal watch: ${ev.data.team} — high-danger pressure${ev.data.pressure > 1 ? ` (x${ev.data.pressure})` : ""}, watch the line`, "warn"); await host.sleep(250); continue; }
    if (ev.kind === "winner") { emit(winnerHintText(ev.data), "warn"); await host.sleep(250); continue; }
    if (ev.kind === "entry") {
      const sig = ev.sig;
      const mn = sig.minute != null ? Math.max(0, Math.round(sig.minute)) + "' " : "";
      emit(`${mn}${m.code}  ${teamOf(sig)}'s side cheap @ ${sig.entry.toFixed(3)} -> fair ${sig.fair.toFixed(3)}  (+${sig.gapPp.toFixed(0)}pp to converge)`, "sig");
      if (sig.entryFill?.tx) emit(`  entry fill @ ${sig.entry.toFixed(3)} · verify ${EXPLORER(sig.entryFill.tx)}`, "muted");
      if (ev.pos) emit(`  paper fill ${Math.round(ev.pos.shares).toLocaleString()} sh · stake ${money(ev.pos.stake)} (Kelly ${(ev.pos.f * 100).toFixed(0)}% of free ${money(ev.free + ev.pos.stake)}) · watching…`, "fill");
      else emit("  (no paper fill — balance fully committed to open positions)", "muted");
      await host.sleep(400);
      continue;
    }
    if (ev.kind === "exit") {
      const sig = ev.sig, pos = ev.pos;
      const tag = pos.exitReason === "converged" ? "converged, exit @ fair" : "no reach, marked out @ close";
      emit(`  ${teamOf(sig)}  ${tag} ${pos.exitPrice.toFixed(3)} · PnL ${pen(money(pos.pnl))} · balance ${money(ev.bankroll)}`, pos.pnl >= 0 ? "win" : "loss");
      if (sig.reached && sig.exitFill?.tx) emit(`  exit fill @ ${(sig.exitFill.price ?? pos.exitPrice).toFixed(3)}${Number.isFinite(sig.exitFill.gapPp) ? ` (+${sig.exitFill.gapPp}pp past fair)` : ""} · verify ${EXPLORER(sig.exitFill.tx)}`, "muted");
      await host.sleep(300);
      continue;
    }
  }
  state.balance = summary.bankroll; // persist the ending balance as the new trailing balance
  emit(`— done · ${summary.trades} trades · ${summary.wins}W/${summary.losses}L · ROI ${pen(summary.roiPct.toFixed(1))}% · balance ${money(start)} -> ${money(summary.bankroll)}`, summary.roiPct >= 0 ? "win" : "loss");
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
        state.session ||= newSession(state.balance ?? state.bankroll); // live continues from the trailing balance
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
            if (px >= pos.tpTarget - 1e-6) { settlePosition(s, pos, pos.tpTarget, "converged"); state.balance = s.bankroll; say(exitText(pos), pos.pnl >= 0 ? "win" : "loss"); }
          } else if ((pos.misses = (pos.misses ?? 0) + 1) >= MARKOUT_MISSES) {
            settlePosition(s, pos, pos.lastPx ?? pos.entry, "marked_out"); state.balance = s.bankroll;
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
    const bal = state.balance ?? state.bankroll;
    const balTxt = bal != null ? `balance ${money(bal)}${state.bankroll != null && state.bankroll !== bal ? ` (started ${money(state.bankroll)})` : ""}` : "no bankroll (set one: bankroll 10000)";
    emit(`${balTxt} · no open positions · key ${state.apiKey ? "loaded" : "none"} · watch ${state.liveOn ? "on" : "off"}`, "sys");
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
    case "bankroll": {
      if (!arg.trim()) { // no amount → SHOW the trailing balance (persists across replays + into live)
        if (state.balance == null) return emit("no bankroll set. usage: bankroll 10000", "loss");
        const parts = [`balance ${money(state.balance)} (started ${money(state.bankroll ?? state.balance)})`];
        const s = state.session; if (s && s.openStake > 0) parts.push(`free ${money(state.balance - s.openStake)} · ${money(s.openStake)} in open positions`);
        return emit(parts.join(" · "), "sys");
      }
      const n = Number(arg.replace(/[$,\s]/g, "")); if (!Number.isFinite(n) || n <= 0) return emit("usage: bankroll 10000", "loss");
      const hadOpen = state.session?.trades?.some((t) => t.status === "open");
      state.bankroll = n; state.balance = n; state.session = null; state.seen = {};
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
