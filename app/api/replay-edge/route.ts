// /api/replay-edge — run the divergence trade policy over one published pickoff match.
//
//   GET /api/replay-edge                       -> { fixtures: [{ fid, teams, points }] }  (picker)
//   GET /api/replay-edge?fixtureId=<fid>&theta=&stake=&exit=
//        -> buildReplayEdge(match, policy): frames + entries + virtual-USD positions + summary
//
// Reads the same runtime pickoff blob /proof uses (getPickoffs), so a newly-settled match is
// replayable with NO redeploy. Compute is the pure lib/replay-edge.mjs bridge.
import { NextResponse } from "next/server";
import { getPickoffs } from "@/lib/pickoff-source";
import { buildReplayEdge } from "@/lib/replay-edge.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ledger = await getPickoffs();
  const matches = ledger?.matches ?? [];
  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId");

  if (!fixtureId) {
    return NextResponse.json({
      fixtures: matches
        .map((m) => ({ fid: String(m.fid), teams: m.teams, points: m.series.length }))
        .sort((a, b) => b.points - a.points),
    });
  }

  const m = matches.find((x) => String(x.fid) === String(fixtureId));
  if (!m) return NextResponse.json({ error: "unknown fixture" }, { status: 404 });

  const num = (k: string, d: number) => {
    const v = Number(url.searchParams.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const exit = url.searchParams.get("exit") || "resolution";
  const policy = { theta: num("theta", 0.05), stakeUsd: num("stake", 100), exit };
  return NextResponse.json(buildReplayEdge(m, policy));
}
