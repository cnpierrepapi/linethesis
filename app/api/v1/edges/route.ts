// /api/v1/edges — the OPERATOR API.
//
// A clean, authenticated, versioned poll endpoint. A prediction market (or any B2B
// intermediary between TxLINE and a book) polls this and receives, per match, the
// pickoffs Linethesis measured: each carries the book's price, TxLINE's vig-free fair,
// the stale gap, and the Polygon transaction hash that settled the fill on-chain, so the
// operator reconciles every signal against the public ledger.
//
// Auth: send the key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.
//   Valid keys = OPERATOR_API_KEYS (comma-separated env) plus a public demo key. No key -> 401.
//
// Source: the same real pickoff ledger the site reads (Polymarket fills read on-chain from
// Polygon, aligned to TxLINE's demargined fair). In a live deployment this same contract is
// served in real time by a co-located worker; only the clock differs.
import { NextResponse } from "next/server";
import { getPickoffs, polygonTx } from "@/lib/pickoff-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_KEY = "ag_demo_2026";

function validKey(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const supplied = bearer || req.headers.get("x-api-key")?.trim() || null;
  if (!supplied) return false;
  const keys = new Set(
    (process.env.OPERATOR_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean),
  );
  keys.add(DEMO_KEY);
  return keys.has(supplied);
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
  const minStale = Math.max(0, Number(url.searchParams.get("minStalePp")) || 5); // pp off fair
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 200);

  const ledger = await getPickoffs();
  let matches = ledger?.matches ?? [];
  if (fixtureId) matches = matches.filter((m) => String(m.fid) === String(fixtureId));

  const out = matches.map((m) => {
    const pickoffs = m.top_pickoffs
      .filter((p) => Math.abs(p.gap_pp) >= minStale)
      .slice(0, limit)
      .map((p) => ({
        minute: Math.max(0, Math.round((p.t * 1000 - m.kick) / 60000)),
        book_prob: p.pm, // the market's implied P(win) at the fill
        fair_prob: p.fair, // TxLINE vig-free fair at that instant
        stale_pp: p.gap_pp, // signed: +ve = book above fair (rich), -ve = below (cheap)
        direction: p.gap_pp > 0 ? "book_rich" : "book_cheap",
        size_usd: p.usd,
        proof: { chain: "polygon", tx: p.tx, url: polygonTx(p.tx) },
      }));
    return {
      fixtureId: m.fid,
      teams: m.teams,
      market: m.slug,
      medianGapPp: m.inplay.median_pp,
      leakageUsd: m.inplay.ge5pp_usd, // $ traded >=5pp off fair, in-play
      pickoffCount: pickoffs.length,
      pickoffs,
    };
  });

  const now = Date.now();
  return NextResponse.json({
    version: "1",
    generatedAt: now,
    generatedAtISO: new Date(now).toISOString(),
    source: "polymarket-onchain × txline-devig",
    note: "Real pickoffs: Polymarket order-book fills read on-chain from Polygon, aligned to TxLINE's vig-free fair. Each proof.tx is the Polygon transaction that settled the fill; open it to verify.",
    filters: { fixtureId: fixtureId ?? null, minStalePp: minStale, limit },
    matchCount: out.length,
    pickoffCount: out.reduce((s, m) => s + m.pickoffCount, 0),
    matches: out,
  });
}
