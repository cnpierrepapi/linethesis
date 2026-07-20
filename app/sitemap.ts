import type { MetadataRoute } from "next";

// Canonical public surfaces only. The retired stubs (/build, /desk, /leaderboard, /papers, /sandbox)
// are intentionally excluded and disallowed in robots.ts.
const BASE = "https://lagisalpha.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1.0, changeFrequency: "daily" },
    { path: "/edge", priority: 0.9, changeFrequency: "hourly" },
    { path: "/proof", priority: 0.9, changeFrequency: "hourly" },
    { path: "/launch", priority: 0.8, changeFrequency: "weekly" },
    { path: "/api", priority: 0.7, changeFrequency: "weekly" },
    { path: "/litepaper", priority: 0.8, changeFrequency: "weekly" },
  ];
  return routes.map((r) => ({ url: `${BASE}${r.path}`, lastModified: now, changeFrequency: r.changeFrequency, priority: r.priority }));
}
