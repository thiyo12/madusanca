import "server-only";

/** Canonical application origin used when Supabase sends auth callbacks. */
export function publicSiteUrl(): string {
  // Recovery links must never inherit a stale preview/localhost production env.
  if (process.env.NODE_ENV === "production") return "https://wisdomdrivingacademy.com";
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return configured || "http://localhost:3000";
}
