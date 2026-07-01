# Agenthesis — The Reframe (one page)

**From:** autonomous agents trading fake-USD with entry/exit P&L (a betting-desk metaphor).
**To:** **autonomous forecasters detecting mispricings in consensus odds, facing off and graded on Closing-Line Value (CLV) — packaged as an operator edge feed.**

**Why:** Retail bets aren't tradeable; CLV is the real skill metric. And the track says *matches resolve AFTER judging* — so CLV (computed from odds alone, in real time) is the **only** metric that demos at review. Outcome-settlement shows nothing; a market-maker needs simulated counterparties (more fiction). Forecasting on CLV is **zero-fiction**: real entry frame, real closing frame, real consensus line — all TxLINE data.

**The face-off is a calibration tournament, not a casino.** "Best forecaster" = highest CLV hit-rate — precisely what an operator wants before licensing a signal.

## Delivery hierarchy
- **API = the product.** What an operator consumes; the judge-testable endpoint (required). Rename `/api/v1/edges` → `/signals` (or `/mispricings`).
- **SDK = ergonomic wrapper** over the API. Keep, don't headline.
- **Web app = the proof/control-room.** Visualizes agents autonomously producing the feed; carries the 5-min demo. *"Agents are the engine; the feed is the product; the app is the proof."*

## Language swaps (mispricing-centric, not PnL)
P&L → **CLV captured** · trade/bet → **signal/call** · stake/bankroll → **conviction (0–1 weight)** · win/loss → **hit/miss (line moved toward call)** · settle → **score/grade** · entry/exit position → **flagged price → closing line** · "agent traded X" → "agent **flagged X mispriced**, called the move."

## Route-by-route
| Route | Action | Becomes |
|---|---|---|
| `/` landing + live terminal | **keep, recopy** | Hero = mispricing/CLV thesis; terminal streams **calls**, ticker shows **CLV captured** not $. |
| `/desk` | **keep, rename** → Signal Desk | Agents emit calls w/ conviction weight; live CLV mark vs closing line. Drop $stake/bankroll. |
| `/papers` | **keep, reframe** | Strategy/edge library (citable detection models). De-emphasize casino "AGI-unlock." |
| `/build` | **keep, rename** → Forecaster Builder | Compose detection base + strategy papers; levers = conviction/phase/market filter, **not** stake. |
| `/leaderboard` | **keep, PROMOTE** → Calibration Tournament | The face-off centerpiece: rank by CLV hit-rate + avg CLV + sample n. Cut $ P&L columns. |
| `/proof` | **keep, rename** → Verification | Each call fingerprinted to on-chain-anchored **entry frame + closing frame**; CLV recomputable. Keep verification CSV. "trade ledger" → **signal ledger**. |
| `/api/v1/edges` | **keep, PROMOTE + rename** → `/signals` | Headline product: mispricing, side, conviction, anchor-frame hash, live CLV grade. |
| `/sdk` | **keep, thin** | Wrapper over the API. |
| `/litepaper` | **keep, rewrite** | Mispricing/CLV language; drop PnL/casino. |
| PITCH/PAPER currencies + USDC pool economy | **CUT — PERMANENT (confirmed)** | Casino-redeem economy fights the "operator intelligence" thesis. Gone for good, not just the submission. Keep Solana only for **on-chain frame anchoring + sign-up proof**. |

## What survives from prior code
Edge engine (steam/overreaction/quote — real), CLV math, on-chain frame anchoring, operator API, leaderboard, and this session's **verifiable entry-frame + closing-frame + recomputable-CLV audit work** — CLV needs exactly those two real frames, so that work is the substrate, not waste.

## Net
Smaller, more honest, more defensible for the actual audience (trading team / market operator / B2B intermediary). API-first product, SDK + app as wrapper and proof, all language shifted from betting desk to **mispricing intelligence**.
