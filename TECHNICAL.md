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
  │  agenthesis-worker    poly_pickoff_system    compute_edge.py      │
  │  goal_watch.py        fair-anchor            lagisalpha-telegram  │
  └───────────────────────────────┬───────────────────────────────────┘
                                   ▼
                 Supabase storage:  desk-archives/pickoffs.json
                                   │
                                   ▼
                 Next.js on Vercel  ( lagisalpha.vercel.app )
                 /  ·  /proof  ·  /edge  ·  /litepaper  ·  /launch
```

### A. Data plane - the EC2 worker box

Host `54.229.238.5` (eu-west-1, user `ec2-user`), systemd services + cron:

> The real-time loop (`lagisalpha-livestream` service, `live_detect.py`, and the
> `poly_live_collector.py` / `poly_live_chain.py` `*/2` tailers) was retired when the
> tournament closed. The files remain on the box as an inert rollback surface; the
> archival pipeline below is what runs.

| Component | Role |
| --- | --- |
| `agenthesis-worker` (service) | Archives each fixture's full odds/scores sequence → `live/<fixtureId>.json`. |
| `poly_pickoff_system.py` (cron `*/30`) | Decodes real Polymarket fills from Polygon (NegRisk `OrderFilled` logs, ≤50-block chunks with exact block timestamps, token-bucket rate limiting, per-match checkpoint/resume), including the full post-FT fill history for each settled match. |
| `goal_watch.py` (cron `*/30`) | Clusters TxLINE high-danger possession into the per-match goal-watch overlay. |
| `compute_edge.py` (cron `*/30`) | Joins both sides, computes reach / return / Kelly, publishes the result blob. Reads finished archives from a local cache (`~/archive-cache/`) **validated against the published blob's `Content-Length`**, so a finished archive downloads once but a mid-match partial can never shadow it. |
| `fair-anchor` (cron `15,45`) | Anchors the TxLINE fair at every fill second on Solana (`validate_odds`) and publishes the `fair-proofs.json` sidecar. |
| `lagisalpha-telegram` (service) | Node long-poll bot ([@lagisalphabot](https://t.me/lagisalphabot)); pushes signals, paper fills, goal-watch and the winner overlay, alerts-only or paper. Self-contained, mirrors the `npx lagisalpha` engine. |

The `*/30` batch also runs `git pull origin master` before harvesting, so the box
self-updates from this repo each cycle.

### B. Storage plane

Published blob → **Supabase storage**: `desk-archives/pickoffs.json` (~600 KB,
refreshed every 30 min). Shape:

```jsonc
// Illustrative SHAPE only. The pipeline republishes this blob every 30 min and every
// figure recomputes from public data, so the live values move as matches accrue and
// fills backfill. Do not read these as current - fetch /proof or the blob for that.
{
  "generatedAt": 1783600000000,       // ms epoch of last publish
  "matchCount": 18,
  "totals": { "usd": 112681216, "ge5pp_usd": 10556863, "ge10pp_usd": 8146348, "fills": 464034 },
  "pooled": {                          // over EVERY call (no exclusion; Kelly capped at 30%/call); recomputed live
    "5":  { "kellyRoi": 4.27, "reachRate": 0.783, "kellyRoiRes": -0.98, "n": 106, ... },
    "10": { "kellyRoi": 5.67, "reachRate": 0.766, "kellyRoiRes": -0.54, "n": 64, ... }
  },
  "matches": [ /* per-match reach/return + winnerHint (graded live, draw = pending) */ ]
}
```

Replay data ships **split**: a small `desk-archives/replays-index.json` (fid,
label, frame count - what the `/live` replay picker lists) plus one
`desk-archives/replays/<fid>.json` per match (the downsampled odds/scores series,
~4 MB) for the 12 most-recent matches. A finished match is immutable, so these
blobs never change once published. The raw full-resolution archives live at
`desk-archives/live/<fid>.json`, one per fixture, written by the worker at full
time.

### C. Presentation plane - Next.js on Vercel

`lagisalpha.vercel.app` reads the Supabase blob and renders:

| Route | Purpose |
| --- | --- |
| `/` | Thesis + **dynamic** headline numbers (reach %, Kelly ROI, match count, size). |
| `/proof` | Per-match ledger: reach, return, USD size, top pickoffs. Server-rendered. |
| `/edge` | The divergence feed across every settled match. |
| `/api` | Request a free API key (still required as the metering unit; pricing models in the litepaper). |
| `/litepaper` | The written thesis (+ downloadable PDF). |
| `/launch` | The pro-trader paper-trading terminal: `npx lagisalpha` in any terminal, plus the Telegram bot ([@lagisalphabot](https://t.me/lagisalphabot)). |

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
  match ends? Currently **~78%** over every call, none excluded, and recomputed
  live on `/proof` as matches accrue. Outcome-independent, so it is the firmer number.
- **Return** - buy the cheap side, take profit at fair when the market catches up.
  Sized by Kelly on the gap, `f = gap / (1 − price)`, **capped at 30% per call**,
  compounded across every call. Take-profit-at-fair far exceeds holding the same
  bets to the final result: the convergence is where the money is, the outcome only
  adds variance. See `/proof` for the current pooled Kelly ROI - it is recomputed
  live from the blob, never hard-coded here, and published as-is (the compound is
  concentrated at pilot size, carried by a few high-volume matches).

**Honesty bound.** Pilot sample (18 matches). The confidence interval still spans
zero, and the compounded return swings on a few giant calls. Reach is the firmer
read; both tighten as matches accrue.

---

## 5. Verifiability (both legs are public)

- **Fair side:** TxLINE World Cup feed, odds + scores anchored on Solana; access
  minted by a real on-chain **subscribe** transaction (surfaced on `/proof`).
  Scores settle on-chain.
- **Market side:** raw Polymarket fills read from Polygon - open any fill as a
  Polygon transaction and recompute the price and size yourself.
- **Both legs of every signal are a real fill.** Each divergence carries an
  `entryFill` (the on-chain trade that set the cheap-side entry) and, when it
  reached fair, an `exitFill` (the fill **closest to fair**, above a $50 dust
  floor) - each a Polygon tx on `/proof`. `reached` is *defined* by that exit
  fill existing, so the reach rate (`/edge`) and the on-chain proofs (`/proof`)
  come from one source and cannot disagree.
- Nothing is asserted: every published number recomputes from public data.

---

## What we found (pilot)

The hackathon brief floated a **Sharp Movement Detector**: an agent that watches TxLINE
odds every 60s, flags significant shifts, and tracks whether they predicted the match
outcome. We built it, found it is a coin flip, and did one better.

All figures are from the pilot sample (the shift and goal-imminent analyses used the first
12 settled World Cup matches; reach recomputes live as matches accrue). In-sample; they need
out-of-sample confirmation.

- **Odds shifts alone do not call the winner.** A significant TxLINE fair shift by the 45th
  minute called the result **58%** of the time (7/12) - essentially a coin flip. The sharp
  line moving is not, by itself, an edge.
- **The lead-lag is the edge.** A goal is new information: TxLINE reprices it instantly, a
  prediction market only moves when someone trades, so for a window the cheap side sits below
  fair and converges **~78%** of the time. The record rolls unfiltered: every call the detector
  fires is published and scored - either side, any size, any minute, each side named by its
  team - and Kelly sizing (capped at 30% per call) is the only risk control. (An earlier signal
  policy cut two classes of buy-NO call; that filter is retired in favour of the sizing cap.)
- **Goal-imminent alerts flag better divergences.** TxLINE `high_danger_possession` makes a
  goal by that team ~**4x** more likely within 2 minutes (4.6% vs 1.1% baseline), and a
  divergence preceded by such an alert converged to fair **84%** vs **75%** without one - a
  soft confidence cue on top of the lag edge.

A **volume-to-divergence** read (the side with more traded money per point of divergence tends
to mark the match winner) rides along in the terminal as an experimental overlay. It is graded
live and penalty-honest - a regulation draw stays pending until the shootout settles - and we
do not lean on it as a headline claim.

---

## 6. API surface

Public (no auth):

| Endpoint | Returns |
| --- | --- |
| `GET /api/replay-edge` | The divergence feed over the bundled replay matches. |
| `GET /api/replay-signals` | Per-match replay feed (with `entryFill`/`exitFill`, goal-watch, winner-hint) that powers the open `npx lagisalpha` replay and `/launch`. `?match=<fixtureId>&theta=5\|10`, or no params for the match index. |
| `GET /api/replay-frames` | Per-match frame feed: no params = the match picker (served from the replay index), `?fixtureId=<fid>` = that match's downsampled frame series + goal timeline. CDN-cached with long max-age - a finished match never changes. |
| `GET /api/verify-csv` | Per-frame verification CSV for reconciliation against the provider. |

Signal API (authed - `Authorization: Bearer las_...`; get a free key at `/api`):

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/divergences` | The canonical trader signal feed. `?match=<fixtureId>&theta=5\|10` (settled match), or no params (match index). Each signal: `side`, `team` (the team whose price is cheap), `entry`, `fair` (take-profit target), `gapPp`, `suggestedKellyF`, `sizeAtFair`, `ts`. |
| `GET /api/v1/track-record` | Pooled reach / Kelly ROI / CI plus per-match edge. |

Retired (`410 Gone`): the live surface - `/api/v1/fair`, `/api/v1/divergences?status=live`, `/api/live-edge`, `/api/live-stream`, `/api/live-frames` (retired with the tournament) - and the operator-era line-integrity endpoints `/api/v1/signals`, `/edges`, `/archive`, `/calibration`, `/control-room`.

API access: a key is free but still required (the metering unit), issued at `POST /api/keys/free`.
How a production feed would be priced - a wholesale per-call signal API (tiered $0.028-$0.07/call)
and a managed-bot performance fee ($0.35-$7/executed call) - is set out in the litepaper.

---

## 7. Reproduce it

- **Site:** <https://lagisalpha.vercel.app>
- **Data blob:** `https://mohbmvajroqizlfaarjk.supabase.co/storage/v1/object/public/desk-archives/pickoffs.json`
- **Pipeline:** the EC2 crons above regenerate the blob end-to-end every 30 min
  from live TxLINE SSE + Polygon fills.
- **Caching contract:** small index blobs (`pickoffs.json`, `replays-index.json`)
  are fetched server-side with short revalidation; per-match replay blobs are
  served through CDN-cached routes with long max-age. Finished matches are
  treated as immutable, so nothing large is ever re-fetched per visitor.
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
