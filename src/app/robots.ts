import type { MetadataRoute } from "next";
import { getPublicOrigin, isPublicIndexingEnabled } from "@/lib/seo/metadata";

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicOrigin();
  if (!isPublicIndexingEnabled() || !origin) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/auth/", "/booking/manage"],
    },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}
