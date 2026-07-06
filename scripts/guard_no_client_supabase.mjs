// GUARD: no client component may fetch Supabase storage directly.
//
// A `"use client"` component that hits `*.supabase.co/storage/...` downloads the blob straight off
// Supabase on every render/poll, bypassing Vercel's CDN. That is exactly what blew the storage egress
// budget (HeroTerminal pulled the ~600KB pickoffs.json per visit; LiveStream polled a 52KB blob every
// 3s with a cache-buster). Client code must poll a same-origin, Vercel-cached /api/* route instead, or
// receive server-fetched data as props. This script fails `npm test` if the pattern comes back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app"];
const SUPABASE_STORAGE = /supabase\.co\/storage|storage\/v1\/object\/public/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const root of ROOTS) {
  let files;
  try { files = walk(root); } catch { continue; }
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const isClient = /^\s*["']use client["']/m.test(src);
    // API route handlers (app/**/route.ts) are server-side; they are allowed to fetch Supabase.
    const isRoute = /[\\/]route\.tsx?$/.test(f);
    if (isClient && !isRoute && SUPABASE_STORAGE.test(src)) offenders.push(f);
  }
}

if (offenders.length) {
  console.error("GUARD FAILED: client components fetch Supabase storage directly (egress risk):");
  for (const f of offenders) console.error("  - " + f);
  console.error("Fix: poll a same-origin /api/* route (Vercel-cached) or pass server-fetched data as props.");
  process.exit(1);
}
console.log("guard: no client-side Supabase storage fetches. OK");
