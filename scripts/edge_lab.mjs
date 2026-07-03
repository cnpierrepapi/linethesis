// EDGE LAB — test documented in-play phenomena against our real captures. Research tool.
import replays from "../lib/replays.json" with { type: "json" };
import { resolveGoalsOutcome } from "../lib/signals/settle.mjs";

const goalsOf = (sc, n) => {
  if (!sc) return 0;
  const p = sc["Participant" + n];
  const pf = p?.Total?.Goals; if (pf != null) return Number(pf);
  const t = sc.Total; const pe = t?.["Participant" + n]?.Goals; return pe != null ? Number(pe) : 0;
};
function finalGoals(m) {
  let p1 = 0, p2 = 0;
  for (const s of m.scores) { if (!s.Score) continue; p1 = Math.max(p1, goalsOf(s.Score, 1)); p2 = Math.max(p2, goalsOf(s.Score, 2)); }
  return { p1, p2 };
}
const sideProb = (rec, side) => { const i = (rec.PriceNames||[]).indexOf(side); if (i<0) return null; const p = Number(rec.Prices[i]); if (!(p>0)) return null; const pr = 1000/p; return pr<0.02||pr>0.98?null:pr; };
const clock = (m) => { // in-play odds span
  const go = m.odds.filter(o=>/PARTICIPANT_GOALS/.test(o.SuperOddsType)).map(o=>o.Ts); return { t0: Math.min(...go), t1: Math.max(...go) };
};

// ---- FAVOURITE-LONGSHOT BIAS: bin by implied prob, compare realized win-rate ----
// One representative observation per (match, market-line, side): the TIME-AVERAGED in-play
// implied prob, settled on final goals. Reverse-FLB = favourites overpriced (win < implied).
function flb() {
  const obs = [];
  for (const m of replays) {
    const g = finalGoals(m); const { t0, t1 } = clock(m);
    // group frames by market key + side, average prob over the middle 60% of in-play
    const lo = t0 + 0.2*(t1-t0), hi = t0 + 0.8*(t1-t0);
    const acc = new Map();
    for (const o of m.odds) {
      if (!/PARTICIPANT_GOALS/.test(o.SuperOddsType)) continue;
      if (o.Ts < lo || o.Ts > hi) continue;
      for (const side of (o.PriceNames||[])) {
        const pr = sideProb(o, side); if (pr==null) continue;
        const key = `${o.SuperOddsType}|${o.MarketParameters}|${o.MarketPeriod}|${side}`;
        const a = acc.get(key) || { sum:0, n:0, sot:o.SuperOddsType, line:parseFloat(String(o.MarketParameters).replace('line=','')), side };
        a.sum += pr; a.n++; acc.set(key, a);
      }
    }
    for (const a of acc.values()) {
      if (a.n < 5) continue;
      const implied = a.sum/a.n;
      const won = resolveGoalsOutcome({ superOddsType:a.sot, side:a.side, line:a.line, direction:'back' }, g.p1, g.p2);
      if (won == null) continue; // push
      obs.push({ implied, won: won?1:0 });
    }
  }
  // calibration by bin
  const bins = [[0,0.35],[0.35,0.5],[0.5,0.65],[0.65,1.01]];
  console.log(`\n=== FAVOURITE-LONGSHOT BIAS  (n=${obs.length} settled market-sides, 4 matches) ===`);
  console.log('implied-band   n   avg_implied  realized_win  gap(real-impl)');
  for (const [a,b] of bins) {
    const s = obs.filter(o=>o.implied>=a&&o.implied<b);
    if (!s.length) { console.log(`[${a},${b})  n=0`); continue; }
    const ai = s.reduce((x,o)=>x+o.implied,0)/s.length;
    const rw = s.reduce((x,o)=>x+o.won,0)/s.length;
    console.log(`[${a.toFixed(2)},${b.toFixed(2)})  ${String(s.length).padStart(3)}   ${ai.toFixed(3)}        ${rw.toFixed(3)}         ${(rw-ai>=0?'+':'')}${(rw-ai).toFixed(3)}`);
  }
  // simple edge: back favourites (implied>0.6) vs longshots (implied<0.4)
  const fav = obs.filter(o=>o.implied>=0.6), ls = obs.filter(o=>o.implied<0.4);
  const roi = arr => arr.length ? arr.reduce((x,o)=>x+(o.won? (1/(o.implied))-1 : -1),0)/arr.length : null; // back at fair odds 1/implied
  console.log(`\nback-favourite (implied>=0.6) n=${fav.length} realized ${(fav.reduce((x,o)=>x+o.won,0)/fav.length).toFixed(3)} vs implied ${(fav.reduce((x,o)=>x+o.implied,0)/fav.length).toFixed(3)}`);
  console.log(`back-longshot  (implied<0.4)  n=${ls.length} realized ${(ls.reduce((x,o)=>x+o.won,0)/ls.length).toFixed(3)} vs implied ${(ls.reduce((x,o)=>x+o.implied,0)/ls.length).toFixed(3)}`);
}
flb();

