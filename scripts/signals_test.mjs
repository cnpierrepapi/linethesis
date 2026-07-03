// Deterministic unit tests for the read-only signal classifier (lib/signals/classify.mjs).
// Run: node scripts/signals_test.mjs
// Every assertion is a fixed input → fixed output; no clock, no randomness, no I/O.

import { classifyEdge, pregoalWarning, parseLine, _internal } from "../lib/signals/classify.mjs";
import { classifyEdge as sdkClassifyEdge } from "../sdk/index.mjs";
import { settleCLV, resolveGoalsOutcome } from "../lib/signals/settle.mjs";
import { calibrate } from "../lib/signals/calibration.mjs";
import { _internal as reel } from "../lib/signals/proof-reel.mjs";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// A canonical engine edge (as emitted by lib/edge/engine.mjs).
function edge(over = {}) {
  return {
    id: "edge_1",
    kind: "steam",
    market: {
      fixtureId: 18172469,
      superOddsType: "OVERUNDER_PARTICIPANT_GOALS",
      marketParameters: "line=2.5",
      marketPeriod: "null",
      side: "over",
      inRunning: true,
    },
    edgeMeasure: 0.06,
    fairProb: 0.5,
    direction: "back",
    openedAt: 1000,
    note: "test",
    ...over,
  };
}

console.log("\n── parseLine ──");
check("parses O/U line", parseLine("line=2.5") === 2.5);
check("parses negative AH line", parseLine("line=-0.75") === -0.75);
check("null when no line", parseLine("half=1") === null);

console.log("\n── kind mapping / product scope ──");
check("steam edge → steam signal", classifyEdge(edge()).kind === "steam");
check("quote edge → null (not in product)", classifyEdge(edge({ kind: "quote" })) === null);
check("undefined edge → null", classifyEdge(undefined) === null);
check(
  "1X2 market → null (out of on-chain-settleable scope)",
  classifyEdge(edge({ market: { ...edge().market, superOddsType: "1X2_PARTICIPANT_RESULT" } })) === null,
);
check(
  "AH goals market → classified (in scope)",
  classifyEdge(edge({ market: { ...edge().market, superOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS" } })) !== null,
);

console.log("\n── steam ⇒ follow ──");
{
  const s = classifyEdge(edge({ kind: "steam" }), { minute: 30 });
  check("steam action = follow", s.action === "follow", s.action);
  check("steam revertLikely = false", s.revertLikely === false);
  check("carries line + market", s.line === 2.5 && s.market.includes("OVERUNDER"));
  check("minute passed through", s.minute === 30);
}

console.log("\n── overreaction ⇒ hold (default-to-safe) vs fade (confident) ──");
{
  // small swing at threshold → low confidence → HOLD
  const lo = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.08 }));
  check("small overreaction → hold", lo.action === "hold", `${lo.action} conf=${lo.confidence}`);
  check("overreaction revertLikely = true", lo.revertLikely === true);
  // big swing (2× threshold) → confidence ~1 → FADE
  const hi = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.16 }));
  check("large overreaction → fade", hi.action === "fade", `${hi.action} conf=${hi.confidence}`);
  check("confidence monotonic in magnitude", hi.confidence > lo.confidence);
  check("confidence bounded [0,1]", hi.confidence <= 1 && lo.confidence >= 0);
}

console.log("\n── surprise conditioning (firedBy) ──");
{
  const noSurprise = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.08 }));
  check("no preEventProb → firedBy magnitude", noSurprise.firedBy === "magnitude");
  check("no preEventProb → surprise null", noSurprise.surprise === null);
  // A big scoreline jump (0.5 → 0.7 = 20pp > SURPRISE_NORM) = maximal surprise → escalates hold→fade.
  const surprising = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.08, fairProb: 0.7, preEventProb: 0.5 }));
  check("preEventProb → firedBy surprise", surprising.firedBy === "surprise");
  check("high surprise lifts confidence over pure magnitude", surprising.confidence > noSurprise.confidence);
  check("surprising goal escalates to fade", surprising.action === "fade", `${surprising.action} conf=${surprising.confidence}`);
}

