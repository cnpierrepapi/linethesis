// PAPER-TRADING ENGINE (signal-only, deterministic). No real order is ever placed: this simulates
// taking each divergence on a FAKE bankroll, sized by Kelly, entered at the market and exited at TxLINE
// fair when the market converges. Written in plain JS (like the other deterministic cores) so both the
// Next app and the node test can drive it, and so the web terminal, the npx CLI, and the Telegram bot
// all share ONE engine.
//
// The model (Polymarket share convention): buy the cheap side at price `entry` (0..1); each share pays
// $1 if the side wins. Stake s buys s/entry shares. Take profit at `fair`: the shares are now worth
// `fair` each, so PnL = shares*fair - s = s*(fair-entry)/entry. Kelly fraction f = gap/(1-entry) is the
// optimal stake fraction for a binary bet at price `entry` with true prob `fair`.
//
// NOTE ON /proof PARITY: this is honest per-fill share math (what a real Polymarket fill would return),
// so it is DIRECTIONALLY aligned with the published kellyRoi but not identical to that headline number,
// which compounds over the box's own entry set and return convention (compute_edge.py). Reconciling the
// two exactly is a deliberate follow-up; do not assume paper ROI == the /proof headline.
//
// #6 Kelly sizing is the DEFAULT and the only mode (locked for now). #7 position lifecycle:
// open -> converged (exit at fair) | marked_out (exit at close) . #8 the session is the bankroll + PnL
// ledger. #9 replaySession / liveStep are the two adapters over the same core.

const CENTS = (n) => Math.round(n * 100) / 100;

// Max fraction of free balance any single Kelly call may stake. MUST match KELLY_CAP in
// lib/signals/policy.ts (mirrored here because this is runtime JS the node test loads without the TS).
export const KELLY_CAP = 0.3;

/** Kelly fraction, capped at KELLY_CAP. gap and entry in the bought side's frame. */
export function kellyFraction(fair, entry) {
  const gap = fair - entry;
  if (gap <= 0 || entry <= 0 || entry >= 1) return 0;
  return Math.min(KELLY_CAP, Math.max(0, gap / (1 - entry)));
}

/** A fresh paper session on a fake bankroll. */
export function newSession(bankroll) {
  const b = Number(bankroll);
  if (!Number.isFinite(b) || b <= 0) throw new Error("bankroll must be a positive number");
  return { bankroll0: b, bankroll: b, realizedPnl: 0, openStake: 0, trades: [], seq: 0 };
}

/** Cash not tied up in open positions. */
export function availableCash(session) {
  return CENTS(session.bankroll - session.openStake);
}

/**
 * Open a paper position from a signal, Kelly-sized on available cash. Returns the position (also pushed
 * onto the session as status "open"). Sizing is locked to Kelly; f comes from the signal when present.
 */
export function openPosition(session, signal) {
  const entry = signal.entry;
  // Cap at point-of-use too: even if a signal arrives with an uncapped suggestedKellyF, no single
  // paper trade stakes more than KELLY_CAP of the free balance.
  const f = Math.min(KELLY_CAP, Number.isFinite(signal.suggestedKellyF) ? signal.suggestedKellyF : kellyFraction(signal.fair, entry));
  // Kelly applies to the FREE balance at entry time, not the starting bankroll: live entries arrive
  // sequentially while earlier ones are still open, so each new call sizes off what is actually left
  // (f<=1 keeps stake <= availableCash by construction; the account can never be fully drained).
  const stake = CENTS(availableCash(session) * f);
  const shares = stake > 0 && entry > 0 ? stake / entry : 0;
  const pos = {
    id: ++session.seq,
    fid: signal.fid,
    teams: signal.teams,
    side: signal.side,
    entry,
    fair: signal.fair,
    tpTarget: signal.tpTarget ?? signal.fair,
    gapPp: signal.gapPp,
    f: CENTS(f),
    stake,
    shares,
    ts: signal.ts,
    status: "open",
    exitPrice: null,
    exitReason: null,
    pnl: 0,
  };
  session.openStake = CENTS(session.openStake + stake);
  session.trades.push(pos);
  return pos;
}