// ---- PRE-GOAL DANGER ANTICIPATION: does over-prob rise after high_danger events? ----
function danger() {
  console.log(`\n=== DANGER ANTICIPATION (Bundesliga 2025) ===`);
  const WIN = 60_000;
  // over-prob series per O/U line; measure Δover over WIN after each danger event vs baseline
  for (const tier of ["high_danger_possession", "danger_possession", "shot"]) {
    let dSum=0, dN=0, bSum=0, bN=0;
    for (const m of replays) {
      // over series per O/U line
      const series = new Map();
      for (const o of m.odds) {
        if (!/OVERUNDER_PARTICIPANT_GOALS/.test(o.SuperOddsType)) continue;
        const pr = sideProb(o, "over"); if (pr==null) continue;
        const k = `${o.MarketParameters}|${o.MarketPeriod}`;
        (series.get(k) || series.set(k,[]).get(k)).push({ ts:o.Ts, p:pr });
      }
      for (const arr of series.values()) arr.sort((a,b)=>a.ts-b.ts);
      const at = (arr, t) => { let v=null; for (const e of arr){ if(e.ts<=t) v=e.p; else break; } return v; };
      const events = m.scores.filter(s=>s.Action===tier && s.Clock?.Running).map(s=>s.Ts);
      const { t0, t1 } = clock(m);
      const baseTimes = []; for (let t=t0; t<t1-WIN; t+=30_000) baseTimes.push(t);
      for (const arr of series.values()) {
        for (const te of events) { const a=at(arr,te), b=at(arr,te+WIN); if(a!=null&&b!=null){ dSum+=b-a; dN++; } }
        for (const tb of baseTimes) { const a=at(arr,tb), b=at(arr,tb+WIN); if(a!=null&&b!=null){ bSum+=b-a; bN++; } }
      }
    }
    const dMean=dSum/dN, bMean=bSum/bN;
    console.log(`  ${tier.padEnd(24)} Δover after event = ${(dMean*100>=0?'+':'')}${(dMean*100).toFixed(2)}pp (n=${dN})  vs baseline ${(bMean*100>=0?'+':'')}${(bMean*100).toFixed(2)}pp  → lift ${((dMean-bMean)*100>=0?'+':'')}${((dMean-bMean)*100).toFixed(2)}pp`);
  }
  // danger → real goal within 120s vs base rate
  const GW=120_000;
  for (const tier of ["high_danger_possession","danger_possession","shot"]) {
    let hit=0, tot=0, inplay=0, goalCount=0;
    for (const m of replays) {
      const { t0, t1 } = clock(m); inplay += (t1-t0);
      // real goal times (running max increments)
      let p1=0,p2=0; const gt=[];
      for (const s of m.scores.slice().sort((a,b)=>a.Ts-b.Ts)) { if(!s.Score)continue; const n1=Math.max(p1,goalsOf(s.Score,1)),n2=Math.max(p2,goalsOf(s.Score,2)); if(n1>p1||n2>p2){gt.push(s.Ts);p1=n1;p2=n2;} }
      goalCount += gt.length;
      const ev = m.scores.filter(s=>s.Action===tier&&s.Clock?.Running).map(s=>s.Ts);
      for (const te of ev){ tot++; if(gt.some(g=>g>te&&g<=te+GW)) hit++; }
    }
    const baseRate = goalCount*GW/inplay; // expected P(goal in 120s window) if uniform
    console.log(`  ${tier.padEnd(24)} P(goal within 120s | event) = ${(hit/tot).toFixed(3)} (${hit}/${tot})  vs base rate ${baseRate.toFixed(3)}  → lift ${((hit/tot)/baseRate).toFixed(2)}x`);
  }
}
danger();

