import type { MetadataRoute } from "next";

const BASE = "https://lagisalpha.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // retired stubs + internal surfaces, not part of the product
      disallow: ["/build", "/desk", "/leaderboard", "/papers", "/sandbox", "/live"],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
