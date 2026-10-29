/** Shared URL builders for booking links (server-only callers). */

export function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function manageUrl(token: string): string {
  return `${siteBase()}/booking/manage?token=${encodeURIComponent(token)}`;
}