// ---- LINE-MOVE AUTOCORRELATION: momentum (follow) vs mean-reversion, by horizon ----
function autocorr() {
  console.log(`\n=== LINE-MOVE STRUCTURE (momentum vs reversion) ===`);
  for (const step of [2000, 10000, 30000]) {
    let sxy=0, sxx=0, syy=0, n=0;
    for (const m of replays) {
      const series = new Map();
      for (const o of m.odds) { if(!/PARTICIPANT_GOALS/.test(o.SuperOddsType))continue; for(const side of (o.PriceNames||[])){ const pr=sideProb(o,side); if(pr==null)continue; const k=`${o.SuperOddsType}|${o.MarketParameters}|${o.MarketPeriod}|${side}`; (series.get(k)||series.set(k,[]).get(k)).push({ts:o.Ts,p:pr}); } }
      for (const arr of series.values()) {
        arr.sort((a,b)=>a.ts-b.ts);
        // resample at `step`
        const rs=[]; let ti=arr[0].ts; let vi=arr[0].p; let j=0;
        for (let t=arr[0].ts; t<=arr[arr.length-1].ts; t+=step){ while(j<arr.length&&arr[j].ts<=t){vi=arr[j].p;j++;} rs.push(vi); }
        const d=[]; for(let i=1;i<rs.length;i++) d.push(rs[i]-rs[i-1]);
        for(let i=1;i<d.length;i++){ sxy+=d[i]*d[i-1]; sxx+=d[i-1]*d[i-1]; syy+=d[i]*d[i]; n++; }
      }
    }
    const ac = sxy/Math.sqrt(sxx*syy);
    console.log(`  step ${String(step/1000).padStart(2)}s  lag-1 autocorr = ${ac>=0?'+':''}${ac.toFixed(3)}  (n=${n})  → ${ac>0.02?'MOMENTUM/trend (follow)':ac<-0.02?'MEAN-REVERSION (fade)':'~random-walk (efficient)'}`);
  }
}
autocorr();

