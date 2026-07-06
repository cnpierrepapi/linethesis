# Lagisalpha - Technical Documentation

> The engineering companion to the [litepaper](https://lagisalpha.vercel.app/litepaper).
> The litepaper explains *why the edge is real*; this document explains *how the
> system is built and how to verify it yourself*.

---

## 1. What it is

Lagisalpha measures the **lead-lag delay** between a prediction market and a
sharp, vig-free reference line.

TxLINE strips the bookmaker margin from a live World Cup odds feed to produce the
*true* probability, which moves the instant news lands. A prediction market
(Polymarket) reprices only when someone trades, so it sits **behind** that true
probability - and the lagging side is temporarily underpriced. Lagisalpha detects
that divergence, sizes the trade by Kelly, takes profit at fair, and proves the
result on **real on-chain fills**.

It is a **measurement-and-signal product, not a book**: it never takes the other
side of a bet.

---

## 2. System architecture

Three planes, one data flow: TxLINE + Polygon → EC2 pipeline → Supabase blob →
Next.js site.

```
  TxLINE SSE (de-vig fair)            Polymarket fills (Polygon)
          │                                    │
          ▼                                    ▼
  ┌─────────────────────── EC2 box (eu-west-1) ───────────────────────┐
  │  lagisalpha-livestream   agenthesis-worker   poly_pickoff_system  │
  │  poly_live_collector      compute_edge.py     live_edge.py        │
  └───────────────────────────────┬───────────────────────────────────┘
                                   ▼
                 Supabase storage:  desk-archives/pickoffs.json
                                   │
                                   ▼
                 Next.js on Vercel  ( lagisalpha.vercel.app )
                 /  ·  /proof  ·  /edge  ·  /litepaper  ·  /sdk
```

### A. Data plane - the EC2 worker box

Host `54.229.238.5` (eu-west-1, user `ec2-user`), systemd services + cron:

| Component | Role |
| --- | --- |
| `lagisalpha-livestream` (service) | One upstream connection to TxLINE odds + scores SSE; publishes the de-vig **fair** line per fixture. |
| `agenthesis-worker` (service) | Archives each fixture's full odds/scores sequence → `live/<fixtureId>.json`. |
| `poly_pickoff_system.py` | Decodes real Polymarket fills from Polygon (NegRisk `OrderFilled` logs, ≤50-block chunks with exact block timestamps, token-bucket rate limiting, per-match checkpoint/resume). |
| `poly_live_collector.py` (cron `*/2`) | Tails the Polymarket Data API for live fills. |
| `compute_edge.py` (cron `*/30`) | Joins both sides, computes reach / return / Kelly, publishes the result blob. |
| `live_edge.py` (cron `*/1`) | Emits live in-play divergence signals when a match is running. |

The `*/30` batch also runs `git pull origin master` before harvesting, so the box
self-updates from this repo each cycle.

### B. Storage plane

Published blob → **Supabase storage**: `desk-archives/pickoffs.json` (~600 KB,
refreshed every 30 min). Shape:

```jsonc
{
  "generatedAt": 1783345200000,       // ms epoch of last publish
  "matchCount": 10,
  "totals": { "usd": 59476575, "ge5pp_usd": 6588751, "ge10pp_usd": 5151326, "fills": 211012 },
  "pooled": {
    "5":  { "kellyRoi": 1.1448, "reachRate": 0.712, "usd": 45078104, "n": 52, ... },
    "10": { "kellyRoi": 1.5812, "reachRate": 0.71,  "usd": 27914078, "n": 31, ... }
  },
  "matches": [ /* per-match reach/return + top_pickoffs */ ]
}
```

### C. Presentation plane - Next.js on Vercel

`lagisalpha.vercel.app` reads the Supabase blob and renders:

| Route | Purpose |
| --- | --- |
| `/` | Thesis + **dynamic** headline numbers (reach %, Kelly ROI, match count, size). |
| `/proof` | Per-match ledger: reach, return, USD size, top pickoffs. Server-rendered. |
| `/edge` | Live divergences as they fire. |
| `/litepaper` | The written thesis (+ downloadable PDF). |
| `/launch` | The pro-trader paper-trading terminal (web + `npx lagisalpha` CLI). |

Headline numbers are pulled from the blob via `lib/site-stats.ts` - never
hard-coded.

---

## 3. The signal (how the edge is computed)

1. Work in **probability space**. TxLINE de-vig 1X2 → fair `P(team wins)`.
   Polymarket moneyline → market `P(same event)`.
2. When `fair − marketPrice > threshold` (5pp and 10pp gaps are tracked), the
   cheap side is flagged as an **entry**: which side, the gap size, and the size
   you could later exit into at fair.
3. One dislocation is **one entry**, not a burst.

---

## 4. The proof (two settlement tests, on real fills)

Measured on the bundled/settled World Cup matches, against real Polygon fills.

- **Reach** - from the entry, does the market price travel to fair before the
  match ends? (~71% observed.) Outcome-independent, so it is the firmer number.
- **Return** - buy the cheap side, take profit at fair when the market catches
  up. Sized by Kelly on the gap, `f = gap / (1 − price)`, compounded across every
  call:
  - **θ 5pp: ≈ +114% Kelly ROI** · **θ 10pp: ≈ +158%**
  - The same bets **held to the final result lose** (≈ −80% / −42%) - convergence
    is where the money is; the outcome is a coin-flip that only adds variance.

**Honesty bound.** Pilot sample (10 matches). The confidence interval still spans
zero, and the return is concentrated in a few high-volume matches. Reach is the
firmer read; both tighten as matches accrue.

---

## 5. Verifiability (both legs are public)

- **Fair side:** TxLINE World Cup feed, odds + scores anchored on Solana; access
  minted by a real on-chain **subscribe** transaction (surfaced on `/proof`).
  Scores settle on-chain.
- **Market side:** raw Polymarket fills read from Polygon - open any fill as a
  Polygon transaction and recompute the price and size yourself.
- Nothing is asserted: every published number recomputes from public data.

---

## 6. API surface

Public (no auth):

| Endpoint | Returns |
| --- | --- |
| `GET /api/live-edge` | `{ generatedAt, liveCount, theta, signals[] }` - live in-play divergences. |
| `GET /api/replay-edge` | Same shape, over the bundled replay matches. |
| `GET /api/live-frames` | Real-time TxLINE frames (polled snapshot). |
| `GET /api/verify-csv` | Per-frame verification CSV for reconciliation against the provider. |

Signal API (authed - `Authorization: Bearer las_...`; buy a key at `/api`):

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/divergences` | The canonical trader signal feed. `?status=live` (gated to a live match, else `no matches live`), `?match=<fixtureId>&theta=5\|10` (settled match), or no params (match index). Each signal: `side`, `entry`, `fair` (take-profit target), `gapPp`, `suggestedKellyF`, `sizeAtFair`, `ts`. |
| `GET /api/v1/fair` | Current TxLINE de-vig fair per live fixture. We hold the TxLINE token and feed the fair, so a trader needs no TxLINE access of their own. |
| `GET /api/v1/track-record` | Pooled reach / Kelly ROI / CI plus per-match edge. |

Retired (`410 Gone`): `/api/v1/signals`, `/edges`, `/archive`, `/calibration`, `/control-room` - the operator-era line-integrity surfaces.

Consumer/API pricing: USDC, chain-agnostic - **$97.99** and **$699.99** tiers.

---

## 7. Reproduce it

- **Site:** <https://lagisalpha.vercel.app>
- **Data blob:** `https://mohbmvajroqizlfaarjk.supabase.co/storage/v1/object/public/desk-archives/pickoffs.json`
- **Pipeline:** the EC2 crons above regenerate the blob end-to-end every 30 min
  from live TxLINE SSE + Polygon fills.
- **Local:**

  ```bash
  npm install
  npm run dev        # http://localhost:3000
  npm run typecheck
  npm run build
  ```

  Requires a server-held TxLINE token (guest JWT + on-chain subscribe) and the
  Supabase blob URL. See [`README.md`](./README.md) for the full env table.

---

## 8. Stack

Next.js (Vercel) · Python pipeline (EC2, systemd + cron) · Supabase storage ·
TxLINE / TxODDS World Cup data layer (Solana-anchored) · Polygon (Polymarket
fills).

---

## 9. What we do not claim

This measures a **delay between two markets** on a pilot sample. It is not a
trading strategy, not financial advice, and any sizing or slippage is your own.
License: AGPL-3.0.
