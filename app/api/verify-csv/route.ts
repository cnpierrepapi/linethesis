// /api/verify-csv — download the verification CSV (the signal ledger).
//
// One row per SETTLED line-integrity signal (from the calibration ledger, computed
// deterministically over the bundled real TxLINE captures). TxLINE's team — or any
// operator — reconciles our demargined reference on (fixture_id, frame_ts_ms,
// demargined_fair_prob) against their own book, and sees exactly which call we made
// (kind → action) and how it settled on closing-line value. Matches /proof exactly.
import { buildSignalCsv, type SettledSignal } from "@/lib/verify";
import { computeCalibration } from "@/lib/operator-feed.mjs";
import replaysData from "@/lib/replays.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { settled } = computeCalibration(replaysData as unknown as Parameters<typeof computeCalibration>[0]);
  const { csv, signalCount, matchCount } = buildSignalCsv(settled as unknown as SettledSignal[]);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agenthesis-signal-ledger-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Signal-Count": String(signalCount),
      "X-Match-Count": String(matchCount),
    },
  });
}
