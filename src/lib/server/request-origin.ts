/** Validate browser mutation requests against the configured site origin. */
export function hasTrustedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const expected = new URL(siteUrl);
    const actual = new URL(origin);
    if (process.env.NODE_ENV === "production" && expected.protocol !== "https:") return false;
    return actual.origin === expected.origin && actual.origin !== "null";
  } catch {
    return false;
  }
}
