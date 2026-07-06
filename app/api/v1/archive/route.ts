// RETIRED (operator-era line-integrity endpoint). See lib/retired.ts. Use /api/v1/divergences.
import { gone } from "@/lib/retired";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return gone();
}
export async function POST() {
  return gone();
}
