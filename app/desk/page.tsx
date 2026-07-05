import Nav from "@/components/Nav";
import { getPickoffs, polygonTx, type PickoffMatch } from "@/lib/pickoff-source";

export const metadata = { title: "The Desk: defend a live book | Linethesis" };
export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const FULL = 96; // minutes of track

function DefenseStrip({ m }: { m: PickoffMatch }) {
  // place each pickoff on a 0–96' track; the cluster at the goal tells the story
  const dots = m.top_pickoffs.map((p) => {
    const min = Math.min(FULL, Math.max(0, (p.t * 1000 - m.kick) / 60000));
    return { left: (min / FULL) * 100, big: Math.abs(p.gap_pp) >= 10, p, min: Math.round(min) };
  });
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="serif text-xl text-paper">{m.teams}</h3>
        <span className="text-xs text-muted">
          median gap <span className="text-fg">{m.inplay.median_pp}pp</span> · {usd(m.inplay.ge5pp_usd)} lifted ≥5pp
        </span>
      </div>

      {/* the track: flat at the spread, then a burst where the line went stale */}
      <div className="relative mt-6 h-16">
        <div className="absolute inset-x-0 top-1/2 h-px bg-ink-600" />
        {[0, 45, 90].map((mk) => (
          <div
            key={mk}
            className="absolute -bottom-5 -translate-x-1/2 text-[10px] text-faint"
            style={{ left: `${(mk / FULL) * 100}%` }}
          >
            {mk}&apos;
          </div>
        ))}
        {dots.map((d, i) => (
          <a
            key={d.p.tx + i}
            href={polygonTx(d.p.tx)}
            target="_blank"
            rel="noreferrer"
            title={`${d.min}' · book ${d.p.pm.toFixed(3)} vs fair ${d.p.fair.toFixed(3)} · ${d.p.gap_pp > 0 ? "+" : ""}${d.p.gap_pp}pp · ${usd(d.p.usd)} · verify ↗`}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150"
            style={{
              left: `${d.left}%`,
              width: d.big ? 12 : 7,
              height: d.big ? 12 : 7,
              background: d.big ? "#f5a623" : "#6b7280",
              opacity: d.big ? 0.95 : 0.6,
            }}
          />
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">
        For {Math.round((m.ft - m.kick) / 60000)} minutes the book sits at its spread against TxLINE fair.
        Then information hits and the gap opens: each <span className="text-amber">amber</span> dot is a fill
        lifted ≥10 points off fair, and every one links to the Polygon transaction that settled it.
      </p>
    </div>
  );
}

export default async function DeskPage() {
  const ledger = await getPickoffs();
  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">the desk · defend a live book</p>
        <h1 className="serif mt-2 text-4xl text-paper">This is the sports book, being picked off.</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          A sports prediction market&apos;s order book, laid against TxLINE&apos;s vig-free fair for the
          length of a match, the reference these markets have never had. It&apos;s quiet, prices agree at
          the spread, until a goal, when the fair jumps and the book lags. That window is where a stale
          quote gets lifted. Linethesis watches this gap tick by tick; your rule-set decides what to do
          about it. Hover any dot to see the pickoff; click to verify it on-chain.
        </p>

        {ledger && ledger.matches.length > 0 ? (
          <div className="mt-8 grid grid-cols-1 gap-5">
            {ledger.matches.map((m) => (
              <DefenseStrip key={m.fid} m={m} />
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-faint">
            The desk populates as matches settle on-chain. Check back once the next match closes.
          </p>
        )}
      </section>
    </main>
  );
}
