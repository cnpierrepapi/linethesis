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

## The edge in one paragraph

Work in probability space. TxLINE's de-vig 1X2 gives the fair probability a team
wins; the market's moneyline gives its own probability of the same event. When
fair sits above the market price by more than a threshold, the cheap side is
underpriced and we mark an entry - which side, how far off fair, and how much size
you could later exit into at fair. Buy the cheap side, take profit at fair when
the market catches up, size each bet by Kelly on the gap. Holding to the final
result is a losing trade on this data; the convergence is where the money is.

## The proof

Measured on settled World Cup matches, on the real fills:

- **Reach** - does the market price travel back to fair before the match ends?
  ~71% of the time. Outcome-independent, so it is the firmer number.
- **Return** - Kelly-sized, take-profit-at-fair, compounded:
  **≈ +114%** at a 5-point gap, **≈ +158%** at 10. The same bets held to the final
  result instead lose (≈ −80% / −42%).

Pilot sample (10 matches): the confidence interval still spans zero and the
return leans on a few high-volume matches, so it is a pilot, not a promise. Reach
is the firmer read; both tighten as matches accrue.

## Architecture (short version)

TxLINE SSE (fair) + Polymarket fills (Polygon) → EC2 pipeline → Supabase blob →
Next.js site. A Python pipeline on an EC2 box streams the de-vig fair line,
decodes real Polymarket fills from Polygon, joins them, computes reach / return /
Kelly every 30 min, and publishes `desk-archives/pickoffs.json` to Supabase
storage. The Next.js app reads that blob and renders the site - every headline
number is dynamic, never hard-coded. Full detail in [`TECHNICAL.md`](./TECHNICAL.md).

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
- `GET /api/live-frames` - real-time TxLINE frames (polled snapshot).
- `GET /api/verify-csv` - per-frame verification CSV for reconciliation against the provider.

Signal API (authed - `Authorization: Bearer las_...`; buy a key at `/api`):

- `GET /api/v1/divergences` - the canonical trader signal feed. `?status=live`
  (gated to a live match, else `no matches live`), `?match=<fixtureId>&theta=5|10`
  (a settled match), or no params (match index). Each signal: `side`, `entry`,
  `fair` (take-profit target), `gapPp`, `suggestedKellyF`, `sizeAtFair`, `ts`.
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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; lets the claim route append issued `las_` API keys (sha256-hashed) to `desk-archives/api-keys.json`. The Signal API validates against that public hashed blob. |
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
