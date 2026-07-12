"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classifyEdge, goalImminent, IMMINENT_SURFACE_CONF } from "@/lib/signals/classify.mjs";
import { evaluatePolicy, describeAction } from "@/lib/signals/policy.mjs";
import { parseBook, bookProbAt, canonLine } from "@/lib/signals/book-parse.mjs";
import { parsePolicyMarkdown } from "@/lib/signals/policy-md.mjs";

// LINE-INTEGRITY SANDBOX (archive-only). You pick a RECORDED match, bring YOUR book (a
// sample stale book, or upload your own odds as JSON/YAML), and write your policy as a
// markdown file. We replay the real TxLINE demargined frames through the SAME classifier +
// policy engine the production /api/v1 routes run, so a replayed pickoff is detected exactly
// as a live one — but deterministically, with no live SSE to leak or crash. Live odds are
// live-only and the page used to poll them for the length of a match; that path is gone.

const STEAM = 0.04; // pp move over the window = steam (mirrors engine DEFAULTS)
const OVERREACTION = 0.08; // pp swing near a goal = overreaction
const WINDOW_MS = 90_000; // look-back window for a move
const GOAL_WINDOW_MS = 150_000; // a move this soon after a goal is an overreaction
const COOLDOWN_MS = 90_000; // don't re-fire the same market+kind
const HIST_MS = 300_000;
const DANGER_FRESH_SEC = 30;
const IMMINENT_LIVE_COOLDOWN_MS = 120_000;

// sample-book controls (the zero-config "naive book" — a soft book that lags the fair line)
const LAG_MIN = 2_000;
const LAG_MAX = 30_000;
const LAG_DEFAULT = 8_000;
const SPREAD_MAX = 300;

const DEFAULT_POLICY_MD = `# Operator policy — first matching rule wins
- when goal_imminent then suspend
- when overreaction and confidence >= 0.7 then widen margin 4%
- when overreaction then cut limit 50%
- when steam and pickoff high then cut limit 60%
default: no action
`;

const SAMPLE_BOOK_JSON = `{
  "fixtureId": "<paste the match id you picked>",
  "quotes": [
    { "market": "OVERUNDER", "line": 2.5, "side": "over",  "odds": 1.95 },
    { "market": "OVERUNDER", "line": 2.5, "side": "under", "odds": 1.95 },
    { "market": "ASIANHANDICAP", "line": -0.5, "side": "part1", "odds": 1.90 }
  ]
}
// Add a "ts" (ms) to any quote to make it a time-series; quotes without ts
// are static (held for the whole match). YAML with the same fields also works.
`;

interface FrameOut {
  market: string;
  line: string;
  period: string;
  priceNames: string[];
  fairProbs: number[];
  ts: number;
  ageSec: number;
}
interface FixtureOut {
  fid: number | string;
  label: string;
  minute: number | null;
  goals: { p1: number; p2: number };
  goalTs?: number;
  latestAgeSec: number;
  frames: FrameOut[];
  danger?: { action: string; ts: number; ageSec: number; possibleGoal: boolean } | null;
}
interface Sig {
  market: string;
  kind: string;
  action: string;
  confidence: number;
  pRef: number;
  pWatched: number | null;
  gapBps: number | null;
  pickoffRisk: string;
  liquidity?: string | null;
  note: string;
}
interface StoredSig {
  ts: number;
  match: string;
  minute: number | null;
  sig: Sig;
}
interface ParsedBook {
  fixtureId: string | null;
  quotes: { superOddsType: string; line: number; side: string; period: string; ts: number | null; prob: number }[];
  warnings: string[];
}

