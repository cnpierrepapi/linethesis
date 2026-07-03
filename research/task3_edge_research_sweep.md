# Task 3 — In-Play Sports-Betting Research Sweep → Ranked Testable-Edge Menu

**Status:** v1 sweep + edges #1–#4/#6 IMPLEMENTED & wired (Jul 3 2026 — see §9 for results).
~35 anchored sources across 11 phenomenon families.
**Purpose:** survey ~30 years of in-play / sports-betting literature, extract each phenomenon's
claimed effect + conditions, map replications vs conflicts, and gate everything to **what the
TxLINE SL12 mainnet feed can actually test** → output a *ranked menu of testable edges*.

This is a living document. The big effects are saturated (adding more of the ~150 papers adds
*replications*, not new phenomena); the families below are the complete map. Extend by dropping
new rows into §3 and re-ranking §5.

---

## 1. Data-scope gate — what our SL12 mainnet streams can test

The **odds side is the binding constraint** (confirmed from the OpenAPI + 3 live captures):

- **ODDS:** exactly two demargined SuperOddsTypes — `ASIANHANDICAP_PARTICIPANT_GOALS` and
  `OVERUNDER_PARTICIPANT_GOALS`. Both settle on **goals**. `TXLineStablePriceDemargined` + `Pct`
  = the **fair no-vig probability** = our benchmark/reference line. **No 1X2, no card/corner odds.**
  Odds are **LIVE-ONLY** (cannot backfill; a missed minute is gone).
- **SCORES:** full action tape — possession tiers (`attack/danger/high_danger/safe_possession`),
  `shot`, `corner`, cards, `goal`, VAR — plus `Score.ParticipantN.Total` by period, and the
  momentum layer (`Possession`, `PossessionType`, `PossibleEvent`, `PartiNState`). Backfillable.
  The **un-slim archiver now retains PossessionType/participant** → direction is recoverable on
  captures from Jul 3 2026 onward.
- **On-chain settleable = 8 stats only** (goals/yellow/red/corners × 2 sides) via `validate_stat`.

**Consequence for this menu:** every edge must be expressible on **AH/OU goals odds paths** and/or
the **scores momentum tape**. Anything that lives in **1X2 / match-result** odds (favourite-longshot
in the classic market, draw bias, correct-score) is **not directly on our feed** — we can only
reach it indirectly via goal counts.

## 2. Methodology gate — path edges vs outcome edges (the EDGE-LAB lesson)

- **PATH / microstructure edges** (line autocorrelation, steam persistence, reversion after a move,
  pre-goal drift, liquidity-conditioned underreaction): **many quasi-independent observations per
  match** → **high statistical power on just a handful of matches.** Testable NOW on our 4 captures.
- **OUTCOME-settled edges** (favourite-longshot calibration, draw bias, O/U bias, hit-rate by price
  bucket, time-decay of accuracy): **N_effective = number of matches** (every market-side in a match
  resolves off one final score) → need **~50–80 matches** before a claim is trustworthy. The live
  archiver is how we accumulate them.

---

## 3. Evidence table — phenomenon families

Legend for **On our data?** — ✅ path (few matches) · ⏳ outcome (needs ~50–80) · ⚠️ partial/proxy ·
❌ off-feed (1X2-only).

### A. Market efficiency / goal-arrival

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Croxson & Reade 2014, *Econ. Journal* 124(575) | Prices update **swiftly & fully** to a goal; **no drift** after (semi-strong efficient) | Goals on the "cusp" of half-time; clean exogenous news | Anchors the **follow/steam-holds** leg. *Conflicts* with Angelini-DeAngelis 2026 (see E) — resolved by news type: **discrete goal = full update; continuous info flow = partial** | ✅ (goal-jump full-update test) |
| Angelini, De Angelis & Singleton 2022, *Int. J. Forecasting* | In-play mispricing exists; **reverse FLB (favourite bias)**; mispricing **grows with surprise** (late longshot goal) | Betfair, 1004 EPL matches, 1X2 in-play | Confirms Choi-Hui surprise; the FLB part is **1X2-only** | ⚠️ (surprise part ✅ via goals; FLB part ❌) |

