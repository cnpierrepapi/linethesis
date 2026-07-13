# Lagisalpha

**The lead-lag edge in prediction markets. Built on TxLINE.**

A prediction market sets its price by trading, so it **lags** the sharp, vig-free
line that already holds the true probability. TxLINE strips the bookmaker margin
from a live World Cup odds feed to produce that true probability - and it moves
the instant news lands. When a prediction market (Polymarket) falls below fair,
the cheap side is **underpriced**. Lagisalpha detects that divergence, sizes the
trade by Kelly, takes profit at fair, and **proves the result on real on-chain
fills**.

It never takes the other side of a bet - it is a measurement-and-signal product,
not a book.

Built for the TxLINE / TxODDS World Cup hackathon (Solana).

> **Technical documentation:** see [`TECHNICAL.md`](./TECHNICAL.md) for the full
> architecture, data flow, and API reference. The
> [litepaper](https://lagisalpha.vercel.app/litepaper) covers the thesis and the
> evidence.

## Paper-trade it

The trader-facing product is a paper-trading terminal over the same signals. No install:

```bash
npx lagisalpha
```

Set a bankroll, pick a match, and watch each team's cheap side converge to TxLINE fair as a
Kelly-sized paper trade with live PnL. Replay is open; live needs a key (`load las_...`). It is
also on Telegram - **[@lagisalphabot](https://t.me/lagisalphabot)** - as alerts, or paper trades
on a bankroll you set. Signal only, no real orders. Each call labels the team whose price is
cheap; the trade is the convergence to fair, not a bet on who wins.

## The edge in one paragraph

Work in probability space. TxLINE's de-vig 1X2 gives the fair probability a team
wins; the market's moneyline gives its own probability of the same event. When
fair sits above the market price by more than a threshold, the cheap side is
underpriced and we mark an entry - which side, how far off fair, and how much size
you could later exit into at fair. Buy the cheap side, take profit at fair when
the market catches up, size each bet by Kelly on the gap. Holding to the final
result is a losing trade on this data; the convergence is where the money is.

## The proof

Measured on settled World Cup matches, on the real fills, over **every call the
detector fired - no exclusion filter, nothing curated**:

- **Reach** - does the market price travel back to fair before the match ends?
  Currently **~79%** of the time, recomputed live on `/proof`. Outcome-independent,
  so it is the firmer number.
- **Return** - Kelly-sized (capped at 30% per call), take-profit-at-fair,
  compounded across every call. Take-profit far exceeds holding to the final
  result; the convergence is where the money is. The compounded figure is
  concentrated at pilot size and published as-is on `/proof`, where it recomputes
  as each match settles.

Pilot sample (20 matches): the compounded return is carried by a few high-volume
matches, so it is a pilot, not a promise. Reach is the firmer read; both tighten as
matches accrue.

**Signal policy.** Every call counts: either side, any size, any minute, each side
named by its team. Sizing is the only risk control: Kelly on the gap,
f = gap/(1 - price), **capped at 30% of the balance per call** so no single bet can
ruin the account (full Kelly, uncapped, once staked 81% on one call and gave back
76% of the bankroll). The maths is computed the same way on the box and the site.

## What we found (pilot)

The brief floated a **Sharp Movement Detector** - flag significant TxLINE odds shifts and
see if they call the result. We built it, found it is a coin flip, and did one better:

- **Odds shifts alone: 58%** (7/12) at calling the result - no better than chance. The line
  moving is not the edge.
- **The lead-lag is.** A goal is new information: TxLINE reprices it instantly, a prediction
  market only moves when someone trades, so for a window the cheap side sits below fair and
  converges **~79%** of the time. It is our strongest, most proven signal, and the record
  rolls unfiltered: every call is published and scored, with the calls that hurt it left in.
- **Goal-imminent alerts:** a TxLINE `high_danger_possession` makes a goal by that team
  ~**4x** more likely within 2 minutes, and a divergence it flags converged **84%** vs
  **75%** without one.

A volume-to-divergence read (more traded money per point of divergence tends to mark the
winner) rides along in the terminal as an experimental overlay, graded live and penalty-honest;
we do not lean on it. In-sample on 12 matches; a promising pilot, not a settled result.

## Architecture (short version)

TxLINE SSE (fair) + Polymarket fills (Polygon) → EC2 pipeline → Supabase blob →
Next.js site. A Python pipeline on an EC2 box streams the de-vig fair line,
decodes real Polymarket fills from Polygon, joins them, computes reach / return /
Kelly every 30 min, and publishes `desk-archives/pickoffs.json` plus a replay
index and one replay blob per match to Supabase storage. The Next.js app reads
those blobs and renders the site - every headline number is dynamic, never
hard-coded, and per-match replay data is served through CDN-cached routes (a
finished match never changes). Full detail in [`TECHNICAL.md`](./TECHNICAL.md).

## Verifiability

Both legs are public. The **fair** side is TxLINE's World Cup feed - odds and
scores anchored on Solana, access minted by a real on-chain **subscribe**
transaction (surfaced on `/proof`). The **market** side is real fills read
straight from Polygon, decoded to a price and size per trade. Open any fill as a
Polygon transaction, settle any outcome on TxLINE's on-chain scores, and recompute
the edge yourself. Nothing here is asserted.

## Endpoints

Public:

- `GET /api/live-edge` - live in-play divergences: `{ generatedAt, liveCount, theta, signals[] }`.
- `GET /api/replay-edge` - same shape over the bundled replay matches.
- `GET /api/replay-signals` - per-match replay feed with `entryFill`/`exitFill`, goal-watch and winner-hint; powers the open `npx lagisalpha` replay and `/launch`.
- `GET /api/live-stream` - tick-by-tick TxLINE + Polymarket snapshot behind `/live`.
- `GET /api/live-frames` - real-time TxLINE frames (polled snapshot).
- `GET /api/verify-csv` - per-frame verification CSV for reconciliation against the provider.

Signal API (authed - `Authorization: Bearer las_...`; buy a key at `/api`):

- `GET /api/v1/divergences` - the canonical trader signal feed. `?status=live`
  (gated to a live match, else `no matches live`), `?match=<fixtureId>&theta=5|10`
  (a settled match), or no params (match index). Each signal: `side`, `team` (the
  team whose price is cheap), `entry`, `fair` (take-profit target), `gapPp`,
  `suggestedKellyF`, `sizeAtFair`, `ts`.
- `GET /api/v1/fair` - current TxLINE de-vig fair per live fixture. We hold the
  TxLINE token and feed the fair, so a trader needs no TxLINE access of their own.
- `GET /api/v1/track-record` - pooled reach / Kelly ROI / CI plus per-match edge.

Retired (`410 Gone`): `/api/v1/signals`, `/edges`, `/archive`, `/calibration`,
`/control-room` - the operator-era line-integrity surfaces.

Consumer / API pricing: USDC, chain-agnostic - **$97.99** and **$699.99** tiers.

## TxLINE endpoints used

Access uses a server-held token (guest JWT + an on-chain Solana **subscribe**
transaction → `apiToken`), sent as `Authorization: Bearer <jwt>` +
`X-Api-Token: <token>`. The subscribe tx is the on-chain proof of access (`/proof`).

- `GET /api/fixtures/snapshot` - live fixtures, team names, kickoff times.
- `GET /api/odds/stream` - live **de-margined (no-vig)** odds (SSE) - the core signal input.
- `GET /api/scores/stream` - live scores + match events (goals / red cards, SSE).
- `GET /api/odds/snapshot/{fixtureId}` - current de-margined book, polled for the real-time frames panel.
- `GET /api/scores/updates/{fixtureId}` - full kickoff-to-FT score sequence, used to capture matches for the bundled replays.

> Odds history is gated (`/api/odds/updates` is empty on the free tier), so the
> de-margined book is captured live off `/api/odds/stream`.

## Configuration

| Env | Purpose |
| --- | --- |
| `FEED_MODE` | `replay` (bundled real captures, default), `live` (TxLINE streams), or `synth` (deterministic stand-in). |
| `TXLINE_API_BASE` / `TXLINE_JWT` / `TXLINE_API_TOKEN` | Server-held TxLINE token (guest JWT + on-chain subscribe). |
| `TXLINE_SIGNUP_TX` / `TXLINE_CLUSTER` | Solana subscribe tx + cluster - the on-chain proof of access shown on `/proof`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; the claim route appends issued `las_` API keys (sha256-hashed) to the private `desk-private/api-keys.json` store, and the Signal API validates against it with the same credential. Nothing about the key store is world-readable. |
| `REPLAY_SPEED` | Match-seconds per wall-second for replay mode (default 30). |

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

## License

AGPL-3.0.
