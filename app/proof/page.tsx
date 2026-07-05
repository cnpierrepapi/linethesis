import Nav from "@/components/Nav";
import { getProof } from "@/lib/proof";
import { getPickoffs, polygonTx, type PickoffMatch } from "@/lib/pickoff-source";

export const metadata = { title: "Win-Pool Leakage Ledger: Linescout" };
export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const clock = (t: number, kick: number) => {
  const m = Math.max(0, Math.floor((t * 1000 - kick) / 60000));
  return `${m}'`;
};

function MatchCard({ m }: { m: PickoffMatch }) {
  const ip = m.inplay;
  const rows = m.top_pickoffs.slice(0, 10);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="serif text-xl text-paper">{m.teams}</h3>
        <span className="font-mono text-xs text-faint">{m.slug}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="serif text-2xl text-fg">{usd(ip.usd)}</p>
          <p className="text-xs text-muted">in-play book measured</p>
        </div>
        <div>
          <p className="serif text-2xl text-fg">{ip.median_pp}pp</p>
          <p className="text-xs text-muted">median gap (the spread)</p>
        </div>
        <div>
          <p className="serif text-2xl text-amber">{usd(ip.ge5pp_usd)}</p>
          <p className="text-xs text-muted">traded ≥5pp off fair</p>
        </div>
        <div>
          <p className="serif text-2xl text-amber">{usd(ip.ge10pp_usd)}</p>
          <p className="text-xs text-muted">traded ≥10pp off fair</p>
        </div>
      </div>

      <p className="label mt-5">biggest pickoffs · each verifiable on-chain</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="py-1 font-normal">min</th>
              <th className="py-1 font-normal">book P(win)</th>
              <th className="py-1 font-normal">TxLINE fair</th>
              <th className="py-1 font-normal">gap</th>
              <th className="py-1 font-normal">size</th>
              <th className="py-1 font-normal">on-chain</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r, i) => (
              <tr key={r.tx + i} className="border-t border-ink-700">
                <td className="py-1.5 text-muted">{clock(r.t, m.kick)}</td>
                <td className="py-1.5 text-fg">{r.pm.toFixed(3)}</td>
                <td className="py-1.5 text-fg">{r.fair.toFixed(3)}</td>
                <td className={`py-1.5 ${Math.abs(r.gap_pp) >= 10 ? "text-amber" : "text-muted"}`}>
                  {r.gap_pp > 0 ? "+" : ""}
                  {r.gap_pp}pp
                </td>
                <td className="py-1.5 text-muted">{usd(r.usd)}</td>
                <td className="py-1.5">
                  <a
                    href={polygonTx(r.tx)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber underline decoration-ink-500 underline-offset-2 hover:text-fg"
                  >
                    verify ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ProofPage() {
  const [ledger, proof] = await Promise.all([getPickoffs(), Promise.resolve(getProof())]);

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">win-pool leakage ledger</p>
        <h1 className="serif mt-2 text-4xl text-paper">The sports frontier, measured and proven.</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          This is what a sports prediction market looks like with, and without, a real-time fair to settle
          against. Every row is a real fill on a real book, priced against TxLINE&apos;s vig-free fair at
          that instant. The books sit at the spread until information hits; then the gap opens and the
          stale side gets lifted, and that gap is what the market pays out when TxLINE isn&apos;t closing
          it. Nothing here is asserted: each fill is a Polygon transaction you can open, and each outcome
          settles against TxLINE&apos;s on-chain scores. Don&apos;t trust the ledger, verify it.
        </p>

        {ledger && ledger.matches.length > 0 ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{ledger.matchCount}</p>
                <p className="text-xs text-muted">matches in the ledger</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-fg">{usd(ledger.totals.usd)}</p>
                <p className="text-xs text-muted">total in-play book measured</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-amber">{usd(ledger.totals.ge5pp_usd)}</p>
                <p className="text-xs text-muted">lifted ≥5pp off fair</p>
              </div>
              <div className="card p-4">
                <p className="serif text-2xl text-amber">{usd(ledger.totals.ge10pp_usd)}</p>
                <p className="text-xs text-muted">lifted ≥10pp off fair</p>
              </div>
            </div>

            {/* SIGNAL CALIBRATION — the edge graded on the real fills, with an honest CI */}
            {(() => {
              const p5 = ledger.pooled?.["5"];
              const p10 = ledger.pooled?.["10"];
              if (!p5 || !p5.n) return null;
              const sp = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
              const ci = (c: [number, number] | null) => (c ? `${sp(c[0])} … ${sp(c[1])}` : "—");
              return (
                <div className="mt-8">
                  <p className="label">signal calibration · the delay, graded across {ledger.matches.length} matches</p>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="card p-4">
                      <p className="serif text-2xl text-amber">{(p5.reachRate * 100).toFixed(0)}%</p>
                      <p className="text-xs text-muted">book reached TxLINE (≥5pp)</p>
                    </div>
                    <div className="card p-4">
                      <p className="serif text-2xl text-amber">{sp(p5.aggEdgePct)}</p>
                      <p className="text-xs text-muted">aggregate edge · 90% CI {ci(p5.ci90)}</p>
                    </div>
                    <div className="card p-4">
                      <p className="serif text-2xl text-fg">{p5.n}</p>
                      <p className="text-xs text-muted">divergence entries · {usd(p5.usd)} size available</p>
                    </div>
                    <div className="card p-4">
                      <p className="serif text-2xl text-fg">{p10 ? sp(p10.aggEdgePct) : "—"}</p>
                      <p className="text-xs text-muted">edge at ≥10pp (grows with the gap)</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Reach = the prediction market price later travelled to TxLINE&apos;s fair (the delay closing). Edge =
                    the underpriced side&apos;s realized win-rate minus the price paid, pooled on the real fills.
                    The 90% CI is a match-level bootstrap: at {ledger.matches.length} matches it still spans zero,
                    so the edge is a <span className="text-muted">pilot, not yet significant</span>; the reach rate
                    is the firmer read, and both tighten as matches accrue. Sizing and slippage are the
                    consumer&apos;s, not part of the signal.
                  </p>
                </div>
              );
            })()}

            <div className="mt-6 grid grid-cols-1 gap-5">
              {ledger.matches.map((m) => (
                <MatchCard key={m.fid} m={m} />
              ))}
            </div>
            <p className="mt-4 text-xs text-faint">
              Updated {new Date(ledger.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC ·
              new matches settle into the ledger automatically as the tournament plays out.
            </p>
          </>
        ) : (
          <p className="mt-8 text-sm text-faint">
            The ledger publishes after each match settles on-chain. Check back once the next match closes.
          </p>
        )}

        {/* PROVENANCE */}
        <div className="mt-10 border-t border-ink-600 pt-6">
          <p className="label">provenance</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The fair line is TxLINE&apos;s Solana-anchored World Cup feed; the book is a prediction market&apos;s
            fills read straight from Polygon. Both legs are public.
          </p>
          {proof.signedOnSolana && (
            <p className="mt-3 text-sm">
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-muted underline decoration-ink-500 underline-offset-2 hover:text-fg"
              >
                access signed on Solana · tx {proof.signupTx?.slice(0, 6)}…{proof.signupTx?.slice(-4)} ({proof.cluster})
              </a>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
