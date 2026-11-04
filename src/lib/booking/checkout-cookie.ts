import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const CHECKOUT_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-wda_checkout_v1"
  : "wda_checkout_v1";
export const CHECKOUT_COOKIE_TTL_SECONDS = 15 * 60;

function secret(): string {
  const value = process.env.BOOKING_CHECKOUT_SECRET;
  if (!value && process.env.NODE_ENV !== "production") return "local-development-checkout-secret-32-bytes-minimum";
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("BOOKING_CHECKOUT_SECRET must contain at least 32 bytes.");
  }
  return value;
}

function signature(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createCheckoutGrant(bookingId: string): string {
  const payload = Buffer.from(JSON.stringify({ bookingId, expiresAt: Date.now() + CHECKOUT_COOKIE_TTL_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyCheckoutGrant(value: string | undefined): string | null {
  if (!value || value.length > 512) return null;
  const [payload, supplied, ...extra] = value.split(".");
  if (!payload || !supplied || extra.length) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { bookingId?: unknown; expiresAt?: unknown };
    return typeof parsed.bookingId === "string" && /^[0-9a-f-]{36}$/i.test(parsed.bookingId) &&
      typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now() ? parsed.bookingId : null;
  } catch {
    return null;
  }
}

export async function getCheckoutGrantBookingId(): Promise<string | null> {
  const value = (await cookies()).get(CHECKOUT_COOKIE_NAME)?.value;
  return verifyCheckoutGrant(value);
}

export const checkoutCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: CHECKOUT_COOKIE_TTL_SECONDS,
};
