import { createHmac, randomInt } from "crypto";

/** Short-lived: enough to switch tabs and copy, not enough to brute force. */
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** 6-digit numeric code (never persisted in full — only its hash is stored). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Bound to the email so a stolen hash cannot verify a different account. */
export function hashOtp(email: string, code: string): string {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("OTP_HASH_SECRET must be configured in production.");
  }
  const pepper = secret ?? "local-development-only-otp-pepper-with-sufficient-length";
  if (Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("OTP_HASH_SECRET must contain at least 32 bytes.");
  }
  return createHmac("sha256", pepper)
    .update(`${email.trim().toLowerCase()}:${code.trim()}`, "utf8")
    .digest("hex");
}

export function otpExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + OTP_TTL_MIN * 60 * 1000).toISOString();
}
