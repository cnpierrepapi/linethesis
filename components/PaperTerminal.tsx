"use client";

import { useEffect, useRef, useState } from "react";
import { BANNER, newState, handle } from "@/lib/paper/runner.mjs";

// The live paper-trading terminal. Runs the shared runner (lib/paper/runner) in the browser: the paper
// engine is deterministic and client-side, so no server round-trip per trade. Fetches signals same-origin
// (/api/replay-signals public; /api/v1/divergences?status=live with a loaded key). No real order is placed.

type Line = { text: string; cls: string };

const CLS: Record<string, string> = {
  sys: "text-amber",
  sig: "text-fg",
  fill: "text-muted",
  win: "text-amber",
  loss: "text-loss",
  muted: "text-faint",
  prompt: "text-amber",
  echo: "text-muted",
};

export default function PaperTerminal() {
  const [lines, setLines] = useState<Line[]>(BANNER.map((t: string) => ({ text: t, cls: "muted" })));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(newState(""));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const host = useRef({
    base: "",
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    async fetchJson(path: string, key?: string) {
      const res = await fetch(path, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
      let body: Record<string, unknown> = {};
      try { body = await res.json(); } catch { /* ignore */ }
      return res.ok ? body : { __err: res.status, ...body };
    },
  });

  const emit = (text: string, cls = "sig") => {
    if (text === "__clear__") { setLines([]); return; }
    setLines((prev) => [...prev, { text, cls }]);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const line = input;
    setInput("");
    if (!line.trim() || busy) return;
    setLines((prev) => [...prev, { text: `lagisalpha> ${line}`, cls: "echo" }]);
    setBusy(true);
    try {
      await handle(stateRef.current, line, emit, host.current);
    } catch {
      emit("terminal error — try again", "loss");
    }
    setBusy(false);
  }

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
        <span className="label">lagisalpha · paper terminal</span>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${busy ? "bg-amber blink" : "bg-ink-500"}`} />
          {busy ? "running" : "ready"}
        </span>
      </header>
      <div ref={scrollRef} className="h-[360px] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {lines.map((l, i) => (
          <p key={i} className={`${CLS[l.cls] ?? "text-fg"} whitespace-pre-wrap`}>{l.text}</p>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-ink-600 px-4 py-2.5 font-mono text-xs">
        <span className="text-amber">lagisalpha&gt;</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          spellCheck={false}
          placeholder="bankroll 10000   ·   matches   ·   replay POR-CRO"
          className="flex-1 bg-transparent text-fg outline-none placeholder:text-ink-500"
        />
      </form>
    </div>
  );
}