// ---- ANTICIPATION ODDS-DRIFT TEST (Task 2): does the LINE drift goal-ward after a
// high_danger event, BEFORE the goal, by enough to get a lagging book picked off? ----
//
// This SUPERSEDES danger()'s crude "Δover +0.18pp": that number was contaminated because
// its 60s window swept in frames where the goal actually LANDED (goal-reaction, not
// anticipation). Here we truncate every window at min(event+W, nextGoal − GUARD) so the
// goal's own reprice can never leak in — what's left is pure anticipation drift.
//
// The verdict gates the signal's ACTION semantics:
//   • lift clearly >0 AND a meaningful % clears the 60bps materiality bar at W=8s (the lag
//     window a book is actually picked off through)  → over_lean is a real, tradeable action.
//   • drift ~= baseline / immaterial  → the signal is SUSPEND-ONLY (its value is the proven
//     goal-ARRIVAL lift 1.92×: suspend pre-goal so you're not caught with a stale in-play
//     line when the goal lands — value comes from the goal coming, not from pre-goal drift).
//
// PATH test: many quasi-independent danger events per match (234 total) → powered on 4
// matches, unlike outcome-settled edges (N_effective=4). over-prob is a directionless proxy:
// a goal by EITHER side lifts total-goals "over", so we need no possession-direction (which
// these slimmed replays lack anyway).
const GUARD_MS = 1500;      // keep the window safely before the goal's odds reaction
const MATERIAL = 0.006;     // 60bps = PICKOFF_BPS.med → a lagging book is tradeably behind
const seriesAt = (arr, t) => { let v = null; for (const e of arr) { if (e.ts <= t) v = e.p; else break; } return v; };
const firstGoalAfter = (gt, t) => { for (const g of gt) if (g > t) return g; return Infinity; };
function goalTimes(m) {
  let p1 = 0, p2 = 0; const gt = [];
  for (const s of m.scores.slice().sort((a, b) => a.Ts - b.Ts)) {
    if (!s.Score) continue;
    const n1 = Math.max(p1, goalsOf(s.Score, 1)), n2 = Math.max(p2, goalsOf(s.Score, 2));
    if (n1 > p1 || n2 > p2) { gt.push(s.Ts); p1 = n1; p2 = n2; }
  }
  return gt;
}
function overSeries(m) {
  const series = new Map();
  for (const o of m.odds) {
    if (!/OVERUNDER_PARTICIPANT_GOALS/.test(o.SuperOddsType)) continue;
    const pr = sideProb(o, "over"); if (pr == null) continue;
    const k = `${o.MarketParameters}|${o.MarketPeriod}`;
    (series.get(k) || series.set(k, []).get(k)).push({ ts: o.Ts, p: pr });
  }
  for (const arr of series.values()) arr.sort((a, b) => a.ts - b.ts);
  return series;
}
const pp = (x) => `${x * 100 >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;

function drift() {
  console.log(`\n=== ANTICIPATION ODDS-DRIFT TEST (pre-goal isolation, Task 2) ===`);
  console.log(`Δ(over-prob) from danger event to min(event+W, nextGoal−${GUARD_MS/1000}s). goal-reaction EXCLUDED.`);
  for (const W of [8000, 30000, 60000]) {
    for (const tier of ["high_danger_possession", "danger_possession"]) {
      let dSum = 0, dN = 0, dMat = 0, bSum = 0, bN = 0;
      let gSum = 0, gN = 0, ngSum = 0, ngN = 0; // conditional on a goal actually following in-window
      for (const m of replays) {
        const gt = goalTimes(m); const series = overSeries(m); const { t0, t1 } = clock(m);
        const events = m.scores.filter((s) => s.Action === tier && s.Clock?.Running).map((s) => s.Ts);
        const baseTimes = []; for (let t = t0; t < t1 - W; t += 30_000) baseTimes.push(t);
        for (const arr of series.values()) {
          for (const te of events) {
            const tg = firstGoalAfter(gt, te);
            const tEnd = Math.min(te + W, tg - GUARD_MS);
            if (tEnd <= te) continue;
            const a = seriesAt(arr, te), b = seriesAt(arr, tEnd);
            if (a == null || b == null) continue;
            const d = b - a; dSum += d; dN++; if (Math.abs(d) >= MATERIAL) dMat++;
            if (tg <= te + W) { gSum += d; gN++; } else { ngSum += d; ngN++; }
          }
          for (const tb of baseTimes) {
            const tg = firstGoalAfter(gt, tb);
            const tEnd = Math.min(tb + W, tg - GUARD_MS);
            if (tEnd <= tb) continue;
            const a = seriesAt(arr, tb), b = seriesAt(arr, tEnd);
            if (a == null || b == null) continue;
            bSum += b - a; bN++;
          }
        }
      }
      const dMean = dN ? dSum / dN : 0, bMean = bN ? bSum / bN : 0;
      console.log(
        `  W=${String(W / 1000).padStart(2)}s ${tier.padEnd(24)} Δover=${pp(dMean)} vs base ${pp(bMean)} → lift ${pp(dMean - bMean)} | material(|Δ|≥60bps) ${dN ? (100 * dMat / dN).toFixed(0) : 0}% of ${dN} | before-goal ${pp(gN ? gSum / gN : 0)}(n=${gN}) vs no-goal ${pp(ngN ? ngSum / ngN : 0)}(n=${ngN})`,
      );
    }
  }
  console.log(`  → over_lean is justified ONLY if lift clearly >0 AND a meaningful % clears the 60bps bar at W=8s;`);
  console.log(`    otherwise the signal is SUSPEND-ONLY (value = the proven 1.92× goal-ARRIVAL lift, not pre-goal drift).`);
}
drift();

// ═══════════════════════════════════════════════════════════════════════════
// TASK 3 — TOP-4 PATH EDGES + LATE-MATCH AMPLIFICATION
// Priors from research/task3_edge_research_sweep.md §8 (Angelini-De Angelis 2026,
// NBA/Kalshi + Wunderlich 2025, Bundesliga). Those numbers are PRIORS — different
// sport/market — so we RE-ESTIMATE every coefficient here on our AH/OU goals feed;
// the finding we keep is the SIGN/DIRECTION, not the exact NBA number.
//
// All four are PATH/microstructure edges (many quasi-independent obs per match) →
// powered on 4 captures, unlike outcome-settled edges (N_effective = #matches).
// ═══════════════════════════════════════════════════════════════════════════

const MIN_INNOV = 0.0025;   // |Δq| ≥ 0.25pp meaningful-move filter (Angelini-De Angelis §8)
const SAMPLE = 15_000;      // fixed grid step for the innovation sampler
const INNOV_W = 60_000;     // innovation lookback window (the "benchmark move")
const GUARD_GAP = 15_000;   // skip-a-period gap: measure future drift from t+GUARD, NOT t, so
                            // the shared endpoint q(t) can't manufacture spurious mean-reversion
                            // (a noise blip in q(t) inflates the innovation AND deflates the drift).
const HORIZONS = { "1m": 60_000, "5m": 300_000, "10m": 600_000, "15m": 900_000 };

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (x, d = 4) => (x == null || !isFinite(x) ? " n/a  " : `${x >= 0 ? "+" : ""}${x.toFixed(d)}`);

// ---- ordinary least squares  y = a + b·x  with SE / t-stat / Pearson r ----
function ols(xs, ys) {
  const n = xs.length;
  if (n < 3) return { n, beta: NaN, se: NaN, t: NaN, r: NaN, alpha: NaN };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (sxx <= 0) return { n, beta: NaN, se: NaN, t: NaN, r: NaN, alpha: NaN };
  const beta = sxy / sxx, alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = ys[i] - (alpha + beta * xs[i]); sse += e * e; }
  const se = Math.sqrt((sse / (n - 2)) / sxx);
  const r = sxy / Math.sqrt(sxx * syy);
  return { n, beta, se, t: beta / se, r, alpha };
}

// ---- continuous match-minute from the running scores clock (Clock.Seconds is
// a single continuous match clock in our captures, ~0→6500s, monotone bar tiny jitters) ----
function clockMap(m) {
  return m.scores
    .filter((s) => s.Clock && s.Clock.Running && s.Clock.Seconds != null)
    .map((s) => ({ ts: s.Ts, sec: s.Clock.Seconds }))
    .sort((a, b) => a.ts - b.ts);
}
function minuteAt(cl, ts) {
  if (!cl.length) return null;
  let v = cl[0].sec;
  for (const e of cl) { if (e.ts <= ts) v = e.sec; else break; }
  return v / 60;
}

// ---- canonical demargined-prob series per goals market (ONE side each to avoid
// mirror double-counting): O/U → 'over', AH → 'part1'. ----
function probSeries(m) {
  const series = new Map();
  for (const o of m.odds) {
    let side = null;
    if (/OVERUNDER_PARTICIPANT_GOALS/.test(o.SuperOddsType)) side = "over";
    else if (/ASIANHANDICAP_PARTICIPANT_GOALS/.test(o.SuperOddsType)) side = "part1";
    else continue;
    const pr = sideProb(o, side); if (pr == null) continue;
    const k = `${o.SuperOddsType}|${o.MarketParameters}|${o.MarketPeriod}`;
    let e = series.get(k); if (!e) { e = { arr: [] }; series.set(k, e); }
    e.arr.push({ ts: o.Ts, p: pr });
  }
  for (const e of series.values()) e.arr.sort((a, b) => a.ts - b.ts);
  return series;
}

// ---- shared innovation collector (feeds edges #1, #2, #6) ----
// One observation per grid point where a meaningful move just happened:
//   dq      = q(t) − q(t−INNOV_W)         the "benchmark move" (news the market just took in)
//   dk[k]   = q(t+k) − q(t)               future drift over each horizon (null if past FT)
//   dens    = raw quote count in prior INNOV_W    liquidity proxy for edge #2
//   minute  = continuous match minute at t        phase for edge #6
function collectInnovations() {
  const obs = [];
  for (const m of replays) {
    const cl = clockMap(m); const { t0, t1 } = clock(m);
    for (const e of probSeries(m).values()) {
      const arr = e.arr; if (arr.length < 5) continue;
      const rawTs = arr.map((a) => a.ts);
      for (let t = t0 + INNOV_W; t <= t1; t += SAMPLE) {
        const qNow = seriesAt(arr, t), qPrev = seriesAt(arr, t - INNOV_W);
        if (qNow == null || qPrev == null) continue;
        const dq = qNow - qPrev;
        if (Math.abs(dq) < MIN_INNOV) continue; // meaningful-move filter
        // future drift is measured from t+GUARD_GAP (not t) so q(t) isn't shared with dq.
        const qGuard = seriesAt(arr, t + GUARD_GAP);
        const dk = {}; let anyFuture = false;
        for (const [name, k] of Object.entries(HORIZONS)) {
          if (qGuard == null || t + k > t1) { dk[name] = null; continue; }
          const qF = seriesAt(arr, t + k);
          if (qF == null) { dk[name] = null; continue; }
          dk[name] = qF - qGuard; anyFuture = true;
        }
        if (!anyFuture) continue;
        let dens = 0; for (const rt of rawTs) { if (rt > t - INNOV_W && rt <= t) dens++; }
        obs.push({ ts: t, dq, dk, dens, minute: minuteAt(cl, t) });
      }
    }
  }
  return obs;
}

// ---- EDGE #1 — PARTIAL-ADJUSTMENT DRIFT ----
// Regress future drift dk on the innovation dq. β>0 ⇒ the move CONTINUES = the market
// only partially adjusted (underreaction) and the unadjusted portion drifts in later.
// impliedAdj = 1/(1+β) is the contemporaneous-adjustment fraction that bridges to the
// NBA prior β≈0.64 (they measured the adjustment; we measure the leftover drift).
function edge1_partialAdjustment(obs) {
  console.log(`\n=== EDGE #1 — PARTIAL-ADJUSTMENT DRIFT (Angelini-De Angelis 2026; prior adj≈0.64) ===`);
  console.log(`Regress future ΔPct(t→t+k) on innovation Δq (|Δq|≥${MIN_INNOV}). β>0 ⇒ underreaction→drift; β<0 ⇒ overreaction→revert.`);
  console.log(`  horizon      n      β(drift)   t-stat    r        impliedAdj=1/(1+β)   verdict`);
  const out = {};
  for (const name of Object.keys(HORIZONS)) {
    const xs = [], ys = [];
    for (const o of obs) if (o.dk[name] != null) { xs.push(o.dq); ys.push(o.dk[name]); }
    const g = ols(xs, ys); out[name] = g;
    const adj = g.beta > -1 ? 1 / (1 + g.beta) : NaN;
    const verdict = !isFinite(g.t) ? "n/a"
      : g.t > 2 && g.beta > 0 ? "UNDERREACT → drift (follow)"
      : g.t < -2 && g.beta < 0 ? "OVERREACT → revert (fade)"
      : "~efficient (β≈0)";
    console.log(`  ${name.padEnd(6)} ${String(g.n).padStart(7)}   ${fmt(g.beta)}  ${fmt(g.t, 2)}   ${fmt(g.r, 3)}      ${fmt(adj, 3)}            ${verdict}`);
  }
  return out;
}

