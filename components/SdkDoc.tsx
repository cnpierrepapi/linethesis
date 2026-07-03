import Link from "next/link";

const REPO = "https://github.com/cnpierrepapi/agenthesis";

function Code({ children }: { children: string }) {
  return (
    <pre className="card overflow-x-auto p-4 text-[0.8rem] leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}

const PRIMITIVES = [
  {
    kind: "Signal",
    fn: "classifyEdge(edge, ctx)",
    body: "Turn a reference-line move into a read-only signal: kind (steam | overreaction) → action (follow | hold | fade), a confidence, a pickoffRisk, and gapBps vs your own price. You act on it; we never touch your book.",
  },
  {
    kind: "Detection",
    fn: "EdgeEngine",
    body: "Ingest the demargined book → typed reference-line events (steam = a sharp fair-prob move; overreaction = a post-goal overshoot). classifyEdge reads these.",
  },
  {
    kind: "Grading",
    fn: "markPosition / scoreCLV",
    body: "Closing-line value — the skill metric behind the calibration ledger. Resolves from odds alone, no match outcome required.",
  },
];

const API = [
  {
    sig: "new EdgeEngine(opts?)",
    desc: "Detection. ingestOdds(rec), ingestScores(rec), on(\"edge\"|\"matchEvent\", cb), matchMinute(fixtureId). opts tune thresholds/windows. Edges carry preEventProb for surprise-conditioning.",
  },
  {
    sig: "classifyEdge(edge, { minute, watchedProb, preEventProb })",
    desc: "→ a read-only signal { kind, action, confidence, pickoffRisk, pRef, pWatched, gapBps, firedBy, revertLikely, direction, proofHash? } or null (out-of-scope markets / quote edges). watchedProb = your price → gapBps is the pickoff surface. Pure.",
  },
  {
    sig: "pregoalWarning(scoreRec, { minute })",
    desc: "→ a suspend-suggested signal off the momentum tape (high_danger_possession / PossibleEvent.Goal) BEFORE the line moves, or null. Pure.",
  },
  {
    sig: "markPosition(pos, closeProb) / scoreCLV({ entryProb, direction, stake }, closeProb)",
    desc: "→ { clvReturn, pnl }. The grading leg behind /proof. Pure. Constants: CONTINUATION_COEFF, KELLY_CAP, CLV_FLOOR, CLV_CEIL.",
  },
];

const ENDPOINTS = [
  ["GET /api/v1/signals", "the product: classified line-integrity signals per fixture", "fixtureId · kind (steam|overreaction) · action (follow|hold|fade) · minConfidence · limit"],
  ["GET /api/v1/calibration", "the provable track record — hit-rate & avg CLV per kind/action + breadth", "detail=1 to include the settled rows"],
  ["GET /api/v1/control-room", "the read-only boundary timeline — signal → stale-book gap → operator action", "fixtureId · lagMs (naive-book latency)"],
];

export default function SdkDoc() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <p className="label">developer access</p>
        <h1 className="serif mt-1 text-4xl text-paper">Agenthesis SDK</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Embed the line-integrity classifier directly in your stack. You bring your TxLINE feed and
          your prices; the SDK turns the demargined book into <span className="text-fg">read-only
          signals</span> — a clean move to follow, an overreaction to fade, a stale line about to get
          picked off. You act on the signal. It never places a bet, moves a price, or holds funds.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-faint">
          It is the exact code the deployed product runs — pure functions, no I/O, no clock reads,
          deterministic, unit-tested. That is what makes it safe to put next to a live book.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link
            href={`${REPO}/tree/master/sdk`}
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ◆ Source on GitHub ↗
          </Link>
          <Link
            href={`${REPO}/blob/master/examples/desk_quickstart.mjs`}
            className="card px-4 py-2 text-muted hover:text-fg"
          >
            Runnable example ↗
          </Link>
        </div>
      </header>

      {/* What it gives you */}
      <section className="mb-10">
        <p className="label mb-3">what it gives you</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PRIMITIVES.map((p) => (
            <div key={p.kind} className="card p-4">
              <p className="amber text-sm font-semibold">{p.kind}</p>
              <p className="mt-1 font-mono text-xs text-info">{p.fn}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">
          You keep the two things an operator must own: the feed (you push records in) and the book
          (your rule-set acts on the signal). The SDK is the read-only benchmark in between.
        </p>
      </section>

      {/* Install */}
      <section className="mb-10">
        <p className="label mb-3">install</p>
        <Code>{`# install straight from the repo
npm install github:cnpierrepapi/agenthesis

# the public surface is the self-contained "agenthesis/sdk" entry
import { EdgeEngine, classifyEdge, pregoalWarning, scoreCLV }
  from "agenthesis/sdk";`}</Code>
        <p className="mt-2 text-xs text-faint">
          The package exposes only the pure detection + classification + grading layer. It pulls in no
          runtime dependencies beyond Node&apos;s built-in <code className="text-info">events</code>.
        </p>
      </section>

      {/* Quickstart */}
      <section className="mb-10">
        <p className="label mb-3">quickstart</p>
        <Code>{`import { EdgeEngine, classifyEdge } from "agenthesis/sdk";

const engine = new EdgeEngine();                       // detection thresholds

engine.on("edge", (edge) => {
  const minute     = engine.matchMinute(edge.market.fixtureId);
  const watchedProb = myBook.impliedProbFor(edge.market); // YOUR price (optional)
  const signal = classifyEdge(edge, { minute, watchedProb });
  if (!signal) return;                                 // out-of-scope / no signal
  // signal.action ∈ follow | hold | fade ; signal.pickoffRisk ; signal.gapBps
  myRuleSet.apply(signal);                             // YOUR book takes the action
});

engine.ingestOdds(txlineOddsRecord);                   // feed YOUR stream
engine.ingestScores(txlineScoreRecord);`}</Code>
        <p className="mt-2 text-xs text-faint">
          A runnable end-to-end walk over real captured TxLINE frames lives in{" "}
          <code className="text-info">examples/desk_quickstart.mjs</code>.
        </p>
      </section>

      {/* API */}
      <section className="mb-10">
        <p className="label mb-3">api reference</p>
        <div className="panel divide-y divide-ink-600">
          {API.map((a) => (
            <div key={a.sig} className="p-4">
              <p className="font-mono text-xs text-amber">{a.sig}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The model */}
      <section className="mb-10">
        <p className="label mb-3">the model</p>
        <div className="card p-5 text-sm leading-relaxed text-muted">
          <p>
            TxLINE publishes a de-margined (no-vig) book, so for side <em className="text-fg">S</em>:{" "}
            <code className="text-info">pRef = 1 / (price/1000)</code> — the fair line we benchmark
            against. A signal is a classified move on that line: <span className="amber">steam</span>{" "}
            (efficient → follow) or <span className="amber">overreaction</span> (surprising overshoot →
            hold/fade), confidence-weighted, with <code className="text-info">gapBps = pWatched − pRef</code>{" "}
            the distance your posted price has drifted from truth.
          </p>
          <p className="mt-3">
            Grading is <span className="amber">CLV</span> (closing-line value):{" "}
            <code className="text-info">back: r = (p_close − p_entry)/p_entry</code>. It resolves from
            odds alone, which makes the calibration ledger fast-settling and low-variance. The full
            derivation lives in <code className="text-info">lib/agent-core.mjs</code>.
          </p>
        </div>
      </section>

      {/* ─── Operator API ─────────────────────────────────────────────── */}
      <section className="mb-10 border-t border-ink-600 pt-10">
        <p className="label">market operators</p>
        <h2 className="serif mt-1 text-3xl text-paper">Operator API</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Don&apos;t want to embed the SDK? Consume the <span className="text-fg">HTTP API</span>. Three
          authenticated, versioned endpoints — the signals, the provable track record, and the
          read-only boundary timeline. Every signal carries the{" "}
          <code className="text-info">proofHash</code> that reconciles it against the frame ledger, so
          you can verify it came from real, on-chain-authorized TxLINE data.
        </p>

        <div className="mt-5 space-y-3">
          {ENDPOINTS.map(([sig, desc, params]) => (
            <div key={sig} className="card p-4">
              <p className="font-mono text-sm text-amber">{sig}</p>
              <p className="mt-1 text-xs text-muted">{desc}</p>
              <p className="mt-1 font-mono text-xs text-faint">params: {params}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-faint">
          Auth: <code className="text-info">Authorization: Bearer &lt;key&gt;</code> or{" "}
          <code className="text-info">X-Api-Key: &lt;key&gt;</code>. Public demo key:{" "}
          <code className="text-amber">ag_demo_2026</code> (production deployments set
          OPERATOR_API_KEYS and rotate per consumer). <code className="text-info">/api/v1/edges</code>{" "}
          is kept as a raw-edges back-compat alias.
        </p>

        <p className="label mb-2 mt-6">try it</p>
        <Code>{`curl -s https://agenthesis-eta.vercel.app/api/v1/signals \\
  -H "X-Api-Key: ag_demo_2026"

# only high-confidence fades on one fixture
curl -s "https://agenthesis-eta.vercel.app/api/v1/signals?action=fade&minConfidence=0.7" \\
  -H "X-Api-Key: ag_demo_2026"`}</Code>

        <p className="label mb-2 mt-6">response (abridged)</p>
        <Code>{`{
  "version": "1",
  "product": "line-integrity-oracle",
  "proof": { "signedOnSolana": true, "explorerUrl": "https://explorer.solana.com/tx/…" },
  "fixtures": [
    {
      "fixtureId": "18172469",
      "label": "Brazil v Japan",
      "signals": [
        {
          "kind": "overreaction",
          "action": "fade",
          "confidence": 1,
          "pickoffRisk": "high",
          "market": "OVERUNDER_PARTICIPANT_GOALS line=3 over",
          "pRef": 0.4579,
          "pWatched": null,
          "gapBps": null,
          "firedBy": "surprise",
          "note": "GOAL (Participant1): 17.4%→45.8% — fade the overreaction",
          "proofHash": "b4aff838"
        }
      ]
    }
  ]
}`}</Code>

        <p className="label mb-2 mt-6">webhook contract (push)</p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          In production the same signal is delivered by push. Register a URL and a persistent worker
          watching the live TxLINE stream POSTs each new signal to it:
        </p>
        <Code>{`POST https://your-endpoint.example/agenthesis-signals
X-Agenthesis-Signature: sha256=<hmac of body with your secret>
Content-Type: application/json

{ "event": "signal.opened", "signal": { /* identical shape to the poll response */ } }`}</Code>
        <p className="mt-2 max-w-2xl text-xs text-faint">
          The poll endpoint is the deterministic, always-available implementation (it replays the
          bundled real captures, since serverless throttles a live engine). A live deployment runs a
          persistent, co-located worker — and because the warning only pays if it beats the pickoff by
          milliseconds, that low-latency direct feed is a continuing partnership with TxOdds.
        </p>
      </section>

      <footer className="mt-10 border-t border-ink-600 pt-5 text-xs text-faint">
        Read the full thesis in the{" "}
        <Link href="/litepaper" className="prompt text-amber hover:text-fg">
          litepaper
        </Link>
        , or watch signals fire against the live book in the{" "}
        <Link href="/desk" className="text-amber hover:text-fg">
          Control Room
        </Link>
        .
      </footer>
    </div>
  );
}
