import Link from "next/link";
import Nav from "@/components/Nav";
import FairTimeline from "@/components/FairTimeline";
import { getPickoffs } from "@/lib/pickoff-source";

export const dynamic = "force-dynamic";

type Params = { fid: string };
type Search = { t?: string; theta?: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { fid } = await params;
  const ledger = await getPickoffs();
  const m = ledger?.matches.find((x) => String(x.fid) === String(fid));
  return { title: m ? `${m.teams}, fair vs market: Lagisalpha` : "Match timeline: Lagisalpha" };
}

export default async function MatchTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const ledger = await getPickoffs();
  const m = ledger?.matches.find((x) => String(x.fid) === String(fid));
  const theta: "5" | "10" = sp.theta === "10" ? "10" : "5";
  const focusT = sp.t && Number.isFinite(Number(sp.t)) ? Number(sp.t) : null;

  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <p className="label">
          <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">
            the track record
          </Link>{" "}
          / match timeline
        </p>
        {m ? (
          <>
            <h1 className="serif mt-2 text-4xl text-paper">{m.teams}</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted">
              This page is the proof behind the proof. Every fill on the track record makes a claim about a
              single second of this match: the market printed one price while TxLINE&apos;s fair said another.
              Here are both recorded lines on one clock, so you can scrub to that exact second and read the
              fair for yourself, next to the on-chain fill that traded against it.
            </p>
            <div className="mt-8">
              <FairTimeline match={m} theta={theta} focusT={focusT} />
            </div>
            <p className="mt-4 text-xs text-faint">
              Fair line: TxLINE&apos;s Solana-anchored World Cup feed (demargined 1X2), recorded live as it
              streamed. Market line: real fills read from Polygon. The entry and exit circles carry their
              transaction hashes; open any of them on Polygonscan.
            </p>
          </>
        ) : (
          <>
            <h1 className="serif mt-2 text-4xl text-paper">Match not found</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted">
              This match is not in the published ledger yet. New matches settle into the ledger automatically
              after full time;{" "}
              <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">
                head back to the track record
              </Link>{" "}
              to see every measured match.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
