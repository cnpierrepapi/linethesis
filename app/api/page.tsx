import Nav from "@/components/Nav";
import Link from "next/link";
import ApiAccess from "@/components/ApiAccess";

export const metadata = { title: "API: Lagisalpha" };
export const dynamic = "force-dynamic";

export default function ApiPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-3xl px-5 py-12">
        <p className="label">api access</p>
        <h1 className="serif mt-2 text-4xl text-paper">Pull the edge into your own system.</h1>
        <p className="mt-3 text-sm text-muted">
          <span className="text-amber">Keys are free.</span> Request one below, save it, and send it as{" "}
          <span className="font-mono text-fg">Authorization: Bearer &lt;key&gt;</span>. The key gates the
          archival feed: every entry per settled match and the track record. No account, no KYC. How a
          production feed would be priced is set out in the{" "}
          <Link href="/litepaper" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">litepaper</Link>.
        </p>

        <div className="mt-6">
          <ApiAccess />
        </div>

        <div className="mt-8">
          <p className="label">endpoints</p>
          <div className="card mt-2 p-5 font-mono text-xs text-muted">
            <p className="text-faint"># send on every call:  Authorization: Bearer &lt;key&gt;</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/divergences?match=&lt;fixtureId&gt;</p>
            <p className="text-faint">&nbsp;&nbsp;every entry on a settled match, with reach and the on-chain fills</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/divergences</p>
            <p className="text-faint">&nbsp;&nbsp;the list of matches with entry counts</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/track-record</p>
            <p className="text-faint">&nbsp;&nbsp;pooled reach, CLV, confidence interval, per match</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-faint">
          The same data is visible (but not pullable) on{" "}
          <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link> and{" "}
          <Link href="/edge" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/edge</Link>. The live
          feed was retired when the tournament closed; this is the settled-match record.
        </p>
      </section>
    </main>
  );
}