// ---- EDGE #2 — LIQUIDITY-CONDITIONED UNDERREACTION ----
// Split innovations by book thickness (raw quote density) and re-run edge #1 in each
// half. Angelini-De Angelis θ>0: thin books underreact MORE → expect β_thin > β_thick.
function edge2_liquidity(obs) {
  console.log(`\n=== EDGE #2 — LIQUIDITY-CONDITIONED UNDERREACTION (thin book → worse underreaction; prior θ>0) ===`);
  const dens = obs.map((o) => o.dens).sort((a, b) => a - b);
  const med = dens.length ? dens[Math.floor(dens.length / 2)] : 0;
  console.log(`  liquidity proxy = raw quote count in prior ${INNOV_W / 1000}s; median=${med} → THIN(≤${med}) vs THICK(>${med})`);
  console.log(`  horizon    β_thin(t)            β_thick(t)           Δ(thin−thick)   note`);
  for (const name of Object.keys(HORIZONS)) {
    const thin = { xs: [], ys: [] }, thick = { xs: [], ys: [] };
    for (const o of obs) {
      if (o.dk[name] == null) continue;
      const b = o.dens <= med ? thin : thick;
      b.xs.push(o.dq); b.ys.push(o.dk[name]);
    }
    const gt = ols(thin.xs, thin.ys), gk = ols(thick.xs, thick.ys);
    // The finding on our feed is the reverse of the NBA prior: LIQUID lines carry (β>0,
    // partial-adjustment underreaction), ILLIQUID lines mean-revert (β<0, noise).
    const note = isFinite(gk.t) && gk.t > 2 && gk.beta > 0 ? "thick DRIFTS (underreact)"
      : isFinite(gt.t) && gt.t < -2 && gt.beta < 0 ? "thin reverts (noise)" : "";
    console.log(`  ${name.padEnd(6)} ${fmt(gt.beta)}(t${fmt(gt.t, 1)})   ${fmt(gk.beta)}(t${fmt(gk.t, 1)})   ${fmt(gt.beta - gk.beta)}    ${note}`);
  }
}

