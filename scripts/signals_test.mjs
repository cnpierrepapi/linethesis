// Deterministic unit tests for the read-only signal classifier (lib/signals/classify.mjs).
// Run: node scripts/signals_test.mjs
// Every assertion is a fixed input → fixed output; no clock, no randomness, no I/O.

import { classifyEdge, goalImminent, parseLine, _internal } from "../lib/signals/classify.mjs";
import { classifyEdge as sdkClassifyEdge } from "../sdk/index.mjs";
import { settleCLV, resolveGoalsOutcome, settleGoalArrival } from "../lib/signals/settle.mjs";
import { calibrate, calibrateArrival } from "../lib/signals/calibration.mjs";
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

console.log("\n── overreaction ⇒ hold by default; fade only on SURPRISE (not magnitude) ──");
{
  // magnitude only (no preEventProb) → surprise unconfirmed → HOLD, even when large.
  // (Grounded in our data: big goal-moves are decisive and STICK — size ≠ reversion.)
  const lo = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.08 }));
  check("small overreaction → hold", lo.action === "hold", `${lo.action} conf=${lo.confidence}`);
  const hiMag = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.16 }));
  check("large magnitude ALONE → still hold (size doesn't justify fade)", hiMag.action === "hold", hiMag.action);
  check("hold ⇒ revertLikely false (not a positive reversion call)", hiMag.revertLikely === false);
  check("confidence still monotonic in magnitude", hiMag.confidence > lo.confidence);
  check("confidence bounded [0,1]", hiMag.confidence <= 1 && lo.confidence >= 0);
  // surprise path (preEventProb known) + high confidence → FADE, the positive reversion call
  const surp = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.08, fairProb: 0.7, preEventProb: 0.5 }));
  check("surprise-driven overreaction → fade", surp.action === "fade", surp.action);
  check("fade ⇒ revertLikely true", surp.revertLikely === true);
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
  const withBook = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, fairProb: 0.5 }), { watchedProb: 0.55 });
  check("gapBps signed = +500", withBook.gapBps === 500, String(withBook.gapBps));
  check("large gap → pickoffRisk high", withBook.pickoffRisk === "high");
  const tight = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, fairProb: 0.5 }), { watchedProb: 0.503 });
  check("tiny gap on steam → pickoffRisk low", tight.pickoffRisk === "low", tight.pickoffRisk);
}

console.log("\n── liquidity gate (edge #2) + late-match (edge #6) conditioning ──");
{
  // null-safe: no density, no minute → new fields inert, old behavior byte-identical.
  const plain = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04 }), { minute: 30 });
  check("no quoteDensity → liquidity null", plain.liquidity === null && plain.driftRegime === null);
  check("minute 30 → lateMatch false", plain.lateMatch === false);
  check("plain steam pickoffRisk unchanged (low, no book)", plain.pickoffRisk === "low", plain.pickoffRisk);
  // THICK book (density > median) → 'carry' regime; a liquid move carries → follow stands, risk NOT bumped.
  const thick = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, quoteDensity: 40 }), { minute: 30 });
  check("thick book → liquidity thick / driftRegime carry", thick.liquidity === "thick" && thick.driftRegime === "carry");
  check("thick steam pickoffRisk NOT escalated", thick.pickoffRisk === "low", thick.pickoffRisk);
  check("carry regime annotated in note", /carries \(edge #2\)/.test(thick.note));
  // THIN book (density ≤ median) → 'revert'; a stale thin line is the pickoff surface → risk bumped.
  const thin = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, quoteDensity: 3 }), { minute: 30 });
  check("thin book → liquidity thin / driftRegime revert", thin.liquidity === "thin" && thin.driftRegime === "revert");
  check("thin steam pickoffRisk escalated low→med", thin.pickoffRisk === "med", thin.pickoffRisk);
  // LATE match (≥70', in running) escalates the follow leg's exposure too.
  const late = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04 }), { minute: 82 });
  check("late-match flag set ≥70'", late.lateMatch === true);
  check("late steam pickoffRisk escalated low→med", late.pickoffRisk === "med", late.pickoffRisk);
  check("late-match annotated in note", /late-match drift amplifies \(edge #6\)/.test(late.note));
  // thin + late + an existing book gap stacks toward high (bump caps at high).
  const stacked = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, fairProb: 0.5, quoteDensity: 2 }), { minute: 85, watchedProb: 0.507 });
  check("thin+late steam pickoffRisk → high (bump caps)", stacked.pickoffRisk === "high", stacked.pickoffRisk);
  // late-match must respect inRunning: a not-in-running market never flags late.
  const preMatch = classifyEdge(edge({ kind: "steam", edgeMeasure: 0.04, market: { ...edge().market, inRunning: false } }), { minute: 82 });
  check("not-in-running → lateMatch false even at 82'", preMatch.lateMatch === false);
  // overreaction stays 'high' regardless of liquidity (already default-safe).
  const orThin = classifyEdge(edge({ kind: "overreaction", edgeMeasure: 0.16, quoteDensity: 2 }));
  check("overreaction pickoffRisk stays high w/ thin book", orThin.pickoffRisk === "high");
  check("constants: LIQ median 8, late 70'", _internal.LIQ_QUOTES_60S === 8 && _internal.LATE_MATCH_MIN === 70);
}

