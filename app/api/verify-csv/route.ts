// /api/verify-csv — download the verification CSV (the signal ledger).
//
// One row per SETTLED line-integrity signal (from the calibration ledger, computed
// deterministically over the bundled real TxLINE captures). TxLINE's team — or any
// operator — reconciles our demargined reference on (fixture_id, frame_ts_ms,
// demargined_fair_prob) against their own book, and sees exactly which call we made
// (kind → action) and how it settled on closing-line value. Matches /proof exactly.
import { buildSignalCsv, type SettledSignal } from "@/lib/verify";
import { computeCalibration } from "@/lib/operator-feed.mjs";
import { getReplays } from "@/lib/replays-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { settled } = computeCalibration((await getReplays()) as unknown as Parameters<typeof computeCalibration>[0]);
  const { csv, signalCount, matchCount } = buildSignalCsv(settled as unknown as SettledSignal[]);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lagisalpha-signal-ledger-${stamp}.csv"`,
      // The ledger only changes when a new match publishes (~1/day at most), and building it
      // pulls every per-match blob from Supabase — let Vercel's CDN absorb repeat downloads.
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      "X-Signal-Count": String(signalCount),
      "X-Match-Count": String(matchCount),
    },
  });
}
