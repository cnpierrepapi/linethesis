// /api/v1/signals — the headline MARKET-OPERATOR endpoint (LOCKED product).
//
// Agenthesis is a read-only line-integrity oracle. This endpoint serves the
// SIGNAL contract: per fixture, scored recommendations an operator's own rule-set
// acts on — kind (steam|overreaction|goal_imminent) → action (follow|hold|fade|
// suspend-suggested), a confidence, a pickoffRisk, and pRef (TxLINE's demargined
// fair prob = the truth we benchmark against). goal_imminent fires off the momentum
// tape with a quantified goalProb (P(goal ≤120s)) — suspend/widen before a goal lands.
// We emit the signal; the operator decides whether to limit / reprice / suspend. We
// never touch the book.
//
// Each signal carries the proofHash tying it to the exact real TxLINE frame it was
// derived from (reconcile via /api/verify-csv). When an operator connects their own
// price, pWatched + gapBps (the pickoff surface) populate on the live/SSE path; the
// deterministic poll snapshot below has no book, so those are null.
//
// Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Keys = OPERATOR_API_KEYS
// (comma-separated env) plus the public demo key. No key -> 401.
//
// /api/v1/edges is retained as a back-compat alias serving the RAW engine edges
// (kind/conviction/direction) for any consumer already integrated against it.
import { NextResponse } from "next/server";
import { computeOperatorSignals } from "@/lib/operator-feed.mjs";
import { getProof } from "@/lib/proof";
import { getReplays } from "@/lib/replays-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_KEY = "ag_demo_2026";

function validKey(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const supplied = bearer || req.headers.get("x-api-key")?.trim() || null;
  if (!supplied) return false;
  const keys = new Set(
    (process.env.OPERATOR_API_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  keys.add(DEMO_KEY);
  return keys.has(supplied);
}

// TTL-cached so a newly-published match appears without a redeploy (runtime Supabase source).
let CACHE: { at: number; val: ReturnType<typeof computeOperatorSignals> } | null = null;
async function snapshot() {
  if (CACHE && Date.now() - CACHE.at < 60_000) return CACHE.val;
  const val = computeOperatorSignals((await getReplays()) as unknown as Parameters<typeof computeOperatorSignals>[0]);
  CACHE = { at: Date.now(), val };
  return val;
}

export async function GET(req: Request) {
  if (!validKey(req)) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message:
          "Provide an API key via 'Authorization: Bearer <key>' or 'X-Api-Key'. See /sdk for the operator demo key.",
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId");
  const kind = url.searchParams.get("kind"); // steam | overreaction | goal_imminent
  const action = url.searchParams.get("action"); // follow | hold | fade | suspend-suggested
  const minConfidence = Number(url.searchParams.get("minConfidence")) || 0;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 200);

  let fixtures = await snapshot();
  if (fixtureId) fixtures = fixtures.filter((f) => String(f.fixtureId) === String(fixtureId));

  const out = fixtures.map((f) => {
    let signals = f.signals;
    if (kind) signals = signals.filter((s) => s.kind === kind);
    if (action) signals = signals.filter((s) => s.action === action);
    if (minConfidence) signals = signals.filter((s) => s.confidence >= minConfidence);
    signals = signals.slice(0, limit);
    return { fixtureId: f.fixtureId, label: f.label, signalCount: signals.length, signals };
  });

  const now = Date.now();
  return NextResponse.json({
    version: "1",
    generatedAt: now,
    generatedAtISO: new Date(now).toISOString(),
    source: "txline-capture-replay",
    product: "line-integrity-oracle",
    note: "Read-only signals benchmarked against TxLINE's demargined consensus. We emit the recommendation (follow/hold/fade); the operator's rule-set acts. pWatched/gapBps populate live when a book is connected. Each signal.proofHash reconciles against /api/verify-csv. Same contract served live by a persistent worker in production.",
    proof: getProof(),
    filters: { fixtureId: fixtureId ?? null, kind: kind ?? null, action: action ?? null, minConfidence, limit },
    fixtureCount: out.length,
    signalCount: out.reduce((s, f) => s + f.signalCount, 0),
    fixtures: out,
  });
}