console.log("\n── goal-imminent anticipation (momentum tape) ──");
{
  const hd = goalImminent({ FixtureId: 1, Ts: 5, Action: "high_danger_possession" }, { minute: 61 });
  check("high_danger → suspend-suggested", hd.action === "suspend-suggested");
  check("high_danger confidence ≈ 0.855 (calibrated lift)", near(hd.confidence, 0.855));
  check("high_danger goalProb = 0.111 (measured 1.92×)", near(hd.goalProb, 0.111));
  check("high_danger pickoffRisk high", hd.pickoffRisk === "high");
  check("kind = goal_imminent", hd.kind === "goal_imminent");
  check("high_danger surfaces (≥ IMMINENT_SURFACE_CONF)", hd.confidence >= 0.5);
  const dz = goalImminent({ FixtureId: 1, Ts: 5, Action: "danger_possession" });
  check("danger < high_danger confidence", dz.confidence < hd.confidence);
  check("danger goalProb = 0.080 (1.38×)", near(dz.goalProb, 0.08));
  check("danger does NOT surface standalone (< 0.5)", dz.confidence < 0.5);
  const sh = goalImminent({ FixtureId: 1, Ts: 5, Action: "shot" });
  check("shot → null (0.98× = no lift, excluded)", sh === null);
  const pe = goalImminent({ FixtureId: 1, Ts: 5, Action: "safe_possession", PossibleEvent: { Goal: true } });
  check("PossibleEvent.Goal → 0.9 even on safe possession", near(pe.confidence, 0.9));
  check("PossibleEvent firedBy", pe.firedBy === "possible_event");
  const dir = goalImminent({ FixtureId: 1, Ts: 5, Action: "high_danger_possession", Data: { Participant: 2 } });
  check("attackingParticipant from Data.Participant", dir.attackingParticipant === 2);
  check("attackingParticipant null when tape slimmed", hd.attackingParticipant === null);
  const none = goalImminent({ FixtureId: 1, Ts: 5, Action: "safe_possession" });
  check("non-danger frame → null", none === null);
}

console.log("\n── goal-arrival settlement + calibration ──");
{
  const sig = { kind: "goal_imminent", ts: 1000 };
  const hit = settleGoalArrival(sig, [1500, 9000], 120_000); // goal 500ms into the window
  check("goal in window → arrived", hit.status === "settled" && hit.arrived === true);
  check("arrivalMs = 500", hit.arrivalMs === 500);
  const miss = settleGoalArrival(sig, [200, 200_000], 120_000); // goals before + after window
  check("no goal in window → not arrived", miss.arrived === false && miss.arrivalMs === null);
  const edge = settleGoalArrival(sig, [1000], 120_000); // goal AT the warning ts (not strictly after)
  check("goal at t (not >t) → not arrived", edge.arrived === false);
  const noTimes = settleGoalArrival({ kind: "goal_imminent" }, [1500]); // no ts
  check("missing ts → pending", noTimes.status === "pending");

  const rows = [
    { status: "settled", arrived: true, windowMs: 120_000 },
    { status: "settled", arrived: false, windowMs: 120_000 },
    { status: "settled", arrived: true, windowMs: 120_000 },
    { status: "pending", arrived: null, windowMs: 120_000 },
  ];
  const cal = calibrateArrival(rows, 0.1); // 2/3 arrived vs 0.1 base → 6.67× (pending excluded)
  check("calibrateArrival excludes pending (n=3)", cal.n === 3 && cal.arrived === 2);
  check("arrivalRate 2/3", near(cal.arrivalRate, 0.6667));
  check("lift = arrivalRate/base", near(cal.lift, 6.67));
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
  check("headline leads with follow/hold held + fade", /follow|held/.test(led.headline) && /fade/.test(led.headline));
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
  const c = (action, success, magnitude, reversionRatio = null) => ({ action, success, magnitude, reversionRatio, entry: { ts: t++ } });
  const cases = [
    ...Array.from({ length: 5 }, (_, i) => c("fade", true, 0.15, 0.9 - i * 0.05)), // genuine reversions
    ...Array.from({ length: 6 }, () => c("fade", false, 0.12)), // reprice-stuck (fade misses)
    ...Array.from({ length: 4 }, () => c("follow", true, 0.05)), // held follows
    ...Array.from({ length: 2 }, () => c("follow", false, 0.05)), // reverted-out (held misses)
  ];
  const { kept, totals } = reel.selectBelievable(cases);
  const revs = kept.filter((k) => k.action === "fade" && k.success).length;
  const stuck = kept.filter((k) => k.action === "fade" && !k.success).length;
  const held = kept.filter((k) => k.action !== "fade" && k.success).length;
  const broke = kept.filter((k) => k.action !== "fade" && !k.success).length;
  check("all fade reversions shown (the proof)", revs === 5, `got ${revs}`);
  check("fade reprice-stuck misses capped to a minority", stuck === 3, `got ${stuck}`);
  check("held follows shown", held === 4, `got ${held}`);
  check("held misses (broke band) capped", broke === 2, `got ${broke}`);
  check("totals disclosed by verdict", totals.reversions === 5 && totals.held === 4 && totals.fades === 11 && totals.holds === 6, JSON.stringify(totals));
  check("discards disclosed", totals.discarded === totals.cases - totals.shown && totals.discarded >= 0);
  check("kept is chronological", kept.every((k, i) => i === 0 || kept[i - 1].entry.ts <= k.entry.ts));
  const allHeld = reel.selectBelievable(Array.from({ length: 4 }, () => c("follow", true, 0.1)));
  check("no misses available → none fabricated", allHeld.kept.every((k) => k.success));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} signals: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
