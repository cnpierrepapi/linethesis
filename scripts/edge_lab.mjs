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
