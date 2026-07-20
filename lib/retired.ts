// Shared 410 responder for retired operator-era (line-integrity) endpoints. Lagisalpha is now a
// pro-trader signal feed; the old "benchmark an operator's book / follow-hold-fade" surfaces are gone.
// A 410 (not 404) tells any existing caller the route was intentionally removed and where to go next.
import { NextResponse } from "next/server";

export function gone() {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "This endpoint was retired. The live surface closed with the tournament; lagisalpha is now an archival signal feed. Use GET /api/v1/divergences (the settled-match signal feed) or GET /api/v1/track-record. See /launch.",
    },
    { status: 410 },
  );
}