### B. Overreaction / reversion

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Choi & Hui 2014, *JEBO* 107 | **Underreact to expected goals, overreact to surprising goals**; reverts **within minutes** | In-play soccer; surprise = underdog scored | **Our core fade edge.** Consistent w/ Singleton, Wheatcroft | ✅ (surprise-gated, per-goal) |
| Wheatcroft 2020, *JQAS* 16(3) | Odds **overreact to runs of form** (COD statistic); underperformers get generous odds → mean-reversion | **Pre-match**, 20 leagues / 12 seasons | Pre-match analogue of in-play fade | ❌ (pre-match, outcome) |
| "Bettors' reaction to match dynamics" 2022 (arXiv 2202.10085, *EJOR* 2023) | Stakes driven by pre-game + in-game strength (VAEP); **overreactions**, vary over match | High-freq stakes, state-space model | Confirms overreaction; time-varying | ✅ (reversion after move) |
| Jay Simon 2025, moneyline 3 sports | **Negative autocorrelation of line changes** = overreaction; violates weak-form efficiency | Moneyline, NBA/NFL/MLB | Matches our edge_lab (−0.091 at 30s) | ✅ (line-increment autocorr) |
| "Inefficient Forecasts at the Sportsbook" (*Mgmt Sci* 2023) | Real-time line movement is **inefficiently slow / predictable** | US sportsbook line movement | Supports drift-after-move | ✅ |

### C. Red card / disciplinary shocks

