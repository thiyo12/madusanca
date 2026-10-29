import { createHash, randomInt } from "crypto";

/** Short-lived: enough to switch tabs and copy, not enough to brute force. */
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** 6-digit numeric code (never persisted in full — only its hash is stored). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Bound to the email so a stolen hash cannot verify a different account. */
export function hashOtp(email: string, code: string): string {
  return createHash("sha256")
    .update(`${email.trim().toLowerCase()}:${code.trim()}`, "utf8")
    .digest("hex");
}

export function otpExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + OTP_TTL_MIN * 60 * 1000).toISOString();
}