// ---- EDGE #3 — SURPRISE-GATED FADE ----
// surprise = pre-goal demargined P(scorer) read off the AH line≈0 for the participant
// who actually scored (from the score tape). Choi-Hui: markets OVERREACT to SURPRISING
// goals (low P(scorer) = underdog scored) and those revert; expected goals stick.
function edge3_surpriseFade() {
  console.log(`\n=== EDGE #3 — SURPRISE-GATED FADE (Choi-Hui 2014; fade only SURPRISING goals) ===`);
  console.log(`  surprise = pre-goal demargined P(scorer) from AH line≈0. Low P(scorer)=surprising→expect reversion.`);
  const rows = [];
  for (const m of replays) {
    // AH prob series per line, both participants
    const ah = new Map();
    for (const o of m.odds) {
      if (!/ASIANHANDICAP_PARTICIPANT_GOALS/.test(o.SuperOddsType)) continue;
      const line = parseFloat(String(o.MarketParameters).replace("line=", ""));
      let e = ah.get(line); if (!e) { e = { p1: [], p2: [] }; ah.set(line, e); }
      const p1 = sideProb(o, "part1"), p2 = sideProb(o, "part2");
      if (p1 != null) e.p1.push({ ts: o.Ts, p: p1 });
      if (p2 != null) e.p2.push({ ts: o.Ts, p: p2 });
    }
    for (const e of ah.values()) { e.p1.sort((a, b) => a.ts - b.ts); e.p2.sort((a, b) => a.ts - b.ts); }
    // AH line closest to 0 (the cleanest "who's ahead" prob) with data
    let best = null, bd = Infinity;
    for (const [line, e] of ah) if (Math.abs(line) < bd && e.p1.length > 5) { bd = Math.abs(line); best = e; }
    if (!best) continue;
    const cl = clockMap(m);
    // goals with scorer (which participant's running-max incremented)
    let g1 = 0, g2 = 0; const gs = [];
    for (const s of m.scores.slice().sort((a, b) => a.Ts - b.Ts)) {
      if (!s.Score) continue;
      const n1 = Math.max(g1, goalsOf(s.Score, 1)), n2 = Math.max(g2, goalsOf(s.Score, 2));
      if (n1 > g1) { gs.push({ ts: s.Ts, scorer: 1 }); g1 = n1; }
      else if (n2 > g2) { gs.push({ ts: s.Ts, scorer: 2 }); g2 = n2; }
    }
    for (const goal of gs) {
      const ser = goal.scorer === 1 ? best.p1 : best.p2;   // the SCORER's own win-prob path
      const pre = seriesAt(ser, goal.ts - 5000); if (pre == null) continue;
      let peak = pre; for (const e of ser) if (e.ts >= goal.ts && e.ts <= goal.ts + 30_000) peak = Math.max(peak, e.p);
      const after = seriesAt(ser, goal.ts + 180_000); if (after == null) continue;
      const overshoot = peak - pre;
      const revRatio = overshoot > 0.01 ? (peak - after) / overshoot : null;  // 1.0 = fully reverted
      rows.push({ surprise: pre, overshoot, revRatio, reverted: revRatio != null && revRatio >= 0.3, minute: minuteAt(cl, goal.ts) });
    }
  }
  console.log(`  n goals with an AH path = ${rows.length}`);
  console.log(`  band                     n   avg P(scorer)  avg overshoot  reverted%(ratio≥0.3)  avg revRatio`);
  for (const [lab, a, b] of [["surprising [0.30,0.60)", 0.30, 0.60], ["expected   [0.60,1.00)", 0.60, 1.01]]) {
    const s = rows.filter((r) => r.surprise >= a && r.surprise < b && r.revRatio != null);
    if (!s.length) { console.log(`  ${lab.padEnd(23)} n=0`); continue; }
    const rv = s.filter((r) => r.reverted).length / s.length;
    console.log(`  ${lab.padEnd(23)} ${String(s.length).padStart(2)}   ${avg(s.map((r) => r.surprise)).toFixed(3)}         ${pp(avg(s.map((r) => r.overshoot)))}        ${(rv * 100).toFixed(0)}% (${s.filter((r) => r.reverted).length}/${s.length})            ${avg(s.map((r) => r.revRatio)).toFixed(2)}`);
  }
  return rows;
}

