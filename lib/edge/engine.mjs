// EDGE ENGINE — the signal core of Agenthesis.
//
// It consumes the two TxLINE streams and emits "edges": short-lived, scarce
// betting opportunities grounded in the academic sports-market literature.
// Each research paper an agent runs maps to one edge kind below.
//
// Two edge kinds in v1:
//   1. STEAM  — the demargined fair probability for a market moves sharply within
//               a short window (new information / sharp money). Back the move.
//   2. OVERREACTION — right after a real match event (goal / red card, detected by
//               score deltas), the fair line swings beyond a threshold. The
//               literature says markets OVERREACT to surprise → fade it.
//
// The fair probability is taken straight from TxLINE's 'TXLineStablePriceDemargined'
// book: prob = 1 / (Prices[i] / 1000) (already no-vig; the two sides sum to ~1).
// That number is the input every Agenthesis agent trades.
import { EventEmitter } from "node:events";

const DEFAULTS = {
  steamThreshold: 0.04, // 4 percentage-point fair-prob move…
  steamWindowMs: 60_000, // …within 60s = a steam move
  overreactionThreshold: 0.08, // 8pp swing…
  overreactionWindowMs: 120_000, // …within 2min of a match event = overreaction
  quoteThreshold: 0.005, // baseline: ≥0.5pp drift surfaces a tradeable "quote"…
  quoteWindowMs: 60_000, // …measured over this window (0 disables quotes)
  historyMs: 180_000, // keep 3min of per-market history
  edgeTtlMs: 45_000, // an edge stays "open" 45s (scarcity)
  edgeFillLimit: 5_000, // max fake-USD stake per edge (scarcity)
  edgeCooldownMs: 90_000, // don't re-fire the same market+kind within this
};

// Match events worth reacting to, detected via score deltas (robust to Action naming).
const STAT_EVENTS = ["Goals", "RedCards"]; // YellowCards/Corners = lower impact (v1 ignores)

