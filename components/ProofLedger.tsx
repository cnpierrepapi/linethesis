"use client";

// PROOF LEDGER — the same divergence entries you see on /edge, but each one opens into the
// actual Polygon transactions that traded at the stale price. /edge asks "does the signal grade?";
// /proof answers "and here are the on-chain fills that prove the cheap side really sat there."
// Click any entry to expand its fills; each `verify ↗` is a real tx you can open on Polygonscan.

import { Fragment, useState } from "react";
import type { PickoffMatch, DivergenceEntry, PooledStat } from "@/lib/pickoff-source";
import { polygonTx } from "@/lib/pickoff-source";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const sp = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
const clock = (t: number, kick: number) => `${Math.max(0, Math.floor((t * 1000 - kick) / 60000))}'`;

function EntryRows({ divs, kick }: { divs: DivergenceEntry[]; kick: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1 font-normal">min</th>
            <th className="py-1 font-normal">side</th>
            <th className="py-1 font-normal">entry price</th>
            <th className="py-1 font-normal">TxLINE fair</th>
            <th className="py-1 font-normal">gap</th>
            <th className="py-1 font-normal">size avail.</th>
            <th className="py-1 font-normal">reached</th>
            <th className="py-1 font-normal">won</th>
            <th className="py-1 font-normal">on-chain</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {divs.map((e, i) => {
            const on = open === i;
            const fills = e.fills ?? [];
            const canOpen = fills.length > 0;
            return (
              <Fragment key={i}>
                <tr
                  onClick={() => canOpen && setOpen(on ? null : i)}
                  className={`border-t border-ink-700 ${canOpen ? "cursor-pointer" : ""} ${on ? "bg-amber/10" : canOpen ? "hover:bg-ink-800/60" : ""}`}
                >
                  <td className="py-1.5 text-muted">{clock(e.t, kick)}</td>
                  <td className="py-1.5 text-fg">{e.side === "yes" ? "buy YES" : "buy NO"}</td>
                  <td className="py-1.5 text-muted">{e.entry.toFixed(3)}</td>
                  <td className="py-1.5 text-fg">{(e.side === "yes" ? e.fair : 1 - e.fair).toFixed(3)}</td>
                  <td className="py-1.5 text-muted">{(e.gap * 100).toFixed(1)}pp</td>
                  <td className="py-1.5 text-fg">{usd(e.usd ?? 0)}</td>
                  <td className={`py-1.5 ${e.reached ? "text-amber" : "text-faint"}`}>{e.reached ? "✓" : "✗"}</td>
                  <td className={`py-1.5 ${e.win ? "text-amber" : "text-faint"}`}>{e.win ? "✓" : "✗"}</td>
                  <td className="py-1.5 text-faint">{canOpen ? (on ? "hide ▲" : `${fills.length} fills ▾`) : "—"}</td>
                </tr>
                {on && (
                  <tr className="border-t border-ink-800 bg-ink-900/40">
                    <td colSpan={9} className="px-3 py-2">
                      <p className="mb-1 text-[11px] text-faint">
                        the fills that sat at the stale price and sum to {usd(e.usd ?? 0)}; each is a Polygon
                        transaction you can open and confirm the cheap side really traded there.
                      </p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-faint">
                            <th className="py-0.5 font-normal">traded at</th>
                            <th className="py-0.5 font-normal">gap vs fair</th>
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
  const edge = m.edge?.[theta];
  const size = divs.reduce((s, e) => s + (e.usd ?? 0), 0);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="serif text-xl text-paper">{m.teams}</h3>
        <span className="font-mono text-xs text-faint">{m.slug}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="serif text-2xl text-fg">{divs.length}</p>
          <p className="text-xs text-muted">divergence entries</p>
        </div>
        <div>
          <p className="serif text-2xl text-amber">{edge ? (edge.reachRate * 100).toFixed(0) + "%" : "—"}</p>
          <p className="text-xs text-muted">reached TxLINE</p>
        </div>
        <div>
          <p className={`serif text-2xl ${edge && edge.tpReturn >= 0 ? "text-amber" : "text-muted"}`}>{edge ? sp(edge.tpReturn) : "—"}</p>
          <p className="text-xs text-muted">take-profit return</p>
        </div>
        <div>
          <p className="serif text-2xl text-fg">{usd(size)}</p>
          <p className="text-xs text-muted">size available</p>
        </div>
      </div>

      <p className="label mt-5">every entry · click to open the on-chain fills</p>
      {divs.length > 0 ? (
        <EntryRows divs={divs} kick={m.kick} />
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
  const p = pooled?.[theta];
  const ci = (c: [number, number] | null) => (c ? `${sp(c[0])} … ${sp(c[1])}` : "—");

  return (
    <div className="space-y-6">
      {/* SIGNAL CALIBRATION — the edge graded on the real fills, with an honest CI */}
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
                <p className={`serif text-2xl ${p.tpReturn >= 0 ? "text-amber" : "text-muted"}`}>{sp(p.tpReturn)}</p>
                <p className="text-xs text-muted">take-profit return · 90% CI {ci(p.tpCi90 ?? null)}</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{p.n}</p>
                <p className="text-xs text-muted">divergence entries</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{usd(p.usd)}</p>
                <p className="text-xs text-muted">size available off fair</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-faint">
              Reach = the prediction market price later travelled to TxLINE&apos;s fair (the delay closing).
              Take-profit return = exit at TxLINE&apos;s fair when the gap closes, else hold to resolution;
              pooled on the real fills, per dollar of price paid. The 90% CI is a match-level bootstrap: at
              this N it still spans zero, so the return is a{" "}
              <span className="text-muted">pilot, not yet significant</span>; the reach rate is the firmer read,
              and both tighten as matches accrue. Sizing and slippage are yours, not part of the signal.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-faint">No divergence past {theta}pp yet.</p>
        )}
      </div>

      {/* PER-MATCH — the same entries as /edge, each expandable to its on-chain fills */}
      <div className="grid grid-cols-1 gap-5">
        {withEdge.map((m) => (
          <MatchCard key={m.fid} m={m} theta={theta} />
        ))}
      </div>
    </div>
  );
}
