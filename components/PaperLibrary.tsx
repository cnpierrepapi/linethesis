"use client";

import Link from "next/link";
import { PAPERS } from "@/lib/papers";

export default function PaperLibrary() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">the methodology</p>
          <h1 className="serif mt-1 text-3xl">The research behind the signals</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Agenthesis doesn&apos;t guess. Every call — <span className="text-fg">follow</span> a clean
            move, <span className="text-fg">fade</span> an overreaction — is grounded in a published
            market-inefficiency result. This is the citation trail behind the detector.
          </p>
        </div>
        <div className="card flex items-center gap-2 px-3 py-2 text-sm">
          <span className="amber">◆</span>
          <span className="tabular-nums">{PAPERS.length}</span>
          <span className="label">papers</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PAPERS.map((p) => (
          <article key={p.id} className="card flex flex-col p-5">
            <div className="flex items-center justify-between">
              <span className="label tabular-nums text-faint">{p.doi}</span>
              <span className="label rounded border border-ink-600 px-1.5 py-0.5">{p.edgeKind}</span>
            </div>

            <h2 className="serif mt-2 text-lg leading-snug text-paper">{p.title}</h2>
            <p className="mt-1 text-xs text-faint">
              {p.authors} · {p.year}
            </p>

            <p className="mt-3 flex-1 text-sm text-muted">{p.abstract}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="text-xs text-faint">
                  #{t}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-3">
              <span className="text-xs gain">✓ grounds a live signal</span>
              <Link href="/desk" className="prompt text-sm text-amber hover:text-fg">
                See it fire →
              </Link>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-6 max-w-2xl text-xs text-faint">
        Each paper maps to one detector behaviour: Croxson &amp; Reade (markets price real news
        efficiently) grounds <span className="text-muted">steam → follow</span>; Choi &amp; Hui and De
        Bondt–Thaler (surprising events overshoot and revert within minutes) ground{" "}
        <span className="text-muted">overreaction → fade</span>. The signal is never more than the
        research says it is.
      </p>
    </div>
  );
}