console.log("\n── gapBps + pickoff risk (needs the operator's price) ──");
{
  const noBook = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.16 }));
  check("no watchedProb → gapBps null", noBook.gapBps === null);
  check("no book → pickoffRisk from move (high on overreaction)", noBook.pickoffRisk === "high");
  // operator line still at 0.55 while reference is 0.50 → +500 bps stale
  const withBook = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.06, fairProb: 0.5 }), { watchedProb: 0.55 });
  check("gapBps signed = +500", withBook.gapBps === 500, String(withBook.gapBps));
  check("large gap → pickoffRisk high", withBook.pickoffRisk === "high");
  const tight = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.06, fairProb: 0.5 }), { watchedProb: 0.503 });
  check("tiny gap on steam → pickoffRisk low", tight.pickoffRisk === "low", tight.pickoffRisk);
}

console.log("\n── pregoal warning (momentum tape) ──");
{
  const hd = pregoalWarning({ FixtureId: 1, Ts: 5, Action: "high_danger_possession" }, { minute: 61 });
  check("high_danger → suspend-suggested", hd.action === "suspend-suggested");
  check("high_danger confidence 0.8", near(hd.confidence, 0.8));
  check("high_danger pickoffRisk high", hd.pickoffRisk === "high");
  check("kind = pregoal_warning", hd.kind === "pregoal_warning");
  const dz = pregoalWarning({ FixtureId: 1, Ts: 5, Action: "danger_possession" });
  check("danger < high_danger confidence", dz.confidence < hd.confidence);
  const pe = pregoalWarning({ FixtureId: 1, Ts: 5, Action: "safe_possession", PossibleEvent: { Goal: true } });
  check("PossibleEvent.Goal → 0.9 even on safe possession", near(pe.confidence, 0.9));
  check("PossibleEvent firedBy", pe.firedBy === "possible_event");
  const none = pregoalWarning({ FixtureId: 1, Ts: 5, Action: "safe_possession" });
  check("non-danger frame → null", none === null);
}

console.log("\n── determinism (same input → byte-identical signal) ──");
{
  const a = JSON.stringify(classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.12, fairProb: 0.6, preEventProb: 0.5 }), { minute: 70, watchedProb: 0.64 }));
  const b = JSON.stringify(classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.12, fairProb: 0.6, preEventProb: 0.5 }), { minute: 70, watchedProb: 0.64 }));
  check("classifyEdge is deterministic", a === b);
  check("thresholds match engine defaults", _internal.THRESH.steam === 0.04 && _internal.THRESH.overreaction === 0.08);
  // SDK↔lib parity: the SDK barrel must re-export the SAME classifier the API uses.
  const viaSdk = JSON.stringify(sdkClassifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.12, fairProb: 0.6, preEventProb: 0.5 }), { minute: 70, watchedProb: 0.64 }));
  check("SDK classifyEdge == lib classifyEdge (parity)", viaSdk === a);
}

console.log("\n── settlement: CLV leg ──");
{
  // a fade (lay) signal entered at pRef 0.60; line reverts to 0.50 → lay wins.
  const win = settleCLV({ pRef: 0.6, direction: "lay" }, 0.5);
  check("lay reverting down → clvRight true", win.clvRight === true && win.status === "settled");
  check("lay CLV = +16.7%", near(win.clvReturn, (0.6 - 0.5) / 0.6, 1e-6));
  const lose = settleCLV({ pRef: 0.6, direction: "lay" }, 0.7); // kept rising → fade wrong
  check("lay that keeps rising → clvRight false", lose.clvRight === false);
  const back = settleCLV({ pRef: 0.4, direction: "back" }, 0.5);
  check("back rising → clvRight true", back.clvRight === true);
  check("no closing prob → pending", settleCLV({ pRef: 0.4, direction: "back" }, null).status === "pending");
}

