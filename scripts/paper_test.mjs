// Tests for the paper-trading engine (lib/paper/engine.mjs). Proves the Kelly sizing, the converged /
// marked-out lifecycle, compounding, and the bankroll ledger invariants.
import {
  kellyFraction, newSession, openPosition, settlePosition, replayExit, replaySession, replayTimeline, summarize, availableCash,
} from "../lib/paper/engine.mjs";

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name); } }
function near(a, b, eps = 0.02) { return Math.abs(a - b) <= eps; }

// Kelly fraction: gap/(1-entry), capped at KELLY_CAP (0.3)
ok("kelly formula 0.60/0.50 = 0.20 (under cap)", near(kellyFraction(0.60, 0.50), 0.20));
ok("kelly no edge -> 0", kellyFraction(0.80, 0.85) === 0);
ok("kelly caps at 0.30 (0.90/0.82 would be 0.444)", near(kellyFraction(0.90, 0.82), 0.30));
ok("kelly never exceeds the cap", kellyFraction(0.99, 0.5) === 0.30);

// A single converged winning trade: return on stake = (fair-entry)/entry
{
  const s = newSession(10000);
  const sig = { fid: "1", teams: "A v B", side: "yes", entry: 0.82, fair: 0.90, tpTarget: 0.90, gapPp: 8, suggestedKellyF: kellyFraction(0.90, 0.82), ts: 1, reached: true };
  const pos = openPosition(s, sig);
  const { exitPrice, reason } = replayExit(sig);
  settlePosition(s, pos, exitPrice, reason);
  ok("converged trade is profitable", pos.pnl > 0);
  ok("exit at fair", pos.exitPrice === 0.90 && pos.exitReason === "converged");
  ok("PnL = stake*(fair-entry)/entry", near(pos.pnl, pos.stake * (0.90 - 0.82) / 0.82, 0.5));
  ok("bankroll = 10000 + pnl", near(s.bankroll, 10000 + pos.pnl));
  ok("openStake returns to 0", availableCash(s) === s.bankroll);
}

// A marked-out losing trade: no reach, close below entry (negative clv)
{
  const s = newSession(10000);
  const sig = { fid: "2", teams: "C v D", side: "yes", entry: 0.50, fair: 0.60, tpTarget: 0.60, gapPp: 10, suggestedKellyF: kellyFraction(0.60, 0.50), ts: 1, reached: false, clv: -0.05 };
  const pos = openPosition(s, sig);
  const { exitPrice, reason } = replayExit(sig);
  settlePosition(s, pos, exitPrice, reason);
  ok("marked_out reason", pos.exitReason === "marked_out");
  ok("marked-out below entry loses", pos.pnl < 0 && s.bankroll < 10000);
}

// No-reach with no clv -> flat (exit at entry)
{
  const s = newSession(10000);
  const sig = { fid: "3", teams: "E v F", side: "no", entry: 0.40, fair: 0.55, tpTarget: 0.55, gapPp: 15, suggestedKellyF: kellyFraction(0.55, 0.40), ts: 1, reached: false };
  const pos = openPosition(s, sig);
  const { exitPrice, reason } = replayExit(sig);
  settlePosition(s, pos, exitPrice, reason);
  ok("no-reach no-clv is flat", near(pos.pnl, 0));
}

// replaySession: compounding across two winners + ledger invariants
{
  const sigs = [
    { fid: "1", teams: "A v B", side: "yes", entry: 0.80, fair: 0.88, tpTarget: 0.88, gapPp: 8, suggestedKellyF: kellyFraction(0.88, 0.80), ts: 2, reached: true },
    { fid: "2", teams: "C v D", side: "yes", entry: 0.60, fair: 0.70, tpTarget: 0.70, gapPp: 10, suggestedKellyF: kellyFraction(0.70, 0.60), ts: 1, reached: true },
  ];
  const r = replaySession(10000, sigs);
  ok("replay processes in ts order", r.trades[0].fid === "2");
  ok("compounded bankroll > start", r.bankroll > 10000);
  ok("realizedPnl == bankroll - start", near(r.realizedPnl, r.bankroll - 10000));
  ok("summary roi matches", near(r.summary.roiPct, (r.bankroll - 10000) / 10000 * 100));
  ok("all trades closed", r.summary.open === 0 && r.summary.trades === 2);
  ok("two wins", r.summary.wins === 2 && r.summary.winRatePct === 100);
}

// replayTimeline: a later entry sizes on FREE balance while an earlier position is still open, and
// exits land on the real clock (exitFill.t), not immediately. Mirrors the user's worked example.
{
  const sigs = [
    // entry1 @15: Kelly 20% of 1000 = 200; exits LATER at t=32 (still open when entry2 fires)
    { fid: "1", teams: "A v B", side: "no", entry: 0.50, fair: 0.60, tpTarget: 0.60, gapPp: 10, suggestedKellyF: 0.20, ts: 15, reached: true, exitFill: { t: 32, price: 0.60, tx: "0xexit1" } },
    // entry2 @20: fires while #1 is open → 15% of the FREE 800 = 120 (NOT 15% of 1000)
    { fid: "2", teams: "C v D", side: "no", entry: 0.50, fair: 0.575, tpTarget: 0.575, gapPp: 7.5, suggestedKellyF: 0.15, ts: 20, reached: true, exitFill: { t: 40, price: 0.575, tx: "0xexit2" } },
  ];
  const { feed, session, summary } = replayTimeline(1000, sigs, 9999);
  const e2 = feed.find((f) => f.kind === "entry" && f.sig.fid === "2");
  ok("later entry sizes on FREE balance (120, not 156)", near(e2.pos.stake, 120, 0.5));
  const kinds = feed.filter((f) => f.kind === "entry" || f.kind === "exit").map((f) => f.kind + f.sig.fid);
  ok("timeline order: both entries before either exit", kinds.join(",") === "entry1,entry2,exit1,exit2");
  ok("exit carries the real exit tx", feed.find((f) => f.kind === "exit" && f.sig.fid === "1").sig.exitFill.tx === "0xexit1");
  ok("both positions closed, bankroll compounded", summary.open === 0 && session.bankroll > 1000);
  ok("free balance restored to full bankroll at end", near(availableCash(session), session.bankroll));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} paper: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
