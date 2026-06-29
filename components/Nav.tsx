"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAgi } from "@/lib/store";

const LINKS = [
  { href: "/desk", label: "Desk" },
  { href: "/papers", label: "Papers" },
  { href: "/build", label: "Build" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function Nav() {
  const pathname = usePathname();
  const [agi, setAgiState] = useState<number | null>(null);

  useEffect(() => {
    setAgiState(getAgi());
    const sync = () => setAgiState(getAgi());
    window.addEventListener("storage", sync);
    window.addEventListener("agi:change", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("agi:change", sync as EventListener);
    };
  }, []);

  return (
    <nav className="sticky top-0 z-20 border-b border-ink-600 bg-ink-900/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="prompt text-sm font-semibold tracking-tight">
          agenthesis
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

        <div className="card flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="amber">◆</span>
          <span className="tabular-nums">{agi == null ? "—" : agi.toLocaleString()}</span>
          <span className="label">AGI</span>
        </div>
      </div>
    </nav>
  );
}
