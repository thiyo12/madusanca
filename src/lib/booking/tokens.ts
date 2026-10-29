import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;
const TOKEN_TTL_DAYS = 30;

/** URL-safe opaque token handed to the customer exactly once (via email). */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Only the hash is ever persisted — a DB leak cannot be used to manage bookings. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenExpiry(from: Date = new Date()): string {
  return new Date(
    from.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= 128;
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
