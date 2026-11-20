import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE_NAME = "wda_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_SECONDS * 1000;
const MAX_FUTURE_SKEW_MS = 60_000;

function signature(userId: string, issuedAt: number): string | null {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHmac("sha256", secret)
    .update(`wda-admin-session-v1\n${userId}\n${issuedAt}`)
    .digest("base64url");
}

/** Create a tamper-evident, user-bound timestamp for the absolute admin session limit. */
export function createAdminSessionCookieValue(userId: string, issuedAt = Date.now()): string | null {
  if (!userId || !Number.isSafeInteger(issuedAt) || issuedAt < 0) return null;
  const mac = signature(userId, issuedAt);
  return mac ? `${issuedAt}.${mac}` : null;
}

/** Admin sessions expire 12 hours after password sign-in; refreshes cannot extend this timestamp. */
export function isAdminSessionCookieValid(
  value: string | undefined,
  userId: string,
  now = Date.now(),
): boolean {
  if (!value || !userId || !Number.isSafeInteger(now)) return false;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^\d{10,16}$/.test(parts[0])) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isSafeInteger(issuedAt)) return false;
  const age = now - issuedAt;
  if (age < -MAX_FUTURE_SKEW_MS || age >= ADMIN_SESSION_TTL_MS) return false;

  const expected = signature(userId, issuedAt);
  if (!expected) return false;
  const actualBytes = Buffer.from(parts[1]);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
