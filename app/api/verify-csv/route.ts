// /api/verify-csv — download the verification CSV.
//
// One row per real ingested TxLINE frame (original timestamp + prices) with the
// forecaster call tallied inline where one fired. TxLINE's team can reconcile
// (fixture_id, frame_ts_ms, prices) against their own database, and see exactly
// what the autonomous agents did on each frame.
//
// Execution overlay: we ALWAYS ship the CANONICAL recorded ledger
// (lib/exec-ledger.json — real trades from a full replay on these exact frames)
// so the export is deterministic and reproducible on every instance. We do NOT
// fall through to the per-request in-memory runner: on Vercel that runner is a
// fresh cold-start replay per lambda, so its trade set differs from request to
// request and would make the "audit artifact" non-reproducible.
import { buildVerificationCsv, type VerifyTrade } from "@/lib/verify";
import ledger from "@/lib/exec-ledger.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const trades = ledger as unknown as VerifyTrade[];

  const { csv, frameCount, tradedFrameCount, matchCount } = buildVerificationCsv(trades);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agenthesis-txline-verification-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Frame-Count": String(frameCount),
      "X-Traded-Frames": String(tradedFrameCount),
      "X-Match-Count": String(matchCount),
      "X-Trade-Count": String(trades.length),
    },
  });
}
