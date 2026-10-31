import "server-only";
import { cookies } from "next/headers";

// __Host- prevents sibling subdomains from planting a cookie with this name.
// The prefix requires Secure, so use a local-development-safe name outside prod.
export const MANAGE_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-wda_manage"
  : "wda_manage";
export const MANAGE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function getManageToken(): Promise<string | null> {
  const cookieToken = (await cookies()).get(MANAGE_COOKIE_NAME)?.value;
  return cookieToken || null;
}

export const manageCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax is required for Stripe's cross-site top-level GET return navigation.
  sameSite: "lax" as const,
  path: "/",
  maxAge: MANAGE_TOKEN_TTL_SECONDS,
};
