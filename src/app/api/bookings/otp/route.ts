import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { otpSchema } from "@/lib/validation/booking";
import { generateOtpCode, hashOtp, otpExpiry, OTP_TTL_MIN } from "@/lib/booking/otp";
import { isRateLimitedShared, clientIp } from "@/lib/server/rate-limit";
import { sendBookingOtpEmail } from "@/lib/email/booking-emails";
import type { BookingRecord } from "@/lib/booking/types";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;

/**
 * Self-service booking finder.
 *
 * Security model:
 *  - The send step always answers identically, so nobody can probe which
 *    emails have bookings.
 *  - Only a SHA-256 hash of the 6-digit code is stored, bound to the email.
 *  - Codes expire after 10 minutes and lock after 5 wrong attempts.
 *  - Per-IP and per-email rate limits slow down abuse and email bombing.
 *  - A manage token (30 days, hashed, rotated) is only issued after the code
 *    verifies — payment remains available even inside the 48-hour change cutoff.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);
  if (await isRateLimitedShared(`otp-ip:${ip}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const result = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = otpSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Please check the form." },
      { status: 400 },
    );
  }

  const { action, email, code, reference } = parsed.data;
  const genericSend = {
    ok: true,
    message: `If an active booking exists for that email, a 6-digit code has been requested; it expires in ${OTP_TTL_MIN} minutes. Use it to view your booking and payment options. Online date changes close 48 hours before the lesson.`,
    retryAfterSeconds: 120,
  };

  try {
    const store = getStore();

    if (action === "send") {
      const found = await store.findBookingsByEmail(email);
      const eligible = found.filter(
        (booking) =>
          booking.status === "pending_payment" || booking.status === "confirmed" || booking.status === "rescheduled",
      );
      const target = eligible[0];
      if (target) {
        const quota = await store.consumeOtpSendQuota(email, new Date().toISOString());
        if (!quota.allowed) return NextResponse.json(genericSend);
        const otp = generateOtpCode();
        await store.putOtp(email, hashOtp(email, otp), otpExpiry());
        const sent = await sendBookingOtpEmail({
          studentName: target.studentName,
          studentEmail: target.email,
          code: otp,
        });
        if (!sent) {
          console.error("[otp] verification email was not delivered; check Resend sender/domain settings");
        }
      }
      return NextResponse.json(genericSend);
    }

    // verify / token both require the code.
    const verification = await store.verifyOtp(email, hashOtp(email, code ?? ""), action === "token");
    if (!verification.ok) {
      const message =
        verification.reason === "locked"
          ? "Too many wrong attempts. Send a new code."
          : verification.reason === "expired"
            ? "That code has expired. Send a new one."
            : "That code doesn't match.";
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const found = await store.findBookingsByEmail(email);

    if (action === "verify") {
      return NextResponse.json({
        ok: true,
        bookings: found.slice(0, 10).map((booking) => safeListItem(booking)),
      });
    }

    // action === "token"
    const wanted = reference?.toUpperCase();
    const target = wanted
      ? found.find((b) => b.reference === wanted)
      : found.find((b) => b.status === "pending_payment" || b.status === "confirmed" || b.status === "rescheduled") ?? found[0];
    if (!target) {
      return NextResponse.json(
        { ok: false, error: "That booking could not be found for this email." },
        { status: 404 },
      );
    }
    const token = await store.issueManageToken(target.id);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Could not open that booking. Please try again." },
        { status: 500 },
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(MANAGE_COOKIE_NAME, token, manageCookieOptions);
    return response;
  } catch (error) {
    logSafeError("[otp] failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not process the request. Please try again." },
      { status: 500 },
    );
  }
}

function safeListItem(booking: BookingRecord): {
  reference: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  status: BookingRecord["status"];
  canOpen: boolean;
} {
  return {
    reference: booking.reference,
    lessonName: booking.lessonName,
    durationMin: booking.durationMin,
    priceCad: booking.priceCad,
    startsAt: booking.startsAt,
    status: booking.status,
    canOpen: booking.status === "pending_payment" || booking.status === "confirmed" || booking.status === "rescheduled",
  };
}
