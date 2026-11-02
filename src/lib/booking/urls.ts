/** Shared URL builders for booking links (server-only callers). */

export function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function manageUrl(): string {
  // Email links are only an entry point to My Booking. Access is granted after
  // the student verifies their email with OTP; never put a manage token in a URL.
  return `${siteBase()}/booking/manage`;
}
