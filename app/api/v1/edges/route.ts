// /api/v1/edges — the MARKET-OPERATOR API.
//
// A clean, authenticated, versioned poll endpoint. An operator (or any B2B
// intermediary sitting between TxLINE and a trading operation) polls this and
// receives typed, scored edges per fixture — each carrying the proofHash that
// ties it to the exact real TxLINE frame it was derived from, so the operator
// can reconcile every signal against the frame ledger (/api/verify-csv).
//
// Auth: send the key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.
//   Valid keys = OPERATOR_API_KEYS (comma-separated env) plus a public demo key
//   for evaluation. No key -> 401.
//
// Source: a deterministic snapshot replayed from the bundled real captures (see
// lib/operator-feed.mjs for why — serverless throttles the live engine). The
// payload shape is identical to what a persistent production worker streams;
// only the clock differs. The webhook contract (push instead of poll) is
// documented on /sdk and returns this same Edge object.
import { NextResponse } from "next/server";
import { computeOperatorEdges } from "@/lib/operator-feed.mjs";
import { getProof } from "@/lib/proof";
import { getReplays } from "@/lib/replays-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A published demo key so evaluators can call the API immediately. Real
// deployments set OPERATOR_API_KEYS and rotate per consumer.
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
let CACHE: { at: number; val: ReturnType<typeof computeOperatorEdges> } | null = null;
async function snapshot() {
  if (CACHE && Date.now() - CACHE.at < 60_000) return CACHE.val;
  const val = computeOperatorEdges((await getReplays()) as unknown as Parameters<typeof computeOperatorEdges>[0]);
  CACHE = { at: Date.now(), val };
  return val;
}

const CONV_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

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
  const kind = url.searchParams.get("kind"); // steam|overreaction|quote
  const minConv = url.searchParams.get("conviction"); // High|Medium|Low
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 200);

  let fixtures = await snapshot();
  if (fixtureId) fixtures = fixtures.filter((f) => String(f.fixtureId) === String(fixtureId));

  const minRank = minConv ? CONV_RANK[minConv] ?? 0 : 0;
  const out = fixtures.map((f) => {
    let edges = f.edges;
    if (kind) edges = edges.filter((e) => e.kind === kind);
    if (minRank) edges = edges.filter((e) => (CONV_RANK[e.conviction] ?? 0) >= minRank);
    edges = edges.slice(0, limit);
    return { fixtureId: f.fixtureId, label: f.label, edgeCount: edges.length, edges };
  });

  const now = Date.now();
  return NextResponse.json({
    version: "1",
    generatedAt: now,
    generatedAtISO: new Date(now).toISOString(),
    source: "txline-capture-replay",
    note: "Deterministic snapshot derived from real captured TxLINE frames. In production this same Edge contract is served live by a persistent worker (poll or webhook). Each edge.proofHash reconciles against /api/verify-csv.",
    proof: getProof(),
    filters: { fixtureId: fixtureId ?? null, kind: kind ?? null, conviction: minConv ?? null, limit },
    fixtureCount: out.length,
    edgeCount: out.reduce((s, f) => s + f.edgeCount, 0),
    fixtures: out,
  });
}