export class EdgeEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cfg = { ...DEFAULTS, ...opts };
    this.markets = new Map(); // marketKey -> { meta, history:[{ts,prob}] }
    this.fixtures = new Map(); // fixtureId -> { totals, lastEvent, clock, gameState }
    this.edges = new Map(); // edgeId -> edge
    this._lastFire = new Map(); // `${marketKey}|${kind}` -> ts (cooldown)
    this._seq = 0;
  }

  // ---- ingest -------------------------------------------------------------
  ingestOdds(rec) {
    const now = Number(rec.Ts) || Date.now();
    for (const { side, prob, idx } of this._fairProbs(rec)) {
      const marketKey = `${rec.FixtureId}|${rec.SuperOddsType}|${rec.MarketParameters}|${rec.MarketPeriod}|${side}`;
      let m = this.markets.get(marketKey);
      if (!m) {
        m = {
          meta: {
            fixtureId: rec.FixtureId,
            superOddsType: rec.SuperOddsType,
            marketParameters: rec.MarketParameters,
            marketPeriod: rec.MarketPeriod,
            side,
            sideIndex: idx,
            inRunning: rec.InRunning,
          },
          history: [],
        };
        this.markets.set(marketKey, m);
      }
      m.meta.inRunning = rec.InRunning;
      m.history.push({ ts: now, prob });
      this._trim(m.history, now);

      // STEAM: compare to the prob one window ago. A sharp move in the minutes
      // right after a goal / red card is an OVERREACTION, not sharp money, so we
      // suppress steam there and let the overreaction branch own that swing.
      const fxSteam = this.fixtures.get(rec.FixtureId);
      const recentEvent = fxSteam?.lastEvent && now - fxSteam.lastEvent.ts <= this.cfg.overreactionWindowMs;
      let steamFired = false;
      const pastSteam = this._probAt(m.history, now - this.cfg.steamWindowMs);
      if (pastSteam != null && !recentEvent) {
        const delta = prob - pastSteam;
        if (Math.abs(delta) >= this.cfg.steamThreshold) {
          steamFired = !!this._fire("steam", marketKey, m.meta, {
            edgeMeasure: Math.abs(delta),
            fairProb: prob,
            direction: delta > 0 ? "back" : "lay", // prob rising → back this side
            note: `fair prob ${(pastSteam * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}% in ≤${this.cfg.steamWindowMs / 1000}s`,
          });
        }
      }

      // OVERREACTION: a recent match event + a big swing since it.
      let overFired = false;
      const fx = this.fixtures.get(rec.FixtureId);
      if (fx?.lastEvent && now - fx.lastEvent.ts <= this.cfg.overreactionWindowMs) {
        const atEvent = this._probAt(m.history, fx.lastEvent.ts);
        if (atEvent != null) {
          const swing = prob - atEvent;
          if (Math.abs(swing) >= this.cfg.overreactionThreshold) {
            overFired = !!this._fire("overreaction", marketKey, m.meta, {
              edgeMeasure: Math.abs(swing),
              fairProb: prob,
              direction: swing > 0 ? "lay" : "back", // FADE the overshoot
              trigger: fx.lastEvent.label,
              note: `${fx.lastEvent.label}: ${(atEvent * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}% — fade the overreaction`,
            });
          }
        }
      }

      // QUOTE (baseline): the always-available signal so a tuned agent can trade
      // the live book even when no sharp move or event fires. We surface a
      // low-conviction opportunity on small micro-drift and FADE it (mean-revert
      // the noise on a stable book). Suppressed when a stronger edge already owns
      // this update, or during the post-event overreaction window.
      if (this.cfg.quoteThreshold > 0 && !steamFired && !overFired && !recentEvent) {
        const pastQuote = this._probAt(m.history, now - this.cfg.quoteWindowMs);
        if (pastQuote != null) {
          const drift = prob - pastQuote;
          if (Math.abs(drift) >= this.cfg.quoteThreshold) {
            this._fire("quote", marketKey, m.meta, {
              edgeMeasure: Math.abs(drift),
              fairProb: prob,
              direction: drift > 0 ? "lay" : "back", // fade micro-drift (mean reversion)
              note: `baseline: ${(pastQuote * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}% micro-drift`,
            });
          }
        }
      }
    }
  }

  ingestScores(rec) {
    const now = Number(rec.Ts) || Date.now();
    // Seed running totals at 0: a team with no goals simply omits the Goals key,
    // so absent == 0 at kickoff. We then only move totals on frames that actually
    // carry a stat — never on silent frames — which is the whole anti-phantom fix.
    const fx =
      this.fixtures.get(rec.FixtureId) ||
      { totals: { Participant1: { Goals: 0, RedCards: 0 }, Participant2: { Goals: 0, RedCards: 0 } } };
    fx.clock = rec.Clock;
    fx.gameState = rec.GameState;

    // Stats are monotonic (a goal/red card can't un-happen) EXCEPT a VAR overturn,
    // the one legitimate decrease. So we carry a running max forward and ignore
    // sparse frames (Score objects only restate stats that changed). This stops a
    // frame that omits Goals from reading as 0 and flapping into a phantom goal.
    const overturned =
      rec.Action === "action_discarded" ||
      (rec.Action === "var_end" && rec.Data?.Outcome === "Overturned");

    const frame = this._extractTotals(rec.Score); // null where the frame is silent
    for (const part of ["Participant1", "Participant2"]) {
      for (const stat of STAT_EVENTS) {
        const cur = frame[part]?.[stat];
        if (cur == null) continue; // frame says nothing about this stat → keep last-known
        const prev = fx.totals[part][stat] ?? 0;
        const next = overturned ? cur : Math.max(prev, cur);
        if (next > prev) {
          const label = `${stat === "Goals" ? "GOAL" : "RED CARD"} (${part})`;
          fx.lastEvent = { stat, part, label, ts: now, action: rec.Action };
          this.emit("matchEvent", {
            fixtureId: rec.FixtureId,
            label,
            stat,
            participant: part,
            clock: rec.Clock,
            ts: now,
          });
        }
        fx.totals[part][stat] = next;
      }
    }
    this.fixtures.set(rec.FixtureId, fx);
  }

  // ---- edge lifecycle -----------------------------------------------------
  _fire(kind, marketKey, meta, payload) {
    const fireKey = `${marketKey}|${kind}`;
    const now = Date.now();
    const last = this._lastFire.get(fireKey) || 0;
    if (now - last < this.cfg.edgeCooldownMs) return; // de-dupe bursts
    this._lastFire.set(fireKey, now);

    const id = `edge_${++this._seq}`;
    const edge = {
      id,
      kind,
      market: { ...meta },
      conviction: this._tier(payload.edgeMeasure),
      openedAt: now,
      expiresAt: now + this.cfg.edgeTtlMs,
      fillLimit: this.cfg.edgeFillLimit,
      filled: 0,
      status: "open",
      ...payload,
    };
    this.edges.set(id, edge);
    setTimeout(() => this._expire(id), this.cfg.edgeTtlMs).unref?.();
    this.emit("edge", edge);
    return edge;
  }

  _expire(id) {
    const e = this.edges.get(id);
    if (e && e.status === "open") {
      e.status = "expired";
      this.emit("edgeClosed", e);
    }
  }

  // Record a fake-USD stake against an open edge (respects fill limit + expiry).
  stake(edgeId, amount) {
    const e = this.edges.get(edgeId);
    if (!e || e.status !== "open" || Date.now() > e.expiresAt) return { ok: false, reason: "closed" };
    const room = e.fillLimit - e.filled;
    if (room <= 0) return { ok: false, reason: "filled" };
    const accepted = Math.min(amount, room);
    e.filled += accepted;
    if (e.filled >= e.fillLimit) {
      e.status = "filled";
      this.emit("edgeClosed", e);
    }
    return { ok: true, accepted, remaining: e.fillLimit - e.filled };
  }

  openEdges() {
    const now = Date.now();
    return [...this.edges.values()].filter((e) => e.status === "open" && now <= e.expiresAt);
  }

  // Latest demargined fair prob for the market an edge belongs to (for marking).
  fairProbForMarket(meta) {
    const marketKey = `${meta.fixtureId}|${meta.superOddsType}|${meta.marketParameters}|${meta.marketPeriod}|${meta.side}`;
    const m = this.markets.get(marketKey);
    if (!m || !m.history.length) return null;
    return m.history[m.history.length - 1].prob;
  }

  // Current match minute for a fixture (from the scores clock), or null.
  matchMinute(fixtureId) {
    const fx = this.fixtures.get(fixtureId);
    const sec = fx?.clock?.Seconds ?? fx?.clock?.seconds;
    return sec == null ? null : Math.floor(Number(sec) / 60);
  }

  // ---- helpers ------------------------------------------------------------
  _fairProbs(rec) {
    const names = rec.PriceNames || [];
    const prices = rec.Prices || [];
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const p = Number(prices[i]);
      if (!(p > 0)) continue;
      const prob = 1 / (p / 1000);
      // Skip near-settled / suspended prices: a book collapsing to ~0 or ~1 is a
      // market closing, not a tradeable signal — guards against artifact swings.
      if (prob < 0.02 || prob > 0.98) continue;
      out.push({ side: names[i], idx: i, prob });
    }
    return out;
  }

  _extractTotals(score) {
    // Return null (not 0) for any stat the frame doesn't carry, so the caller can
    // tell "this frame is silent on Goals" apart from "Goals is genuinely 0". The
    // ?? 0 default was the phantom-goal bug: a sparse frame read 0 and flapped.
    const pick = (p) => {
      const t = score?.[p]?.Total || {};
      return {
        Goals: t.Goals ?? null,
        RedCards: t.RedCards ?? null,
        YellowCards: t.YellowCards ?? null,
        Corners: t.Corners ?? null,
      };
    };
    return { Participant1: pick("Participant1"), Participant2: pick("Participant2") };
  }

  _probAt(history, ts) {
    // last sample at or before ts
    let best = null;
    for (const h of history) {
      if (h.ts <= ts) best = h.prob;
      else break;
    }
    return best;
  }

  _trim(history, now) {
    const cutoff = now - this.cfg.historyMs;
    while (history.length && history[0].ts < cutoff) history.shift();
  }

  _tier(measure) {
    if (measure >= 0.1) return "High";
    if (measure >= 0.06) return "Medium";
    return "Low";
  }
}
