"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Trader-facing IA. Launch (/launch) is the flagship: the paper-trading terminal. Edge (/edge) is the
// divergence feed replayed on real matches. Proof (/proof) is the track record. Litepaper (/litepaper)
// is the writeup. The live surface and the old operator surfaces (Desk, Sandbox, SDK, Papers) are retired.
const LINKS = [
  { href: "/launch", label: "Launch" },
  { href: "/edge", label: "Edge" },
  { href: "/proof", label: "Proof" },
  { href: "/api", label: "API" },
  { href: "/litepaper", label: "Litepaper" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-20 border-b border-ink-600 bg-ink-900/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="prompt text-sm font-semibold tracking-tight">
          lagisalpha
        </Link>

        <div className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded px-2.5 py-1 transition-colors ${
                  active ? "text-amber" : "text-muted hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