// ---- EDGE #4 — LINE-INCREMENT AUTOCORRELATION HORIZON ----
// lag-1 autocorr of ΔPct resampled at step k, split by the PRIOR increment's size:
// LARGE crossers (|Δ|≥MIN_INNOV) should CONTINUE (follow); small noise should
// mean-revert at the ~30s horizon (fade). Simon 2025 + our own edge_lab.
function edge4_autocorrHorizon() {
  console.log(`\n=== EDGE #4 — LINE-INCREMENT AUTOCORRELATION HORIZON (Simon 2025; follow big, fade small) ===`);
  console.log(`  lag-1 autocorr of ΔPct at step k, by prior-increment size (|Δ|≥${MIN_INNOV}=LARGE crosser vs small noise)`);
  console.log(`  step    all(n)                large(n)              small(n)`);
  for (const step of [2000, 10000, 30000, 60000]) {
    const acc = { all: z(), large: z(), small: z() };
    function z() { return { sxy: 0, sxx: 0, syy: 0, n: 0 }; }
    for (const m of replays) {
      for (const e of probSeries(m).values()) {
        const arr = e.arr; if (arr.length < 3) continue;
        const rs = []; let j = 0, vi = arr[0].p;
        for (let t = arr[0].ts; t <= arr[arr.length - 1].ts; t += step) { while (j < arr.length && arr[j].ts <= t) { vi = arr[j].p; j++; } rs.push(vi); }
        const d = []; for (let i = 1; i < rs.length; i++) d.push(rs[i] - rs[i - 1]);
        for (let i = 1; i < d.length; i++) {
          const prev = d[i - 1], cur = d[i];
          const bucket = Math.abs(prev) >= MIN_INNOV ? "large" : "small";
          for (const key of ["all", bucket]) { const a = acc[key]; a.sxy += cur * prev; a.sxx += prev * prev; a.syy += cur * cur; a.n++; }
        }
      }
    }
    const ac = (a) => (a.sxx > 0 && a.syy > 0 ? a.sxy / Math.sqrt(a.sxx * a.syy) : NaN);
    const tag = (v) => (!isFinite(v) ? "" : v > 0.02 ? "→follow" : v < -0.02 ? "→FADE" : "→~rw");
    const cell = (a) => `${fmt(ac(a), 3)}(${String(a.n).padStart(5)}) ${tag(ac(a)).padEnd(7)}`;
    console.log(`  ${String(step / 1000).padStart(2)}s   ${cell(acc.all)}   ${cell(acc.large)}   ${cell(acc.small)}`);
  }
}