const KIND_COLOR: Record<string, string> = { overreaction: "loss", steam: "amber", goal_imminent: "text-muted" };
function actionColor(a: string): string {
  return a === "fade" ? "loss" : a === "follow" ? "amber" : "text-muted";
}
function riskColor(r: string): string {
  return r === "high" ? "loss" : r === "med" ? "amber" : "text-faint";
}
function shortMarket(m: string, line?: string): string {
  const s = m.replace("OVERUNDER_PARTICIPANT_GOALS", "O/U").replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH");
  return line ? `${s} ${String(line).replace("line=", "")}` : s;
}
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function valueAt(buf: { ts: number; prob: number }[], target: number): number | null {
  let best: number | null = null;
  for (const e of buf) {
    if (e.ts <= target) best = e.prob;
    else break;
  }
  return best;
}
function download(name: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LiveBoundary() {
  const [fixtures, setFixtures] = useState<FixtureOut[]>([]);
  const [signals, setSignals] = useState<StoredSig[]>([]);

  // archive replay
  const [replayList, setReplayList] = useState<{ fid: string; label: string }[]>([]);
  const [replayFid, setReplayFid] = useState<string | null>(null);
  const [speed, setSpeed] = useState(60);
  const [replayState, setReplayState] = useState<{ progress: number; done: boolean; minute: number; goals: { p1: number; p2: number } } | null>(null);
  const [loading, setLoading] = useState(false);

  // BOOK: 'sample' = the built-in stale book (lag+spread); 'upload' = your parsed odds.
  const [bookMode, setBookMode] = useState<"sample" | "upload">("sample");
  const [lagMs, setLagMs] = useState(LAG_DEFAULT);
  const [spreadBps, setSpreadBps] = useState(0);
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [bookError, setBookError] = useState<string>("");

  // POLICY: a markdown document (upload populates it; edited live → re-parsed).
  const [policyMd, setPolicyMd] = useState(DEFAULT_POLICY_MD);

  // refs so the replay closure always reads the latest book settings
  const bookModeRef = useRef(bookMode);
  const lagRef = useRef(lagMs);
  const spreadRef = useRef(spreadBps);
  const bookRef = useRef<ParsedBook | null>(book);
  useEffect(() => void (bookModeRef.current = bookMode), [bookMode]);
  useEffect(() => void (lagRef.current = lagMs), [lagMs]);
  useEffect(() => void (spreadRef.current = spreadBps), [spreadBps]);
  useEffect(() => void (bookRef.current = book), [book]);

  const hist = useRef(new Map<string, { ts: number; prob: number }[]>());
  const lastGoals = useRef(new Map<string, { p1: number; p2: number }>());
  const goalAt = useRef(new Map<string, number>());
  const cooldown = useRef(new Map<string, number>());
  const lastDanger = useRef(new Map<string, number>());

  function resetDetection() {
    hist.current.clear();
    lastGoals.current.clear();
    goalAt.current.clear();
    cooldown.current.clear();
    lastDanger.current.clear();
    setSignals([]);
  }

  // load the archive match list once
  useEffect(() => {
    let alive = true;
    fetch("/api/replay-frames")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const list = (j.fixtures ?? []).map((f: { fid: string; label: string }) => ({ fid: String(f.fid), label: f.label }));
        setReplayList(list);
        if (list.length && !replayFid) setReplayFid(list[0].fid);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REPLAY: fetch one match's series, step it on a virtual clock at `speed`×, feeding the
  // SAME detect() a live feed would. Restart (or match/speed change) re-runs from scratch.
  useEffect(() => {
    if (!replayFid) return;
    let alive = true;
    let iv: ReturnType<typeof setInterval> | null = null;
    resetDetection();
    setFixtures([]);
    setReplayState(null);
    setLoading(true);

    (async () => {
      const r = await fetch(`/api/replay-frames?fixtureId=${encodeURIComponent(replayFid)}`).catch(() => null);
      const j = r && r.ok ? await r.json() : null;
      if (!alive) return;
      setLoading(false);
      if (!j || !j.frames?.length) return;
      const allFrames: FrameOut[] = j.frames.map((f: Omit<FrameOut, "ageSec">) => ({ ...f, ageSec: 0 }));
      const goals: { ts: number; p1: number; p2: number }[] = j.goals ?? [{ ts: j.firstTs, p1: 0, p2: 0 }];
      const label: string = j.label;
      const kickoff: number = j.firstTs;
      const TICK_MS = 250;
      let vt = kickoff;
      let cursor = 0;

      iv = setInterval(() => {
        if (!alive) return;
        const nextVt = vt + speed * TICK_MS;
        const batch: FrameOut[] = [];
        while (cursor < allFrames.length && allFrames[cursor].ts <= nextVt) batch.push(allFrames[cursor++]);
        vt = nextVt;

        let g = goals[0];
        for (const ge of goals) if (ge.ts <= vt) g = ge;
        const minute = Math.max(0, Math.round((vt - kickoff) / 60000));

        const snap: FixtureOut = {
          fid: replayFid,
          label,
          minute,
          goals: { p1: g.p1, p2: g.p2 },
          goalTs: g.ts,
          latestAgeSec: 0,
          frames: batch.slice(-40).map((f) => ({ ...f, ageSec: Math.max(0, Math.round((vt - f.ts) / 1000)) })),
        };
        setFixtures([snap]);
        if (batch.length) detect([snap], vt);

        const done = cursor >= allFrames.length;
        setReplayState({
          progress: Math.min(1, (vt - kickoff) / Math.max(1, j.lastTs - kickoff)),
          done,
          minute,
          goals: { p1: g.p1, p2: g.p2 },
        });
        if (done && iv) {
          clearInterval(iv);
          iv = null;
        }
      }, TICK_MS);
    })();

    return () => {
      alive = false;
      if (iv) clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayFid, speed]);

  // watchedProb = YOUR book's price for this market/side at match-time `now`.
  //   upload mode → your parsed book (step-aligned or static); null where you don't quote it.
  //   sample mode → the fair line `lag` ago, shaded away from fair by `spread`.
  function watchedProbFor(buf: { ts: number; prob: number }[], now: number, pRef: number, meta: { superOddsType: string; line: number | null; side: string; period: string }): number | null {
    if (bookModeRef.current === "upload") {
      return bookRef.current ? bookProbAt(bookRef.current, meta, now) : null;
    }
    const lagged = valueAt(buf, now - lagRef.current);
    if (lagged == null) return null;
    if (spreadRef.current <= 0) return lagged;
    const dir = lagged >= pRef ? 1 : -1;
    return lagged + (dir * spreadRef.current) / 10000;
  }

  function detect(fx: FixtureOut[], nowTs: number) {
    const fresh: StoredSig[] = [];
    for (const f of fx) {
      const fid = String(f.fid);
      const prev = lastGoals.current.get(fid);
      if (prev && (f.goals.p1 > prev.p1 || f.goals.p2 > prev.p2)) goalAt.current.set(fid, f.goalTs ?? nowTs);
      lastGoals.current.set(fid, f.goals);
      const ga = goalAt.current.get(fid) ?? 0;
      const goalRecent = ga > 0 && nowTs - ga <= GOAL_WINDOW_MS;

      for (const fr of f.frames) {
        if (!/PARTICIPANT_GOALS/.test(fr.market)) continue;
        fr.priceNames.forEach((side, j) => {
          const prob = fr.fairProbs[j];
          if (!(prob > 0.02 && prob < 0.98)) return;
          const key = `${fid}|${fr.market}|${fr.line}|${fr.period}|${side}`;
          const buf = hist.current.get(key) ?? [];
          if (!buf.length || buf[buf.length - 1].ts !== fr.ts) buf.push({ ts: fr.ts, prob });
          while (buf.length && buf[0].ts < fr.ts - HIST_MS) buf.shift();
          hist.current.set(key, buf);

          const now = fr.ts;
          const probThen = valueAt(buf, now - WINDOW_MS);
          if (probThen == null) return;
          const delta = prob - probThen;
          const kind = goalRecent && Math.abs(delta) >= OVERREACTION ? "overreaction" : !goalRecent && Math.abs(delta) >= STEAM ? "steam" : null;
          if (!kind) return;
          const ck = `${key}|${kind}`;
          if (now - (cooldown.current.get(ck) ?? 0) < COOLDOWN_MS) return;
          cooldown.current.set(ck, now);

          const edge = {
            kind,
            market: { fixtureId: fid, superOddsType: fr.market, marketParameters: fr.line, marketPeriod: fr.period, side, inRunning: true },
            edgeMeasure: Math.abs(delta),
            fairProb: prob,
            preEventProb: probThen,
            direction: kind === "steam" ? (delta > 0 ? "back" : "lay") : delta > 0 ? "lay" : "back",
            openedAt: now,
            note: `${(probThen * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}%${goalRecent ? " (post-goal)" : ""}`,
            trigger: goalRecent ? "GOAL" : undefined,
          };
          const meta = { superOddsType: fr.market, line: canonLine(fr.line), side, period: fr.period };
          const watchedProb = watchedProbFor(buf, now, prob, meta);
          const sig = classifyEdge(edge, { minute: f.minute, watchedProb, preEventProb: probThen }) as Sig | null;
          if (!sig) return;
          fresh.push({ ts: now, match: f.label, minute: f.minute, sig });
        });
      }

      const d = f.danger;
      if (d && d.ageSec <= DANGER_FRESH_SEC) {
        const rec = { FixtureId: fid, Ts: d.ts, Action: d.action, PossibleEvent: d.possibleGoal ? { Goal: true } : undefined };
        const gi = goalImminent(rec, { minute: f.minute }) as Sig | null;
        const last = lastDanger.current.get(fid) ?? -Infinity;
        if (gi && gi.confidence >= IMMINENT_SURFACE_CONF && d.ts - last >= IMMINENT_LIVE_COOLDOWN_MS) {
          lastDanger.current.set(fid, d.ts);
          fresh.push({ ts: nowTs, match: f.label, minute: f.minute, sig: gi });
        }
      }
    }
    if (fresh.length) setSignals((prev) => [...fresh.reverse(), ...prev].slice(0, 80));
  }

  // handle a book file upload (JSON or YAML)
  function onBookFile(file: File) {
    file.text().then((txt) => {
      try {
        const parsed = parseBook(txt) as ParsedBook;
        setBook(parsed);
        setBookMode("upload");
        setBookError(parsed.warnings.length ? `loaded ${parsed.quotes.length} quotes · ${parsed.warnings.length} skipped` : `loaded ${parsed.quotes.length} quotes`);
      } catch (e) {
        setBook(null);
        setBookError(`couldn't parse: ${(e as Error).message}`);
      }
    });
  }
  function onPolicyFile(file: File) {
    file.text().then((txt) => setPolicyMd(txt));
  }

  // POLICY parses reactively from the markdown → re-decides the whole tape instantly.
  const policy = useMemo(() => parsePolicyMarkdown(policyMd), [policyMd]);
  const decided = useMemo(() => signals.map((s) => ({ ...s, pol: evaluatePolicy(policy, s.sig) })), [signals, policy]);
  const tallies = useMemo(() => {
    let pickoffs = 0, actions = 0, marginPct = 0, limitsCut = 0, suspends = 0;
    for (const d of decided) {
      if (d.sig.pickoffRisk === "high") pickoffs++;
      const act = d.pol.action as { do?: string; marginPct?: number };
      if (d.pol.matched && act.do && act.do !== "none") actions++;
      if (act.do === "widen_margin") marginPct += Number(act.marginPct) || 0;
      if (act.do === "cut_limit") limitsCut++;
      if (act.do === "suspend") suspends++;
    }
    return { pickoffs, actions, marginPct, limitsCut, suspends };
  }, [decided]);

  function restart() {
    const f = replayFid;
    setReplayFid(null);
    setTimeout(() => setReplayFid(f), 0);
  }

  const liveOn = fixtures.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">line-integrity sandbox: pick a recorded match, bring your book + policy, watch the pickoff</p>
          <h1 className="serif mt-1 text-2xl">Replay the pickoff on your own book.</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            We replay a recorded match&apos;s real TxLINE demargined frames through the exact production classifier and
            benchmark them against <em>your</em> book (a sample stale book, or upload your odds as JSON/YAML). Your
            policy — a markdown file — decides what to do. We warn; your policy acts. Nothing here is live, so nothing
            leaks or crashes.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${liveOn ? "bg-amber blink" : "bg-ink-500"}`} />
          {loading ? "loading match…" : replayState ? `REPLAY · ${replayState.done ? "ended" : `${replayState.minute}'`}` : "pick a match"}
        </span>
      </header>

      {/* ARCHIVE MATCH PICKER + SPEED + RESTART */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="label">match</span>
        <select
          value={replayFid ?? ""}
          onChange={(e) => setReplayFid(e.target.value)}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-fg"
        >
          {replayList.length === 0 && <option value="">loading matches…</option>}
          {replayList.map((f) => (
            <option key={f.fid} value={f.fid}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="inline-flex overflow-hidden rounded border border-ink-600 text-xs">
          {[30, 60, 120].map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              className={`px-2 py-1.5 ${sp !== 30 ? "border-l border-ink-600" : ""} ${speed === sp ? "bg-amber/10 text-amber" : "text-muted hover:text-fg"}`}
            >
              {sp}×
            </button>
          ))}
        </div>
        {replayState && (
          <div className="flex min-w-[140px] flex-1 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-ink-700">
              <div className="h-full bg-amber" style={{ width: `${Math.round(replayState.progress * 100)}%` }} />
            </div>
          </div>
        )}
        <button onClick={restart} className="rounded border border-ink-600 px-2 py-1.5 text-xs text-muted hover:text-fg">
          ⟲ restart
        </button>
      </div>

      {/* TALLIES */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tally label="signals" value={`${decided.length}`} />
        <Tally label="pickoffs caught" value={`${tallies.pickoffs}`} tone="loss" />
        <Tally label="actions fired" value={`${tallies.actions}`} tone="amber" />
        <Tally label="margin protected" value={`+${tallies.marginPct}%`} tone="gain" hint={`${tallies.limitsCut} limits cut · ${tallies.suspends} suspends`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT: your book + your policy */}
        <aside className="order-1 space-y-4 lg:col-span-4">
          {/* BOOK */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="label">your book</p>
              <div className="inline-flex overflow-hidden rounded border border-ink-600 text-[0.66rem]">
                <button onClick={() => setBookMode("sample")} className={`px-2 py-1 ${bookMode === "sample" ? "bg-amber/10 text-amber" : "text-muted hover:text-fg"}`}>
                  sample
                </button>
                <button onClick={() => setBookMode("upload")} className={`border-l border-ink-600 px-2 py-1 ${bookMode === "upload" ? "bg-amber/10 text-amber" : "text-muted hover:text-fg"}`}>
                  upload
                </button>
              </div>
            </div>

            {bookMode === "sample" ? (
              <>
                <p className="mt-1 text-xs text-faint">A soft book that just lags the fair line — the stale price a sharp lifts.</p>
                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">staleness (lag)</span>
                    <span className="tabular-nums text-sm text-amber">{(lagMs / 1000).toFixed(0)}s</span>
                  </div>
                  <input type="range" min={LAG_MIN} max={LAG_MAX} step={1000} value={lagMs} onChange={(e) => setLagMs(Number(e.target.value))} className="mt-1 w-full accent-amber" />
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">soft-book vig (spread)</span>
                    <span className="tabular-nums text-sm text-amber">{spreadBps}bps</span>
                  </div>
                  <input type="range" min={0} max={SPREAD_MAX} step={10} value={spreadBps} onChange={(e) => setSpreadBps(Number(e.target.value))} className="mt-1 w-full accent-amber" />
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-faint">Upload your odds for this match (JSON or YAML). Quotes with a <code>ts</code> are step-aligned; without, they&apos;re static for the whole match.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded border border-amber-dim bg-amber/10 px-3 py-1.5 text-xs text-amber hover:bg-amber/20">
                    ↑ upload book
                    <input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" className="hidden" onChange={(e) => e.target.files?.[0] && onBookFile(e.target.files[0])} />
                  </label>
                  <button onClick={() => download("lagisalpha-book-sample.json", SAMPLE_BOOK_JSON, "application/json")} className="text-xs text-faint hover:text-fg">
                    ↓ sample
                  </button>
                </div>
                {bookError && <p className={`mt-2 text-xs ${book ? "gain" : "loss"}`}>{bookError}</p>}
                {book && <p className="mt-1 text-[0.66rem] text-faint">Applies to new signals as the match plays; hit ⟲ restart to re-benchmark the whole match on this book.</p>}
              </>
            )}
            <p className="mt-3 text-xs text-faint">Read-only: no bet placed, no price moved, no funds held.</p>
          </div>

          {/* POLICY */}
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="label">your policy (markdown)</p>
              <div className="flex items-center gap-2 text-[0.66rem]">
                <label className="cursor-pointer text-amber hover:text-fg">
                  ↑ upload .md
                  <input type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onPolicyFile(e.target.files[0])} />
                </label>
                <button onClick={() => download("lagisalpha-policy.md", policyMd, "text/markdown")} className="text-faint hover:text-fg">
                  ↓
                </button>
                <button onClick={() => setPolicyMd(DEFAULT_POLICY_MD)} className="text-faint hover:text-fg">
                  reset
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-faint">
              One rule per line: <code>- when &lt;clauses&gt; then &lt;action&gt;</code>. Edits re-decide the whole tape instantly.
            </p>
            <textarea
              value={policyMd}
              onChange={(e) => setPolicyMd(e.target.value)}
              spellCheck={false}
              rows={8}
              className="mt-2 w-full resize-y rounded border border-ink-600 bg-ink-850 px-2 py-1.5 font-mono text-[0.7rem] leading-relaxed text-fg"
            />
            <p className="mt-2 text-[0.66rem] text-faint">
              parsed: <span className="text-muted">{policy.rules.length}</span> rule{policy.rules.length === 1 ? "" : "s"} · default{" "}
              <span className="text-muted">{describeAction(policy.default)}</span>
            </p>
          </div>
        </aside>

        {/* RIGHT: the recorded book + the boundary tape */}
        <section className="order-2 space-y-4 lg:col-span-8">
          {loading ? (
            <p className="panel px-5 py-6 text-sm text-muted">Loading the recorded match…</p>
          ) : !liveOn ? (
            <p className="panel px-5 py-6 text-sm text-muted">
              {replayList.length === 0 ? "No recorded matches in the archive yet." : "Pick a match to replay it through your book + policy."}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {fixtures.map((f) => (
                  <div key={f.fid} className="card p-4">
                    <div className="flex items-center justify-between">
                      <p className="serif text-paper">
                        {f.label} <span className="text-faint">· {f.goals.p1}-{f.goals.p2}</span>
                        {f.minute != null && <span className="text-faint"> · {f.minute}&apos;</span>}
                      </p>
                      <span className="text-xs tabular-nums text-faint">{bookMode === "upload" ? "vs your book" : `vs sample book · ${(lagMs / 1000).toFixed(0)}s lag`}</span>
                    </div>
                    <table className="mt-3 w-full text-left text-xs">
                      <tbody className="font-mono">
                        {f.frames.filter((fr) => /PARTICIPANT_GOALS/.test(fr.market)).slice(0, 5).map((fr, i) => (
                          <tr key={i} className="border-t border-ink-700">
                            <td className="py-1 pr-2 text-muted">{shortMarket(fr.market, fr.line)}</td>
                            <td className="py-1 pr-2 text-fg">
                              {fr.priceNames.map((n, j) => (
                                <span key={j} className="mr-2 whitespace-nowrap">
                                  <span className="text-faint">{n}</span> {fr.fairProbs[j]?.toFixed(3)}
                                </span>
                              ))}
                            </td>
                            <td className={`py-1 text-right tabular-nums ${fr.ageSec < 10 ? "gain" : "text-faint"}`}>{fr.ageSec}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <Boundary decided={decided} bookMode={bookMode} lagMs={lagMs} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Boundary({
  decided,
  bookMode,
  lagMs,
}: {
  decided: (StoredSig & { pol: { matched: boolean; action: { do?: string; marginPct?: number; limitPct?: number } } })[];
  bookMode: "sample" | "upload";
  lagMs: number;
}) {
  return (
    <section className="panel flex min-h-[45vh] flex-col">
      <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
        <div>
          <p className="label">the read-only boundary</p>
          <p className="text-sm text-muted">
            signal (ours) → your book&apos;s gap ({bookMode === "upload" ? "your uploaded odds" : `sample book · ${(lagMs / 1000).toFixed(0)}s lag`}) → the action YOUR policy chose
          </p>
        </div>
        <span className="text-xs text-faint tabular-nums">{decided.length} signals</span>
      </header>
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-600 text-xs text-faint">
              <Th>time</Th>
              <Th>market</Th>
              <Th>signal</Th>
              <Th right>ref</Th>
              <Th right>book gap</Th>
              <Th>pickoff</Th>
              <Th>policy action</Th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {decided.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-faint">
                  benchmarking the recorded book against the demargined consensus…
                </td>
              </tr>
            )}
            {decided.map((d, i) => {
              const s = d.sig;
              const fired = d.pol.matched && d.pol.action?.do && d.pol.action.do !== "none";
              return (
                <tr key={`${d.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 text-faint tabular-nums">{clock(d.ts)}</td>
                  <td className="px-3 py-2 text-muted">{shortMarket(s.market)}</td>
                  <td className="px-3 py-2">
                    <span className={KIND_COLOR[s.kind] ?? "text-muted"}>{s.kind}</span>{" "}
                    <span className="text-faint">→</span> <span className={actionColor(s.action)}>{s.action}</span>
                    {s.liquidity && (
                      <span className="text-faint" title={`${s.liquidity} book — pickoff-exposure fact (not a revert prediction)`}>
                        {" "}· {s.liquidity}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{s.pRef?.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.gapBps != null ? (
                      <span className={Math.abs(s.gapBps) >= 60 ? "loss" : "text-faint"}>
                        {s.gapBps > 0 ? "+" : ""}
                        {s.gapBps}bps
                      </span>
                    ) : (
                      <span className="text-faint">-</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 ${riskColor(s.pickoffRisk)}`}>{s.pickoffRisk}</td>
                  <td className={`px-3 py-2 ${fired ? "text-fg" : "text-faint"}`}>{describeAction(d.pol.action)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tally({ label, value, tone, hint }: { label: string; value: string; tone?: "gain" | "loss" | "amber"; hint?: string }) {
  const cls = tone === "gain" ? "gain" : tone === "loss" ? "loss" : tone === "amber" ? "amber" : "";
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-xl tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[0.66rem] text-faint">{hint}</p>}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
