import Nav from "@/components/Nav";
import Link from "next/link";

export const metadata = { title: "API: Lagisalpha" };

export default function ApiPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-3xl px-5 py-12">
        <p className="label">api · coming next</p>
        <h1 className="serif mt-2 text-4xl text-paper">Pull the edge into your own system.</h1>
        <p className="mt-3 text-sm text-muted">
          The signal you see on <Link href="/edge" className="text-amber hover:text-fg">Edge</Link> and{" "}
          <Link href="/live" className="text-amber hover:text-fg">Live</Link> becomes a REST feed: the open
          divergences right now, every entry on a settled match, and the track record, in JSON you can poll.
          No account wall on the read side. This is what we are building next.
        </p>
        <div className="card mt-6 p-5 font-mono text-xs text-muted">
          <p className="text-faint"># the shape we are shipping</p>
          <p className="mt-3">
            <span className="text-amber">GET</span> /api/v1/divergences?status=live
          </p>
          <p className="text-faint">&nbsp;&nbsp;open divergences now: fixture, side, fair, market, gap, size</p>
          <p className="mt-3">
            <span className="text-amber">GET</span> /api/v1/divergences?match=&lt;fixtureId&gt;
          </p>
          <p className="text-faint">&nbsp;&nbsp;every entry on a settled match, with reach and outcome</p>
          <p className="mt-3">
            <span className="text-amber">GET</span> /api/v1/track-record
          </p>
          <p className="text-faint">&nbsp;&nbsp;pooled reach, edge, the confidence interval, per match</p>
        </div>
        <p className="mt-4 text-xs text-faint">
          Until it ships, the same data is already public: the track record and every on-chain fill are open
          on <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link>.
        </p>
      </section>
    </main>
  );
}
