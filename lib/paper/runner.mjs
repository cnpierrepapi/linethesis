// PAPER TERMINAL RUNNER — the command REPL + streaming, shared by the web terminal and the npx CLI.
// Host-agnostic: the caller passes a `host` with { base, fetchJson(path, key?), sleep(ms) } and an
// `emit(text, cls)` sink. `cls` is a style hint the host maps to colour (web = classNames, CLI = ANSI).
//
// Commands: help · bankroll <amount> · matches · replay <code|fid> · load <las_key> · live · clear.
// Sizing is Kelly, locked. No real order is ever placed.

import { newSession, openPosition, settlePosition, replayExit, summarize } from "./engine.mjs";

export const BANNER = [
  "lagisalpha paper terminal — catch the lag, take the cheap side, Kelly-sized.",
  "paper only: fake bankroll, no real trades. type 'help' to begin.",
];

export const HELP = [
  "commands:",
  "  bankroll <amount>   set your paper bankroll (Kelly sizing, locked)",
  "  matches             list the settled matches you can replay",
  "  replay <code|fid>   paper-trade a settled match (omit to pick the biggest)",
  "  load <las_key>      load your API key (needed for live)",
  "  live                paper-trade the live match, if one is in play",
  "  clear · help",
];

export function newState(base = "") {
  return { base, bankroll: null, apiKey: null };
}

const money = (n) => "$" + Math.round(n).toLocaleString();
const pen = (n) => (n >= 0 ? "+" : "") + n;

async function doReplay(state, arg, emit, host) {
  if (!state.bankroll) return emit("set a bankroll first, e.g.  bankroll 10000", "loss");
  const data = await host.fetchJson("/api/replay-signals").catch(() => null);
  const list = data?.matches ?? [];
  if (!list.length) return emit("no replay data available right now.", "loss");
  const m = arg
    ? list.find((x) => x.code.toLowerCase() === arg.toLowerCase() || x.fid === arg)
    : list[0];
  if (!m) return emit(`unknown match "${arg}". type 'matches' to list.`, "loss");

  emit(`replay ${m.teams} — ${m.count} signals — bankroll ${money(state.bankroll)}`, "sys");
  const s = newSession(state.bankroll);
  const ordered = [...m.signals].sort((a, b) => a.ts - b.ts);
  for (const sig of ordered) {
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

async function doLive(state, emit, host) {
  if (!state.bankroll) return emit("set a bankroll first, e.g.  bankroll 10000", "loss");
  const q = await host.fetchJson("/api/v1/divergences?status=live", state.apiKey).catch((e) => ({ __err: e?.status }));
  if (q?.__err === 401 || (q?.error && /key/i.test(q.message || q.error)))
    return emit("live needs an API key. load one:  load las_...   (or buy at /api)", "loss");
  if (!q || q.live === false || !(q.signals || []).length)
    return emit("no matches live right now — try:  replay", "muted");
  emit(`live: ${q.signals.length} open divergence(s) — paper bankroll ${money(state.bankroll)}`, "sys");
  const s = newSession(state.bankroll);
  for (const sig of q.signals) {
    const pos = openPosition(s, sig);
    if (pos.stake <= 0) { s.trades.pop(); s.seq -= 1; continue; }
    emit(`${sig.teams}  buy ${sig.side.toUpperCase()} @ ${sig.entry.toFixed(3)}  fair ${sig.fair.toFixed(3)}  +${sig.gapPp.toFixed(0)}pp`, "sig");
    emit(`  paper fill ${Math.round(pos.shares).toLocaleString()} sh · stake ${money(pos.stake)} (Kelly ${(pos.f * 100).toFixed(0)}%) · watching for convergence…`, "fill");
  }
}

export async function handle(state, line, emit, host) {
  const raw = line.trim();
  if (!raw) return;
  const [cmd, ...rest] = raw.split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase()) {
    case "help": case "?": HELP.forEach((l) => emit(l, "muted")); return;
    case "bankroll": {
      const n = Number(arg.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n <= 0) return emit("usage: bankroll 10000", "loss");
      state.bankroll = n; return emit(`bankroll ${money(n)} · sizing: Kelly (default, locked)`, "sys");
    }
    case "load": {
      if (!/^las_/.test(arg)) return emit("usage: load las_<key>", "loss");
      state.apiKey = arg; return emit(`key loaded (${arg.slice(0, 8)}…) · live unlocked`, "sys");
    }
    case "matches": {
      const data = await host.fetchJson("/api/replay-signals").catch(() => null);
      const list = data?.matches ?? [];
      if (!list.length) return emit("no replay data available.", "loss");
      emit("settled matches (code · signals):", "muted");
      list.forEach((m) => emit(`  ${m.code.padEnd(9)} ${m.teams}  ·  ${m.count} signals`, "sig"));
      emit("run:  replay <code>", "muted"); return;
    }
    case "replay": return doReplay(state, arg, emit, host);
    case "live": return doLive(state, emit, host);
    case "clear": return emit("__clear__", "control");
    default: return emit(`unknown command "${cmd}". type 'help'.`, "loss");
  }
}