console.log("\n── settlement: on-chain outcome leg (goals) ──");
{
  // O/U 2.5 over, backed: 3 goals → over wins → right.
  check("OU over backed, 3 goals → win", resolveGoalsOutcome({ superOddsType: "OVERUNDER_PARTICIPANT_GOALS", side: "over", line: 2.5, direction: "back" }, 2, 1) === true);
  check("OU over backed, 2 goals → lose", resolveGoalsOutcome({ superOddsType: "OVERUNDER_PARTICIPANT_GOALS", side: "over", line: 2.5, direction: "back" }, 1, 1) === false);
  check("OU over LAID, 1 goal → win (fade)", resolveGoalsOutcome({ superOddsType: "OVERUNDER_PARTICIPANT_GOALS", side: "over", line: 2.5, direction: "lay" }, 1, 0) === true);
  check("OU push → null", resolveGoalsOutcome({ superOddsType: "OVERUNDER_PARTICIPANT_GOALS", side: "over", line: 3, direction: "back" }, 2, 1) === null);
  // AH P1 -0.5, backed: P1 wins by 1 → margin 0.5 > 0 → win.
  check("AH P1 -0.5 backed, P1 wins → win", resolveGoalsOutcome({ superOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS", side: "participant1", line: -0.5, direction: "back" }, 1, 0) === true);
  check("AH push → null", resolveGoalsOutcome({ superOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS", side: "participant1", line: 0, direction: "back" }, 1, 1) === null);
}

console.log("\n── calibration ledger ──");
{
  const rows = [
    { fixtureId: "A", kind: "overreaction", action: "fade", status: "settled", clvReturn: 0.1, clvRight: true },
    { fixtureId: "A", kind: "overreaction", action: "fade", status: "settled", clvReturn: -0.05, clvRight: false },
    { fixtureId: "B", kind: "steam", action: "follow", status: "settled", clvReturn: 0.02, clvRight: true },
    { fixtureId: "B", kind: "overreaction", action: "hold", status: "pending", clvReturn: null, clvRight: null },
  ];
  const led = calibrate(rows);
  check("overall counts settled only (n=3, pending=1)", led.overall.n === 3 && led.overall.pending === 1);
  check("overreaction/fade hitRate 1/2", led.byKind.overreaction.hitRate === 0.5);
  check("breadth = 2 matches", led.breadth.matches === 2);
  check("headline mentions overreaction", /overreaction/.test(led.headline));
}

console.log("\n── proof reel: frame lookup ──");
{
  const meta = { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketParameters: "line=2.5", marketPeriod: "null", side: "over" };
  const mk = (ts, price) => ({ Ts: ts, SuperOddsType: meta.superOddsType, MarketParameters: meta.marketParameters, MarketPeriod: meta.marketPeriod, PriceNames: ["over", "under"], Prices: [price, 2000] });
  // interleave an off-market frame to prove the filter holds
  const other = { Ts: 90_000, SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS", MarketParameters: "line=0", MarketPeriod: "null", PriceNames: ["part1", "part2"], Prices: [1900, 1900] };
  const frames = [mk(0, 2000), other, mk(60_000, 2200), mk(reel.HORIZON_MS, 1800), mk(240_000, 1700)].sort((a, b) => a.Ts - b.Ts);
  const obj = reel.frameAtHorizon(frames, meta, 0); // target = HORIZON_MS
  check("frameAtHorizon returns first frame at/after horizon", obj.ts === reel.HORIZON_MS, String(obj?.ts));
  const base = reel.frameAtOrBefore(frames, meta, 120_000);
  check("frameAtOrBefore returns last frame at/before target", base.ts === 60_000, String(base?.ts));
  check("frameAtOrBefore ignores other markets", reel.frameAtOrBefore(frames, meta, 95_000).ts === 60_000);
}

console.log("\n── proof reel: sustained reversion ──");
{
  const meta = { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketParameters: "line=2.5", marketPeriod: "null", side: "over" };
  const mk = (ts, pOver) => ({ Ts: ts, SuperOddsType: meta.superOddsType, MarketParameters: meta.marketParameters, MarketPeriod: meta.marketPeriod, PriceNames: ["over", "under"], Prices: [Math.round(1000 / pOver), 2000] });
  // baseline 0.5, entry (overshoot) 0.8 → drift 0.3. Line recovers to ~0.6 and HOLDS.
  const reverting = [mk(0, 0.8), mk(20_000, 0.65), mk(70_000, 0.62), mk(120_000, 0.6), mk(180_000, 0.6)];
  const r1 = reel.reversionPoint(reverting, meta, 0, 0.5, 0.8);
  check("reversionPoint finds a sustained recovery", r1 && r1.sustained === true, JSON.stringify(r1));
  check("reversion ratio ≈ 2/3 of the drift", r1 && Math.abs(r1.ratio - 0.667) < 0.05, String(r1?.ratio));
  check("sustained ≥ threshold ⇒ isReverted true", reel.isReverted(r1.ratio, r1.sustained) === true);
  // a reprice that STICKS near the overshoot (no recovery) is NOT a reversion
  const stuck = [mk(0, 0.8), mk(30_000, 0.79), mk(90_000, 0.78), mk(180_000, 0.79)];
  const r2 = reel.reversionPoint(stuck, meta, 0, 0.5, 0.8);
  check("stuck reprice → ratio small", r2 && r2.ratio < 0.2, String(r2?.ratio));
  check("stuck reprice → NOT reverted", reel.isReverted(r2.ratio, r2.sustained) === false);
  check("no overshoot (drift<2pp) → null", reel.reversionPoint(reverting, meta, 0, 0.79, 0.8) === null);
}

console.log("\n── proof reel: believable selection ──");
{
  let t = 0;
  const c = (kind, success, magnitude, reversionRatio = null) => ({ kind, success, magnitude, reversionRatio, entry: { ts: t++ } });
  const cases = [
    ...Array.from({ length: 5 }, (_, i) => c("overreaction", true, 0.15, 0.9 - i * 0.05)), // reversions
    ...Array.from({ length: 6 }, () => c("overreaction", false, 0.12)), // reprice-stuck
    ...Array.from({ length: 3 }, () => c("steam", true, 0.05)),
    ...Array.from({ length: 3 }, () => c("steam", false, 0.05)),
  ];
  const { kept, totals } = reel.selectBelievable(cases, { orMissRatio: 0.6, orMissMax: 3, steamWins: 1, steamLosses: 1, revCap: 12 });
  const revs = kept.filter((k) => k.kind === "overreaction" && k.success).length;
  const miss = kept.filter((k) => k.kind === "overreaction" && !k.success).length;
  const stW = kept.filter((k) => k.kind === "steam" && k.success).length;
  const stL = kept.filter((k) => k.kind === "steam" && !k.success).length;
  check("all reversions shown (the proof)", revs === 5, `got ${revs}`);
  check("reprice-stuck misses capped to a minority", miss === 3, `got ${miss}`);
  check("steam kept to a token 1W/1L", stW === 1 && stL === 1, `${stW}/${stL}`);
  check("reversions count disclosed", totals.reversions === 5 && totals.overreactions === 11, JSON.stringify(totals));
  check("discards disclosed", totals.discarded === totals.cases - totals.shown && totals.discarded > 0);
  check("kept is chronological", kept.every((k, i) => i === 0 || kept[i - 1].entry.ts <= k.entry.ts));
  const allRev = reel.selectBelievable(Array.from({ length: 4 }, () => c("overreaction", true, 0.1, 0.7)));
  check("no misses available → none fabricated", allRev.kept.every((k) => k.success));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} signals: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
