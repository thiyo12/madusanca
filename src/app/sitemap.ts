import type { MetadataRoute } from "next";
import { getPublicOrigin, isPublicIndexingEnabled } from "@/lib/seo/metadata";

const publicPaths = [
  "/",
  "/lessons",
  "/about",
  "/contact",
  "/booking",
  "/privacy",
  "/terms",
  "/accessibility",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getPublicOrigin();
  if (!isPublicIndexingEnabled() || !origin) return [];

  return publicPaths.map((path) => ({
    url: new URL(path, origin).toString(),
  }));
}
