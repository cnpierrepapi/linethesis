"use client";

// PROOF LEDGER — the same divergence entries you see on /edge, but each one opens into the
// actual Polygon transactions that traded at your take-profit price (TxLINE fair). /edge asks "does the signal grade?";
// /proof answers "and here are the on-chain fills that prove the cheap side really sat there."
// Click any entry to expand its fills; each `verify ↗` is a real tx you can open on Polygonscan.

import { Fragment, useMemo, useState } from "react";
import type { PickoffMatch, DivergenceEntry, PooledStat } from "@/lib/pickoff-source";
import { polygonTx } from "@/lib/pickoff-source";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const roi = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(0) + "%";
const clock = (t: number, kick: number) => `${Math.max(0, Math.floor((t * 1000 - kick) / 60000))}'`;

// Kelly-sized bankroll multiplier per call: f = gap/(1-entry), exit at fair on reach else at close.
const kmult = (e: DivergenceEntry) => {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, e.gap / d)) : 0;
  const r = e.entry > 0 ? (e.reached ? e.gap : e.clv ?? 0) / e.entry : 0;
  return 1 + f * r;
};
// the same Kelly bet held to resolution (the losing contrast, for the evidence callout)
const kmres = (e: DivergenceEntry) => {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, e.gap / d)) : 0;
  const r = e.win ? (1 - e.entry) / e.entry : -1;
  return 1 + f * r;
};
const kellyRoiOf = (divs: DivergenceEntry[]) => (divs.length ? divs.reduce((p, e) => p * kmult(e), 1) - 1 : null);

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
            <th className="py-1 font-normal">reached fair</th>
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
                  <td className="py-1.5 text-faint">{canOpen ? (on ? "hide ▲" : `${fills.length} fills ▾`) : "—"}</td>
                </tr>
                {on && (
                  <tr className="border-t border-ink-800 bg-ink-900/40">
                    <td colSpan={8} className="px-3 py-2">
                      <p className="mb-1 text-[11px] text-faint">
                        the fills that traded at your take-profit price (TxLINE fair or better) and sum to{" "}
                        {usd(e.usd ?? 0)} of exitable size; each is a Polygon transaction you can open and
                        confirm the liquidity really traded there.
                      </p>
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
  // derive from the entries so a stale per-match surface can't NaN the card
  const reachRate = divs.length ? divs.filter((e) => e.reached).length / divs.length : null;
  const kellyRoi = kellyRoiOf(divs);
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
  // per-match cards, ranked by ROI so the strongest matches lead
  const rankedMatches = useMemo(
    () => [...withEdge].sort((a, b) => (kellyRoiOf(b.divergences?.[theta] ?? []) ?? -1) - (kellyRoiOf(a.divergences?.[theta] ?? []) ?? -1)),
    [withEdge, theta],
  );
  // Always derive the pooled stat client-side so a stale blob (missing tpReturn) can never NaN the
  // page; overlay the published stat (which carries the bootstrap CIs) on top when present.
  const p = useMemo(() => {
    let n = 0, reach = 0, cost = 0, win = 0, size = 0, tp = 0, clv = 0, kTp = 1, kRes = 1;
    for (const m of withEdge) for (const e of m.divergences?.[theta] ?? []) {
      n++; reach += e.reached ? 1 : 0; cost += e.entry; win += e.win; size += e.usd ?? 0;
      tp += e.reached ? e.gap : e.win - e.entry; clv += e.clv ?? 0;
      kTp *= kmult(e); kRes *= kmres(e);
    }
    const derived = { theta: Number(theta) / 100, n, reachRate: n ? reach / n : 0, aggEdgePct: cost ? (win - cost) / cost : 0, tpReturn: cost ? tp / cost : 0, clvAvg: n ? clv / n : 0, kellyRoi: n ? kTp - 1 : 0, kellyRoiRes: n ? kRes - 1 : 0, usd: size, ci90: null as [number, number] | null };
    const pubp = pooled?.[theta];
    return pubp ? { ...derived, ...pubp, kellyRoi: pubp.kellyRoi ?? derived.kellyRoi, kellyRoiRes: pubp.kellyRoiRes ?? derived.kellyRoiRes } : derived;
  }, [withEdge, theta, pooled]);

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
                <p className={`serif text-2xl ${p.kellyRoi >= 0 ? "text-amber" : "text-muted"}`}>{roi(p.kellyRoi)}</p>
                <p className="text-xs text-muted">ROI · Kelly-sized, take-profit at fair</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{p.n}</p>
                <p className="text-xs text-muted">divergence entries</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{usd(p.usd)}</p>
                <p className="text-xs text-muted">size available at fair (exit)</p>
              </div>
            </div>

            {/* WHY KELLY — evidence, not assertion: same signal + same Kelly bets, two exits */}
            <div className="mt-3 rounded border border-ink-700 bg-ink-900/40 p-4">
              <p className="label">why Kelly sizing, and why take-profit — the data, not our word</p>
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
                Same {p.n} calls, same edge. Kelly sizes each bet to the gap, f = gap / (1 − price), so it never
                over-bets into ruin; the convergence is where the money is, and holding to the outcome throws it
                away on a coin-flip. These are the pooled numbers on the real fills, recomputed as each match settles.
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
