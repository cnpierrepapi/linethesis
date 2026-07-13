"use client";

// PROOF LEDGER — the same divergence entries you see on /edge, but each one opens into the
// actual Polygon transactions that traded at your take-profit price (TxLINE fair). /edge asks "does the signal grade?";
// /proof answers "and here are the on-chain fills that prove the cheap side really sat there."
// Click any entry to expand its fills; each `verify ↗` is a real tx you can open on Polygonscan.
//
// EVERY call counts: there is no exclusion filter. The record rolls on its own — either side, any
// size, any minute — and Kelly sizing (capped at 30% per call) is the only risk control. See
// lib/signals/policy.ts.

import { Fragment, useMemo, useState } from "react";
import type { PickoffMatch, DivergenceEntry, PooledStat } from "@/lib/pickoff-source";
import { polygonTx } from "@/lib/pickoff-source";
import { pooledStats, matchKellyRoi } from "@/lib/signals/policy";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const roi = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(0) + "%";
const clock = (t: number, kick: number) => `${Math.max(0, Math.floor((t * 1000 - kick) / 60000))}'`;

function EntryRows({ divs, kick, teams }: { divs: DivergenceEntry[]; kick: number; teams: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const parts = teams.split(/\s+v\s+/i);
  // yes = second-named team (participant 2), no = first-named. A label for which price is cheap, not
  // an outcome bet: the trade is the price converging to fair.
  const teamOf = (side: string) => (parts.length === 2 ? (side === "yes" ? parts[1] : parts[0]).trim() : side.toUpperCase());
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1 font-normal">min</th>
            <th className="py-1 font-normal">cheap side</th>
            <th className="py-1 font-normal">entry price</th>
            <th className="py-1 font-normal">TxLINE fair</th>
            <th className="py-1 font-normal">gap</th>
            <th className="py-1 font-normal">size avail.</th>
            <th className="py-1 font-normal">reached fair</th>
            <th className="py-1 font-normal">on-chain</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {divs.map((e, i) => {
            const on = open === i;
            const fills = e.fills ?? [];
            // expandable when there's any on-chain leg to show: exit fills (reached) OR the entry fill
            const canOpen = fills.length > 0 || !!e.entryFill;
            return (
              <Fragment key={i}>
                <tr
                  onClick={() => canOpen && setOpen(on ? null : i)}
                  className={`border-t border-ink-700 ${canOpen ? "cursor-pointer" : ""} ${on ? "bg-amber/10" : canOpen ? "hover:bg-ink-800/60" : ""}`}
                >
                  <td className="py-1.5 text-muted">{clock(e.t, kick)}</td>
                  <td className="py-1.5 text-fg">{teamOf(e.side)}</td>
                  <td className="py-1.5 text-muted">{e.entry.toFixed(3)}</td>
                  <td className="py-1.5 text-fg">{(e.side === "yes" ? e.fair : 1 - e.fair).toFixed(3)}</td>
                  <td className="py-1.5 text-muted">{(Math.abs(e.gap) * 100).toFixed(1)}pp</td>
                  <td className="py-1.5 text-fg">{usd(e.usd ?? 0)}</td>
                  <td className={`py-1.5 ${e.reached ? "text-amber" : "text-faint"}`}>{e.reached ? "✓" : "✗"}</td>
                  <td className="py-1.5 text-faint">{canOpen ? (on ? "hide ▲" : fills.length > 0 ? `${fills.length} fills ▾` : "entry ▾") : "—"}</td>
                </tr>
                {on && (
                  <tr className="border-t border-ink-800 bg-ink-900/40">
                    <td colSpan={8} className="px-3 py-2">
                      {e.entryFill && (
                        <p className="mb-1 text-[11px] text-faint">
                          entry leg — the cheap side really traded at {e.entry.toFixed(3)}:{" "}
                          <a
                            href={polygonTx(e.entryFill.tx)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted underline decoration-ink-500 underline-offset-2 hover:text-fg"
                          >
                            {e.entryFill.tx.slice(0, 10)}… verify ↗
                          </a>
                        </p>
                      )}
                      {fills.length > 0 ? (
                        <p className="mb-1 text-[11px] text-faint">
                          exit leg — real fills that traded at your take-profit price (TxLINE fair or better),
                          closest to fair first; {usd(e.usd ?? 0)} total traded at/through fair. Each is a
                          Polygon transaction you can open and confirm the liquidity really sat there.
                        </p>
                      ) : (
                        <p className="mb-1 text-[11px] text-faint">
                          never reached fair — no exit fill (marked out at the close, no take-profit claimed).
                        </p>
                      )}
                      {fills.length > 0 && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-faint">
                            <th className="py-0.5 font-normal">traded at</th>
                            <th className="py-0.5 font-normal">past fair</th>
                            <th className="py-0.5 font-normal">size</th>
                            <th className="py-0.5 font-normal">tx</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {fills.map((f, k) => (
                            <tr key={k}>
                              <td className="py-0.5 text-fg">{f.price.toFixed(3)}</td>
                              <td className="py-0.5 text-amber">{f.gapPp > 0 ? "+" : ""}{f.gapPp}pp</td>
                              <td className="py-0.5 text-muted">{usd(f.usd)}</td>
                              <td className="py-0.5">
                                <a
                                  href={polygonTx(f.tx)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-amber underline decoration-ink-500 underline-offset-2 hover:text-fg"
                                >
                                  {f.tx.slice(0, 10)}… verify ↗
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatchCard({ m, theta }: { m: PickoffMatch; theta: "5" | "10" }) {
  const divs = m.divergences?.[theta] ?? [];
  const size = divs.reduce((s, e) => s + (e.usd ?? 0), 0);
  const reachRate = divs.length ? divs.filter((e) => e.reached).length / divs.length : null;
  const kellyRoi = matchKellyRoi(divs);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="serif text-xl text-paper">{m.teams}</h3>
        <span className="font-mono text-xs text-faint">{m.slug}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="serif text-2xl text-fg">{divs.length}</p>
          <p className="text-xs text-muted">signals</p>
        </div>
        <div>
          <p className="serif text-2xl text-amber">{reachRate != null ? (reachRate * 100).toFixed(0) + "%" : "—"}</p>
          <p className="text-xs text-muted">reached TxLINE</p>
        </div>
        <div>
          <p className={`serif text-2xl ${kellyRoi != null && kellyRoi >= 0 ? "text-amber" : "text-muted"}`}>{kellyRoi != null ? roi(kellyRoi) : "—"}</p>
          <p className="text-xs text-muted">ROI · Kelly, take-profit</p>
        </div>
        <div>
          <p className="serif text-2xl text-fg">{usd(size)}</p>
          <p className="text-xs text-muted">size available</p>
        </div>
      </div>

      <p className="label mt-5">every call · click to open the on-chain fills</p>
      {divs.length > 0 ? (
        <EntryRows divs={divs} kick={m.kick} teams={m.teams} />
      ) : (
        <p className="mt-2 text-sm text-faint">No divergence past {theta}pp in this match.</p>
      )}
    </div>
  );
}

export default function ProofLedger({
  matches,
  pooled,
}: {
  matches: PickoffMatch[];
  pooled?: Record<string, PooledStat>;
}) {
  const [theta, setTheta] = useState<"5" | "10">("5");
  const withEdge = matches.filter((m) => (m.divergences?.[theta]?.length ?? 0) > 0);
  // per-match cards, ranked by ROI so the strongest matches lead
  const rankedMatches = useMemo(
    () => [...withEdge].sort((a, b) => (matchKellyRoi(b.divergences?.[theta] ?? []) ?? -1) - (matchKellyRoi(a.divergences?.[theta] ?? []) ?? -1)),
    [withEdge, theta],
  );
  // Pooled over EVERY call, derived client-side (a stale blob can never NaN the page).
  const p = useMemo(
    () => pooledStats(withEdge.map((m) => ({ divs: m.divergences?.[theta] ?? [], kick: m.kick }))),
    [withEdge, theta],
  );

  return (
    <div className="space-y-6">
      {/* SIGNAL CALIBRATION — the edge graded on the real fills */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="label">signal calibration · the delay, graded across {withEdge.length} matches</p>
          <div className="flex gap-1 text-xs">
            {(["5", "10"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheta(t)}
                className={`rounded px-2 py-0.5 ${theta === t ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}
              >
                ≥{t}pp
              </button>
            ))}
          </div>
        </div>
        {p && p.n ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="card p-4">
                <p className="serif text-2xl text-amber">{(p.reachRate * 100).toFixed(0)}%</p>
                <p className="text-xs text-muted">book reached TxLINE</p>
              </div>
              <div className="card p-4">
                <p className={`serif text-2xl ${p.kellyRoi >= 0 ? "text-amber" : "text-muted"}`}>{roi(p.kellyRoi)}</p>
                <p className="text-xs text-muted">ROI · Kelly-sized, take-profit at fair</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{p.n}</p>
                <p className="text-xs text-muted">signals · every call, unfiltered</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{usd(p.usd)}</p>
                <p className="text-xs text-muted">size available at fair (exit)</p>
              </div>
            </div>

            {/* THE FULL RECORD, NO FILTER — evidence, not assertion */}
            <div className="mt-3 rounded border border-ink-700 bg-ink-900/40 p-4">
              <p className="label">the full record: every call, Kelly-sized (capped at 30%), nothing curated</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className={`serif text-xl ${p.kellyRoi >= 0 ? "text-amber" : "text-muted"}`}>{roi(p.kellyRoi)}</p>
                  <p className="text-xs text-muted">Kelly bets, take profit when the line reaches fair</p>
                </div>
                <div>
                  <p className={`serif text-xl ${(p.kellyRoiRes ?? 0) >= 0 ? "text-amber" : "text-loss"}`}>{roi(p.kellyRoiRes ?? 0)}</p>
                  <p className="text-xs text-muted">the SAME Kelly bets, held to the final result instead</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-faint">
                Nothing is filtered out: every divergence the detector fires is published and scored, either
                side, any size, any minute. Sizing is the only risk control — each bet is Kelly on its gap,
                f = gap / (1 − price), capped at 30% of the free balance so no single call can ruin the
                account (full Kelly, uncapped, once staked 81% on one call and gave back 76% of the bankroll).
                The firm result is the reach rate: the market travels to TxLINE&apos;s fair on roughly
                {" "}{(p.reachRate * 100).toFixed(0)}% of calls, and exiting there beats holding the same bets
                to the final result by a wide margin (the coin-flip outcome gives the convergence profit
                back). The compounded ROI is positive but concentrated in a few high-volume matches — it is
                the raw product of every call, shown as-is, and it moves as each new match settles. Pilot
                sample; recomputed from the real fills.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-faint">No divergence past {theta}pp yet.</p>
        )}
      </div>

      {/* PER-MATCH — sorted by ROI (best first), each expandable to its on-chain fills */}
      <div className="grid grid-cols-1 gap-5">
        {rankedMatches.map((m) => (
          <MatchCard key={m.fid} m={m} theta={theta} />
        ))}
      </div>
    </div>
  );
}