/**
 * Settle an open position at `exitPrice` (the side's price you exit at). reason: "converged" (hit fair)
 * or "marked_out" (match closed before reaching fair). Updates the session bankroll + realized PnL.
 */
export function settlePosition(session, pos, exitPrice, reason) {
  if (pos.status !== "open") return pos;
  const px = Math.max(0, Math.min(1, Number(exitPrice)));
  const pnl = CENTS(pos.shares * px - pos.stake);
  pos.exitPrice = px;
  pos.exitReason = reason;
  pos.pnl = pnl;
  pos.status = "closed";
  session.openStake = CENTS(session.openStake - pos.stake);
  session.realizedPnl = CENTS(session.realizedPnl + pnl);
  session.bankroll = CENTS(session.bankroll + pnl);
  return pos;
}

/** The exit a REPLAY signal resolves to: fair on reach, else the closing price (entry + clv), else flat. */
export function replayExit(signal) {
  if (signal.reached) return { exitPrice: signal.tpTarget ?? signal.fair, reason: "converged" };
  const close = Number.isFinite(signal.clv) ? signal.entry + signal.clv : signal.entry;
  return { exitPrice: close, reason: "marked_out" };
}

/**
 * #9 REPLAY adapter. Run a whole match's signals in time order, each opened on the compounding bankroll
 * and immediately settled from its known outcome. Returns the finished session plus a summary.
 */
export function replaySession(bankroll, signals) {
  const session = newSession(bankroll);
  const ordered = [...signals].sort((a, b) => a.ts - b.ts);
  for (const sig of ordered) {
    const pos = openPosition(session, sig);
    if (pos.stake <= 0) {
      // nothing to stake (no edge / no cash); drop the empty position
      session.trades.pop();
      session.seq -= 1;
      session.openStake = CENTS(session.openStake - pos.stake);
      continue;
    }
    const { exitPrice, reason } = replayExit(sig);
    settlePosition(session, pos, exitPrice, reason);
  }
  return { ...session, summary: summarize(session) };
}

/**
 * #9 LIVE adapter step. Given the current open positions and the latest live view, open new positions
 * for fresh signals and settle any open one whose side price reached fair (converged). Fixtures that
 * dropped out of `liveFids` are marked out at their last seen price. `priceFor(fid)` returns the current
 * side price for an open position (from the live fair/market stream); the Phase-3 driver supplies it.
 */
export function liveStep(session, liveSignals, liveFids, priceFor) {
  const openByFid = new Set(session.trades.filter((t) => t.status === "open").map((t) => t.fid));
  // open new
  for (const sig of liveSignals) {
    if (openByFid.has(sig.fid)) continue; // one open position per fixture
    const pos = openPosition(session, sig);
    if (pos.stake <= 0) { session.trades.pop(); session.seq -= 1; session.openStake = CENTS(session.openStake - pos.stake); continue; }
    openByFid.add(sig.fid);
  }
  // settle converged / dropped
  for (const pos of session.trades) {
    if (pos.status !== "open") continue;
    const px = priceFor(pos.fid);
    if (Number.isFinite(px) && px >= pos.tpTarget) settlePosition(session, pos, pos.tpTarget, "converged");
    else if (!liveFids.has(pos.fid)) settlePosition(session, pos, Number.isFinite(px) ? px : pos.entry, "marked_out");
  }
  return session;
}

/** Session summary: PnL, ROI, win rate, counts. */
export function summarize(session) {
  const closed = session.trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  return {
    bankroll0: session.bankroll0,
    bankroll: session.bankroll,
    realizedPnl: session.realizedPnl,
    roiPct: CENTS(((session.bankroll - session.bankroll0) / session.bankroll0) * 100),
    trades: closed.length,
    open: session.trades.length - closed.length,
    wins,
    losses: closed.length - wins,
    winRatePct: closed.length ? Math.round((wins / closed.length) * 100) : 0,
  };
}