| Source (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Practitioner + Choi-Hui framing | **Double overreaction** — instant slam, then a second overreaction minutes later; context (scoreline/timing/player role) mis-sized | In-play, red card = biggest non-scoring event | Academic coverage is **sparse** (our 4 captures had ~0 reds) | ⚠️ (red on-chain, but rare — needs many matches) |

### D. Anticipation / xG / momentum tape

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Wunderlich et al 2025, "Do Betting Markets Sense a Goal Coming?" (arXiv 2505.21275) | **NULL: markets do NOT tradeably anticipate goals.** Pre-goal timing coef `mintogoal⁻¹ = −0.005, CI [−0.012, 0.002]` (insignificant) for both odds and stakes. BUT odds **do track accumulated pressure**: `xgdiff/min = 0.163, CI [0.075, 0.250]` (significant); avg xgdiff in final minute = 0.13 | Bundesliga 2018/19, 256 first goals, 9,245 scoreless min, 1 Hz odds | **⚠️ Corrects prior misreading** (this paper does NOT "validate anticipation"). *Strengthens* our Task-2 result: no separable pre-goal drift → **suspend/widen only, never over-lean.** Our own `high_danger → 1.92× goal-in-120s` is a *goal-arrival* lift (contemporaneous/after), NOT a pre-goal tradeable edge | ✅ (arrival-settled only; pre-goal direction = weak/null) |
| xG-velocity / momentum (practitioner) | Rising pressure precedes goals; pros act seconds before books | Live xG feeds | Same phenomenon, no clean academic effect size | ✅ (proxy via possession tape) |

### E. Real-time information processing (the new key one)

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| **Angelini & De Angelis 2026 (arXiv 2606.07811)** | Contemporaneous adjustment **β = 0.638 (SE 0.010, N=356,769 contract-min, 1,438 games, p<0.001 vs β=1)** = underreaction; unadjusted gap → **drift net of future benchmark: 0.379 @1min, 0.459 @5min, 0.458 @10min, 0.484 @15min** (all p<0.001); **clutch (last 5min, ≤5pt) β drops to 0.509** = ~20% more underreaction late; liquidity: salience×illiquidity interaction **θ=+0.0014*** = thin book → worse underreaction; meaningful-move threshold **\|Δq\|≥0.0025 (0.25pp)** | **NBA on Kalshi** (2025-04→2026-05); real-time binary markets | **★ Highest-value new edge** (numbers = a *prior*, not our threshold — different sport/market, re-estimate on soccer AH/OU). *Reconciles* Croxson-Reade (full update to a discrete goal) with continuous underreaction to incremental info. Generalizes steam-follow + cites the thin-book pickoff story; clutch result grounds edge #6 | ✅ (path) + ⚠️ liquidity proxy |

### F. Exchange microstructure

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Whelan 2025, "Agreeing to Disagree: Economics of Betting Exchanges" | Maker/Taker split; **longshot backers lose even as liquidity providers**, favourite-takers profit; behaviour shifts as match progresses | Betfair soccer, large sample | Microstructure analogue of FLB | ⚠️ (we have no order book — single demargined line) |
| Cliff 2021, BBE (arXiv 2105.08310) | Agent-based sim reproduces in-play exchange microstructure dynamics | Simulation | Methodology reference | ❌ (no book) |
| Durkin / practitioner | **Fragmented liquidity → persistent inefficiencies**; alpha in microstructure not prediction | Exchange volumes | Supports thin-book edge | ⚠️ (proxy liquidity via quote density) |

### G. Favourite-longshot & market-type structure

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Constantinou 2022, *JSA* (arXiv 2003.09384) | **Asian Handicap is efficient (no FLB)**; classic 1X2 is FLB-biased | Soccer, ratings + Bayesian nets | **Important: our AH/OU markets are the CLEAN ones** — expect a *null* on in-market FLB | ⏳ (expected null = a finding) |
| Whelan, "Returns on Complex Bets: Asian Handicap" (*RBF* 2024) | AH efficient along favourite/longshot dimension | Soccer AH | Confirms Constantinou | ⏳ |
| "Forecasting soccer w/ betting odds: tale of two markets" (*IJF* 2024) | AH efficient vs 1X2 biased | Soccer | Confirms | ⏳ |
| Ottaviani & Sørensen, "Timing of Bets and the FLB" | FLB linked to **timing** of informed vs uninformed betting | Theory + racing | Timing mechanism | ⚠️ |

### H. Draw bias

| Source | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Multiple (incl. 2. Bundesliga studies) | **Draws systematically underbet**; weaker FLB for draws | Classic 1X2 market | Draw lives in 1X2 | ❌ (off-feed; only reachable via O/U proxy) |

### I. Sentiment / attention

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Sentiment bias & asset prices (sports betting + social media) | Popular/marquee teams attract sentiment → inflated lines; fade for value | Pre-match, high-fanbase teams | Behavioral-finance analogue | ❌ (pre-match, sentiment feed we don't have) |
| Sportsbook pricing & behavioral biases (Syracuse) | Bettors bias toward road favourites, but **books price close to true prob** (don't fully exploit) | US sportsbook | *Conflict* with "shade the public" folklore | ❌ |
| National sentiment & online betting (European football) | National sentiment moves stakes | Cross-country | Sentiment driver | ❌ |

### J. Hot-hand / recency / momentum (pre-match)

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| Moskowitz 2021, *JF* "Asset Pricing and Sports Betting" | Betting markets show **momentum/continuation + behavioral factors mirroring asset markets** | Pre-match, multi-sport | Grounds *follow* at the seasonal scale | ❌ (pre-match/seasonal, not in-play path) |
| Hot-hand fallacy / reversal (Harvard MLB thesis; practitioner) | Winning streaks **underperform** ATS → **reversal** beats momentum | Pre-match streaks | *Conflict* w/ naive momentum; = fade recency | ❌ |

### K. Informed trading / integrity

| Paper (yr) | Claimed effect | Conditions | Replicates / conflicts | On our data? |
|---|---|---|---|---|
| "Insider Trading via the Spread" | **Spreads widen pre-match** for litigious games (informed present) | Pre-match spread | Financial-market analogue | ❌ (no spread on demargined line) |
| ForesightFlow ILS (arXiv 2605.00493) / 2605.10486 | **Information Leakage Score** quantifies pre-news priced-in move | Prediction markets | Methodology for "how much was anticipated" | ⚠️ (could adapt to pre-goal) |
| "Betting Against Integrity" (arXiv 2605.30209) | Match-fixing detectable via in-play market dynamics | In-play | Anomaly detection | ⚠️ |
| Croxson-Reade + Wunderlich (see A, D) | Legit soccer betting has **~no goal-anticipating insider** | In-play | *Conflict* w/ practitioner "smart money predicts goals" — resolved: anticipation is from public pressure, not insider | ✅ (already tested) |

---

## 4. Correlation / conflict map (the three that matter)

1. **"Efficient, no drift" (Croxson-Reade) vs "0.64-for-1 underreaction + drift" (Angelini-De Angelis 2026).**
   *Resolution:* different **news types**. A **discrete goal** is salient → priced fully & instantly
   (= our steam holds ~89%, follow). **Continuous incremental info** (momentum, pressure, small
   probability drift) is **underreacted** to → residual predicts short-horizon drift. **Our feed carries
   both**, so we can test each cleanly and they are not actually in conflict.

2. **"Markets predict goals" (practitioner/xG) vs "markets can't anticipate goals" (Croxson-Reade).**
   *Resolution via Wunderlich 2025 — and it lands on the "can't" side:* the pre-goal timing coefficient
   is **insignificant** (`mintogoal⁻¹ = −0.005, CI [−0.012, 0.002]`); odds only track *accumulated*
   pressure (`xgdiff/min = 0.163`), they do **not** move ex-ante in the final minutes before a goal.
   Combined with our Task-2 drift null, the verdict is firm: **suspend/widen on danger, NEVER over-lean.**
   Our `high_danger → 1.92×` is a goal-*arrival* statistic, not a pre-goal tradeable signal.

3. **"Overreaction is everywhere" (Simon, Choi-Hui) vs "prices near-efficient" (Croxson-Reade,
   Syracuse).** *Resolution:* overreaction is **conditional** — it shows up in (a) **line-increment
   autocorrelation at ~30s horizons** (small noise mean-reverts) and (b) **surprising events** (underdog
   goals, red cards); big *decisive* moves stick. Magnitude alone does **not** predict reversion — the
   **surprise gate** does. This is exactly what our MODEL CORRECTION already baked in.

---

## 5. ⭐ Ranked testable-edge menu (gated to our data)

Ranked by **(expected edge × testability-now × novelty-to-us)**.

| # | Edge | Grounding | Test design on our data | Power now | Priority |
|---|---|---|---|---|---|
| **1** | **Partial-adjustment drift** — a Δ in demargined `Pct` over ~60s is only ~0.64-priced; residual predicts drift over next 2–5 min | Angelini-De Angelis 2026; Simon 2025 | Regress future ΔPct (t→t+k) on the *unadjusted* portion of a benchmark move; estimate the adjustment coefficient per horizon | ✅ HIGH (path, 4 matches) | **HIGH** — generalizes steam-follow, quantifies it |
| **2** | **Liquidity-conditioned underreaction** — drift is larger when the book is thin (stale = pickoff) | Angelini-De Angelis 2026; Durkin | Proxy liquidity by quote density / inter-frame gap; interact with edge #1's residual | ⚠️ MED (proxy) | **HIGH** — *is* the product's pickoff thesis, citable |
| **3** | **Surprise-gated fade** — fade only overreactions to *surprising* goals (demargined-underdog scored), never magnitude alone | Choi-Hui 2014; Singleton 2022 | Compute surprise = pre-goal demargined P(scorer); measure reversion by surprise band (already have [0.3,0.6) vs [0.6,1)) | ✅ MED (per-goal) | **HIGH** — sharpens current fade to the true Choi-Hui condition |
| **4** | **Line-increment autocorrelation horizon** — follow large threshold-crossers, fade small increments at the ~30s reversion horizon | Simon 2025; our edge_lab | Lag-k autocorr of ΔPct across k∈{2,10,30,60}s; find the fade horizon per market | ✅ HIGH (path) | **MED-HIGH** — defines the steam/fade boundary rule |
| **5** | **Directional pre-goal lean** — use possession direction to widen the *right* side pre-goal | Wunderlich 2025 (⚠️ *null* on anticipation) | Needs un-slim captures (now flowing); settle on goal-arrival by side | ⏳ LOW-now (blocked on data) | **LOW-MED** — ⚠️ academic evidence says pre-goal anticipation is ~null; keep as *arrival-settled directional widen*, do NOT expect a tradeable pre-goal drift edge |
| **6** | **Late-match amplification** — existing fade/overreaction edge strengthens near full-time / high-uncertainty | Singleton 2022; Michels 2023 | Condition edge #3/#4 hit-rate on `matchMinute`; interaction term | ✅ MED (uses existing signals) | **MED** — cheap add-on to existing signals |
| **7** | **Red-card double-overreaction** — fade the second overreaction after a red | Practitioner; Choi-Hui | Event-study on red-card frames (on-chain stat 5/6) | ⏳ LOW (reds rare) | **LOW** — needs many matches |
| **8** | **In-market FLB null** — confirm AH/OU shows *no* favourite-longshot bias (our markets are the clean ones) | Constantinou 2022; Whelan 2024 | Calibration by demargined-prob bucket across matches | ⏳ LOW-now (outcome) | **LOW** — a *validation*, expect null; good for the honesty story |

**Off-feed / parked** (need data we don't stream): classic-1X2 FLB, draw bias, pre-match sentiment/
marquee fade, hot-hand reversal, spread-based insider detection. Revisit only if we add a non-TxLINE
feed (1X2 odds, social sentiment, order-book depth).

---

## 6. Cross-ref — what we've already validated (don't re-derive)

From `scripts/edge_lab.mjs` on the 4 in-play WC captures:
- **Steam/follow HELD 89%** (Croxson-Reade / Moskowitz) — edge #1/#4 quantify *why*.
- **high_danger → 1.92× goal-in-120s** (Wunderlich) — edge #5 makes it directional.
- **Surprise-gated fade** rare but real (Choi-Hui) — edge #3 sharpens it.
- **Line-move autocorr** ≈0 at 2/10s, −0.091 at 30s — edge #4 formalizes.
- **FLB apparent but N_eff=4 → untestable** — edge #8 waits for ~50–80 matches.

## 7. Gaps / next data needed

- **Accumulate ~50–80 in-play matches** (archiver is doing this nightly) → unlocks edges #5, #7, #8.
- **Un-slim captures** (live since Jul 3) → directional possession for edge #5.
- **Liquidity proxy** — decide the metric (quote density vs inter-frame gap) for edges #2/#5.
- Optional: pull precise effect sizes from Angelini-De Angelis 2026 §4 and Wunderlich 2025 to
  calibrate thresholds (currently using our own replicated numbers).

---

## 8. Calibrated thresholds (from paper PDFs — use as priors, re-estimate on our AH/OU data)

**Angelini & De Angelis 2026 (arXiv 2606.07811) — NBA/Kalshi, so PRIORS not final thresholds:**
- **Partial-adjustment coefficient (edge #1):** β ≈ **0.64** (0.638, SE 0.010). Null test = **H₀: β=1**;
  they reject at p<0.001 on 356,769 contract-minute obs / 1,438 games. → On our data, regress
  `ΔPct(t→t+1min)` proxy against the contemporaneous benchmark move and test β<1. Expect a *different*
  number on soccer AH/OU (different market/sport) — the finding is *β<1*, not *β=0.64* specifically.
- **Drift recovery of the unadjusted gap (edge #1):** **0.379 @1min → 0.459 @5min → 0.458 @10min →
  0.484 @15min** (net of future benchmark changes, all p<0.001). ≈38–48% of the underreaction gap is
  recovered as drift; **grows out to 15 min**. → set our drift-measurement horizon to **1–15 min**,
  expect strongest signal at 5–15 min.
- **Meaningful-move filter (edges #1/#2/#4):** only count innovations with **|Δq| ≥ 0.0025 (0.25pp)**.
  Below that = noise. Good default gate to avoid diluting with wobble (mirrors our tightened
  DETECT_OPTS lesson).
- **Late-match amplification (edge #6):** clutch time (last 5 min, margin ≤5pt) drops β **0.64 → 0.509**
  = ~**20% more underreaction** when stakes/uncertainty peak. → condition edge #1/#3 on `matchMinute`;
  expect the edge to *strengthen* in the closing ~15–20 min.
- **Liquidity conditioning (edge #2):** salience×illiquidity interaction **θ = +0.0014 (SE 0.0002)***
  → in **thin books, salient signals are underreacted to MORE** (the benefit of salience reverses).
  → our liquidity proxy (quote density / inter-frame gap): expect larger drift when the book is sparse.

**Wunderlich 2025 (arXiv 2505.21275) — Bundesliga, DIRECTLY our sport:**
- **Pre-goal anticipation = NULL:** `mintogoal⁻¹ = −0.005, CI [−0.012, 0.002]` (odds) and `0.096,
  CI [−0.031, 0.222]` (stakes) — both insignificant. → **do NOT build a pre-goal directional-drift
  edge; cap edge #5 at arrival-settled directional widen.**
- **Pressure is priced (not anticipation):** `xgdiff/min = 0.163, CI [0.075, 0.250]` (bookmaker);
  avg xgdiff in the final minute before a goal = **0.13**. → possession/pressure tape is a *state*
  signal (suspend/widen), consistent with our high_danger flag.
- **Sample for context:** 256 first goals, 2018/19 Bundesliga, 1 Hz odds, SSM persistence φ̂=0.974.

**Our own replicated numbers (keep, they're on OUR feed):** steam holds 89%; high_danger→1.92×
goal-in-120s (arrival); line-move autocorr ≈0 @2–10s, −0.091 @30s; surprise bands [0.3,0.6)=33%
revert vs [0.6,1)=16%.

---

## 9. Implementation results — what HELD on our AH/OU feed (Jul 3 2026)

Implemented edges #1–#4 + #6 in `scripts/edge_lab.mjs` (19,332 meaningful-move obs, |Δq|≥0.0025,
4 in-play captures) and wired the winners into `lib/signals/classify.mjs`. Every coefficient below
is RE-ESTIMATED on our soccer demargined goals feed — the §8 NBA/Kalshi numbers were only priors.

**★ Edge #2 — LIQUIDITY-CONDITIONED (the headline winner, WIRED).** Liquidity is the *state
variable that flips the sign* of the drift, robustly:
- **THICK / liquid lines DRIFT** (β = +0.05 @1min → +0.35 @10min, t = +5 to +9) → the
  partial-adjustment underreaction of Angelini-De Angelis **DOES replicate where trading is
  active**; impliedAdj = 1/(1+0.35) = **0.74 @10min, right next to the 0.64 NBA prior.**
- **THIN / illiquid lines MEAN-REVERT** (β = −0.11 → −0.27, t = −13 to −17) = noise / regression
  to the mean. **A thin book is exactly where a stale line gets picked off** = the product thesis,
  now measured. → wired: `quoteDensity` (engine emits quote count/60s) → `liquidity`/`driftRegime`
  on the signal; a THIN book escalates a steam signal's `pickoffRisk`.

**Edge #1 — PARTIAL-ADJUSTMENT (re-signed).** POOLED, the line **mean-reverts** (β = −0.08 @1min,
t = −16.75) — the NBA underreaction does *not* hold on the consensus line as a whole, because thin
lines out-number thick. ⚠️ A guard-gap (measure drift from t+15s, not t) shrank the raw β from
−0.121 to −0.080 → **~⅓ of the naive reversion was shared-endpoint measurement-noise bias; ⅔ is
real.** Verdict: the consensus overreacts/mean-reverts short-horizon; the *underreaction* lives only
in the liquid subset (edge #2). Documented as a calibrated constant in classify.mjs.

**Edge #4 — AUTOCORRELATION HORIZON (HELD, refines the follow/fade boundary).** Large single-
increment crossers (|Δ|≥0.25pp) **revert at 30–60s** (autocorr −0.146 @30s, −0.119 @60s); small
noise ≈ random walk (or a faint +0.027 follow @10s). Reconciles with steam-follow-89%: *goal/
surprise-driven* moves stick, but a lone large *pressure* wobble reverts by ~30s. Consistent w/ #1.

**Edge #6 — LATE-MATCH AMPLIFICATION (suggestive, WIRED as a cheap add-on).** β flips POSITIVE and
larger late (β_late = +0.15 @5min → +0.35 @10min vs negative early; Δ ✓ at 5/10/15min) — drift
amplifies in the closing ~20min, directionally matching Angelini's clutch underreaction. Small-n
(2–3.6k late obs) so *suggestive*, not proven. → wired: ≥70' + in-running escalates a steam
signal's `pickoffRisk` and sets `lateMatch`.

**Edge #3 — SURPRISE-GATED FADE (PARKED, underpowered).** Only 10 goals across 4 matches, 1 landed
in a usable surprise band with an AH path → **cannot test.** This is an outcome-ish edge (per-goal,
not per-frame) → needs the ~50–80 matches the archiver is accruing. Left as-is in classify.mjs (the
surprise path already exists); revisit when matches accumulate. Confirms the §2 power gate.

**Wiring summary (classify.mjs, null-safe — signals without the new inputs are byte-identical):**
`quoteDensity` → `liquidity`('thin'|'thick') + `driftRegime`('carry'|'revert'); `minute`≥70' +
inRunning → `lateMatch`. Both ESCALATE (never downgrade) a steam signal's `pickoffRisk`. 26 + 102
unit assertions green; tsc + next build clean; end-to-end 310 signals (228 liquidity-tagged, 70 late).

### Sources (anchor papers)
- Croxson & Reade 2014, *Economic Journal* 124(575):62-91 — https://academic.oup.com/ej/article/124/575/62/5076978
- Choi & Hui 2014, *JEBO* 107:614-629 — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2011564
- Wheatcroft 2020, *JQAS* 16(3):193-209 — https://eprints.lse.ac.uk/115490/
- Angelini, De Angelis & Singleton 2022, *Int. J. Forecasting* — https://www.sciencedirect.com/science/article/abs/pii/S0169207021000996
- **Angelini & De Angelis 2026 (arXiv 2606.07811)** — https://arxiv.org/abs/2606.07811
- "Bettors' reaction to match dynamics" 2022 (arXiv 2202.10085) — https://arxiv.org/abs/2202.10085
- Wunderlich et al 2025, "Do Betting Markets Sense a Goal Coming?" (arXiv 2505.21275) — https://arxiv.org/html/2505.21275v1
- Simon 2025, moneyline autocorrelation — https://doi.org/10.1177/15586235251394815
- "Inefficient Forecasts at the Sportsbook" (*Mgmt Sci* 2023) — https://pubsonline.informs.org/doi/10.1287/mnsc.2022.00456
- Whelan 2025, "Agreeing to Disagree: Economics of Betting Exchanges" — https://www.karlwhelan.com/Papers/Betfair.pdf
- Whelan 2024, "Returns on Complex Bets: Asian Handicap" (*RBF*) — https://www.karlwhelan.com/Papers/RBF.pdf
- Constantinou 2022, *JSA* (arXiv 2003.09384) — https://arxiv.org/pdf/2003.09384
- "Forecasting soccer w/ betting odds: tale of two markets" (*IJF* 2024) — https://www.sciencedirect.com/science/article/pii/S0169207024000670
- Moskowitz 2021, *JF* "Asset Pricing and Sports Betting" — https://spinup-000d1a-wp-offload-media.s3.amazonaws.com/faculty/wp-content/uploads/sites/3/2021/08/AssetPricingandSportsBetting_JF.pdf
- BBE (Cliff 2021, arXiv 2105.08310) — https://arxiv.org/pdf/2105.08310
- ForesightFlow ILS (arXiv 2605.00493) — https://arxiv.org/pdf/2605.00493
- "Betting Against Integrity" (arXiv 2605.30209) — https://arxiv.org/html/2605.30209v1
