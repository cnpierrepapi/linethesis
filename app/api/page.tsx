import Nav from "@/components/Nav";
import Link from "next/link";
import ApiAccess from "@/components/ApiAccess";
import { SVM_RECIPIENT, EVM_RECIPIENT } from "@/lib/payments";

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
          <span className="text-amber">The first 20 keys are free</span> — claim one below, no payment. After that:
          pay in USDC, get a key, poll the divergences. <span className="text-fg">$97.99</span> buys 30 days;{" "}
          <span className="text-fg">$699.99</span> is lifetime. Pay on Solana or any major EVM chain. The key
          gates the live divergences, every entry per match, and the track record. No account, no KYC.
        </p>

        <div className="mt-6">
          <ApiAccess svmRecipient={SVM_RECIPIENT} evmRecipient={EVM_RECIPIENT} />
        </div>

        <div className="mt-8">
          <p className="label">endpoints</p>
          <div className="card mt-2 p-5 font-mono text-xs text-muted">
            <p className="text-faint"># send on every call:  Authorization: Bearer &lt;key&gt;</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/divergences?status=live</p>
            <p className="text-faint">&nbsp;&nbsp;open divergences right now: fixture, side, fair, market, gap</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/divergences?match=&lt;fixtureId&gt;</p>
            <p className="text-faint">&nbsp;&nbsp;every entry on a settled match, with reach and outcome</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/divergences</p>
            <p className="text-faint">&nbsp;&nbsp;the list of matches with entry counts</p>
            <p className="mt-3"><span className="text-amber">GET</span> /api/v1/track-record</p>
            <p className="text-faint">&nbsp;&nbsp;pooled reach, CLV, confidence interval, per match</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-faint">
          The same data is visible (but not pullable) on{" "}
          <Link href="/proof" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/proof</Link> and{" "}
          <Link href="/edge" className="underline decoration-ink-500 underline-offset-2 hover:text-fg">/edge</Link>. Payments settle to the Lagisalpha
          Solana or EVM wallet shown above; verification is on-chain against the transaction you paste.
        </p>
      </section>
    </main>
  );
}
