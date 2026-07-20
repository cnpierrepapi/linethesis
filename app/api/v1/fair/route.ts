// RETIRED. /api/v1/fair streamed the current TxLINE de-vig fair per LIVE fixture; the live surface was
// retired when the tournament closed. See lib/retired.ts. The archival feed is /api/v1/divergences.
import { gone } from "@/lib/retired";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return gone();
}