// ---- EDGE #6 — LATE-MATCH AMPLIFICATION ----
// Condition #1 (drift β) and #3 (goal reversion) on match phase. Angelini clutch:
// β 0.64→0.51 late = ~20% more underreaction → expect drift β↑ and fade edge↑ in the
// closing ~20 min (uncertainty/stakes peak).
function edge6_lateMatch(obs, fadeRows) {
  console.log(`\n=== EDGE #6 — LATE-MATCH AMPLIFICATION (Angelini clutch adj 0.64→0.51; expect drift↑/edge↑ late) ===`);
  console.log(`  #1 drift β by phase — EARLY <70' vs LATE ≥70' (the closing ~20min):`);
  console.log(`  horizon    β_early(n)         β_late(n)          Δ(late−early)   expect late>early`);
  for (const name of Object.keys(HORIZONS)) {
    const E = { xs: [], ys: [] }, L = { xs: [], ys: [] };
    for (const o of obs) {
      if (o.dk[name] == null || o.minute == null) continue;
      const b = o.minute >= 70 ? L : E;
      b.xs.push(o.dq); b.ys.push(o.dk[name]);
    }
    const ge = ols(E.xs, E.ys), gl = ols(L.xs, L.ys);
    const flag = isFinite(ge.beta) && isFinite(gl.beta) && gl.beta > ge.beta ? "✓ amplified late" : "✗";
    console.log(`  ${name.padEnd(6)} ${fmt(ge.beta)}(${String(ge.n).padStart(4)})   ${fmt(gl.beta)}(${String(gl.n).padStart(4)})   ${fmt(gl.beta - ge.beta)}    ${flag}`);
  }
  const phase = (lo, hi) => fadeRows.filter((r) => r.minute != null && r.minute >= lo && r.minute < hi && r.revRatio != null);
  const rr = (s) => (s.length ? `${(100 * s.filter((r) => r.reverted).length / s.length).toFixed(0)}% (${s.filter((r) => r.reverted).length}/${s.length})` : "n=0");
  console.log(`  #3 goal-reversion rate: EARLY(<70') ${rr(phase(0, 70))}  vs  LATE(≥70') ${rr(phase(70, 999))}`);
}

// ---- run the Task-3 suite ----
const _obs = collectInnovations();
console.log(`\n[Task 3] ${_obs.length} meaningful-move observations (|Δq|≥${MIN_INNOV}) across ${replays.length} matches.`);
const _e1 = edge1_partialAdjustment(_obs);
edge2_liquidity(_obs);
const _fade = edge3_surpriseFade();
edge4_autocorrHorizon();
edge6_lateMatch(_obs, _fade);
