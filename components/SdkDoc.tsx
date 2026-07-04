import Link from "next/link";

const REPO = "https://github.com/cnpierrepapi/agenthesis";

function Code({ children }: { children: string }) {
  return (
    <pre className="card overflow-x-auto p-4 text-[0.8rem] leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}

const ENDPOINTS = [
  [
    "GET /api/v1/signals",
    "the product: classified read-only line-integrity signals per fixture: steam, overreaction, and goal_imminent",
    "fixtureId · kind (steam|overreaction|goal_imminent) · action (follow|hold|fade|suspend) · minConfidence · limit",
  ],
  [
    "GET /api/v1/calibration",
    "the provable track record: follow/hold held-rate (FCV ±10pp), fade reversion-rate, goal_imminent arrival-lift, per kind/action + breadth",
    "detail=1 to include the settled rows",
  ],
  [
    "GET /api/v1/control-room",
    "the read-only boundary timeline: signal → stale-book gap → operator action",
    "fixtureId · lagMs (naive-book latency)",
  ],
];

const PRIMITIVES = [
  {
    kind: "Detection",
    fn: "EdgeEngine",
    body: "Ingest the demargined book → typed reference-line events (steam = a sharp fair-prob move; overreaction = a post-goal overshoot), plus the momentum tape off the scores stream.",
  },
  {
    kind: "Classification",
    fn: "classifyEdge · goalImminent",
    body: "Turn each event into a read-only signal: steam → follow, overreaction → hold/fade, goal_imminent → suspend (carrying a quantified goalProb). Confidence, pickoffRisk, and gapBps vs your own price. You act on it; we never touch your book.",
  },
  {
    kind: "Grading",
    fn: "FCV-held  ·  scoreCLV (aux)",
    body: "Follow/hold is graded on Fair Close Value staying inside its ±10pp drift band; fade on reversion; goal_imminent on goal-arrival lift. scoreCLV ships as the auxiliary CLV diagnostic. All resolve from odds alone; no match outcome required.",
  },
];

const API = [
  {
    sig: "new EdgeEngine(opts?)",
    desc: "Detection. ingestOdds(rec), ingestScores(rec), on(\"edge\"|\"matchEvent\", cb), matchMinute(fixtureId). opts tune thresholds/windows. Edges carry preEventProb for surprise-conditioning.",
  },
  {
    sig: "classifyEdge(edge, { minute, watchedProb, preEventProb })",
    desc: "→ a read-only signal { kind (steam|overreaction), action (follow|hold|fade), confidence, pickoffRisk, pRef, pWatched, gapBps, firedBy, revertLikely, direction, proofHash? } or null (out-of-scope markets / quote edges). watchedProb = your price → gapBps is the pickoff surface. Pure.",
  },
  {
    sig: "goalImminent(scoreRec, { minute })",
    desc: "→ a first-class suspend-suggested signal off the momentum tape (high_danger_possession / PossibleEvent.Goal) BEFORE a goal lands, carrying a quantified goalProb = calibrated P(goal ≤120s), or null. No market/price attached (it settles on goal arrival, not the line). Pure.",
  },
  {
    sig: "markPosition(pos, closeProb) / scoreCLV({ entryProb, direction, stake }, closeProb)",
    desc: "→ { clvReturn, pnl }. The AUXILIARY CLV diagnostic. The headline follow/hold verdict is Fair Close Value (did the line hold within ±10pp of entry at the +180s close), computed in the calibration layer /api/v1/calibration serves; fade is graded on reversion. Pure. Constants: CONTINUATION_COEFF, KELLY_CAP, CLV_FLOOR, CLV_CEIL.",
  },
];

export default function SdkDoc() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-10">
        <p className="label">developer access</p>
        <h1 className="serif mt-1 text-4xl text-paper">Agenthesis API &amp; SDK</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          The product is the signal API: <code className="text-info">GET /api/v1/signals</code>, an
          authenticated HTTP feed of <span className="text-fg">read-only line-integrity signals</span>,
          each carrying the <code className="text-info">proofHash</code> that reconciles it to a real
          TxLINE frame. A clean move to follow, an overreaction to fade, a goal about to make your line
          stale. The SDK is an <span className="text-fg">optional thin wrapper</span> around the exact
          same pure functions, for latency-sensitive consumers that run the classifier in-process.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-faint">
          Either way, Agenthesis never places a bet, moves a price, or holds funds; your rule-set takes
          the action. Both surfaces run identical pure code (SDK↔API parity): no I/O, no clock reads,
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

      {/* ─── Operator API: THE PRODUCT ───────────────────────────────────── */}
      <section className="mb-12">
        <p className="label">market operators: the product</p>
        <h2 className="serif mt-1 text-3xl text-paper">Operator API</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Consume the <span className="text-fg">HTTP API</span>, no code to embed. Three
          authenticated, versioned endpoints: the signals, the provable track record, and the
          read-only boundary timeline. Every signal carries the <code className="text-info">proofHash</code>{" "}
          that reconciles it against the frame ledger, so you can verify it came from real,
          on-chain-authorized TxLINE data.
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
          "firedBy": "surprise",
          "note": "GOAL (Participant1): 17.4%→45.8%; fade the overreaction",
          "proofHash": "b4aff838"
        },
        {
          "kind": "goal_imminent",
          "action": "suspend-suggested",
          "confidence": 0.855,
          "goalProb": 0.111,
          "pickoffRisk": "high",
          "market": null,
          "firedBy": "possession_tier",
          "trigger": "high_danger_possession",
          "note": "goal-imminent (high_danger_possession, P(goal≤120s)≈11%); suspend/widen before the line goes stale"
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
          persistent, co-located worker, and because the warning only pays if it beats the pickoff by
          milliseconds, that low-latency direct feed is a continuing partnership with TxOdds.
        </p>
      </section>

      {/* ─── SDK: the optional in-process wrapper ────────────────────────── */}
      <section className="mb-10 border-t border-ink-600 pt-10">
        <p className="label">latency-sensitive consumers</p>
        <h2 className="serif mt-1 text-3xl text-paper">The SDK</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          A network round-trip can&apos;t sit inside a millisecond-latency pickoff loop. If you run the
          classifier in-process, embed the <span className="text-fg">exact code the API runs</span>:
          the same pure detection, classification, and grading functions the deployed product serves.
          You bring your TxLINE feed and your prices; the SDK returns read-only signals.
        </p>
      </section>

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
import { EdgeEngine, classifyEdge, goalImminent, scoreCLV }
  from "agenthesis/sdk";`}</Code>
        <p className="mt-2 text-xs text-faint">
          The package exposes only the pure detection + classification + grading layer. It pulls in no
          runtime dependencies beyond Node&apos;s built-in <code className="text-info">events</code>.
        </p>
      </section>

      {/* Quickstart */}
      <section className="mb-10">
        <p className="label mb-3">quickstart</p>
        <Code>{`import { EdgeEngine, classifyEdge, goalImminent } from "agenthesis/sdk";

const engine = new EdgeEngine();                       // detection thresholds

engine.on("edge", (edge) => {
  const minute     = engine.matchMinute(edge.market.fixtureId);
  const watchedProb = myBook.impliedProbFor(edge.market); // YOUR price (optional)
  const signal = classifyEdge(edge, { minute, watchedProb });
  if (!signal) return;                                 // out-of-scope / no signal
  // signal.action ∈ follow | hold | fade ; signal.pickoffRisk ; signal.gapBps
  myRuleSet.apply(signal);                             // YOUR book takes the action
});

engine.on("matchEvent", (rec) => {
  const imminent = goalImminent(rec, { minute: engine.matchMinute(rec.FixtureId) });
  if (imminent) myRuleSet.apply(imminent);             // suspend/widen before the line goes stale
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
        <p className="label mb-3">sdk reference</p>
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
            <code className="text-info">pRef = 1 / (price/1000)</code>, the fair line we benchmark
            against. A signal is a classified move on that line: <span className="amber">steam</span>{" "}
            (a clean, efficient move, the <span className="text-fg">primary</span> edge; it held in our
            captures → follow), <span className="amber">overreaction</span> (a surprising post-goal
            overshoot that can revert → hold, or fade when surprise-driven), or{" "}
            <span className="amber">goal_imminent</span> (the momentum tape flags{" "}
            <code className="text-info">P(goal ≤120s)</code> before the line jumps → suspend).
          </p>
          <p className="mt-3">
            Grading is <span className="amber">Fair Close Value (FCV)</span>, not CLV. A follow/hold is
            right when the line <span className="text-fg">held</span> where it moved: the demargined
            fair prob at the <code className="text-info">+180s</code> close stayed within{" "}
            <code className="text-info">±10pp</code> of entry (a clean move that sticks means a book
            still quoting the old number is left behind). A fade is graded on reversion.{" "}
            <span className="amber">goal_imminent</span> has no line to close against, so it settles on
            goal <span className="text-fg">arrival</span>: the calibrated ~1.9× lift in P(goal ≤120s).
          </p>
          <p className="mt-3">
            CLV ships as an auxiliary diagnostic (<code className="text-info">scoreCLV</code>): because a
            follow is taken at fair value its expected CLV is ~0, so &quot;CLV-positive&quot; is the
            wrong test for a continuation; FCV-held is the honest one. The derivations live in{" "}
            <code className="text-info">lib/signals/</code>.
          </p>
          <p className="mt-3">
            It runs on nothing but TxLINE. Both surfaces need the same two{" "}
            <span className="text-fg">TxLINE inputs</span>: the de-vig odds stream (
            <code className="text-info">ingestOdds</code>, the fair line everything is benchmarked on) and
            the possession tape (<code className="text-info">ingestScores</code>, the attacking-pressure
            feed <code className="text-info">goalImminent</code> reads). Signals are scoped to the goals
            markets that stream demargined today; as TxLINE streams more of the de-vig book{" "}
            <span className="text-fg">beyond goals</span>, cards, corners, match odds, the same code
            covers more of your lines with no change on your side.
          </p>
        </div>
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
