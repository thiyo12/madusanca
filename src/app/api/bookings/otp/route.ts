import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { otpSchema } from "@/lib/validation/booking";
import { generateOtpCode, hashOtp, otpExpiry, OTP_TTL_MIN } from "@/lib/booking/otp";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { sendBookingOtpEmail } from "@/lib/email/booking-emails";
import type { BookingRecord, PackagePurchaseRecord } from "@/lib/booking/types";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;

/**
 * Self-service booking finder.
 *
 * Security model:
 *  - The send step always answers identically, and only sends a code when the
 *    address has a booking or package purchase.
 *  - Only a SHA-256 hash of the 6-digit code is stored, bound to the email.
 *  - Codes expire after 10 minutes and lock after 5 wrong attempts.
 *  - Per-IP and per-email rate limits slow down abuse and email bombing.
 *  - A manage token (30 days, hashed, rotated) is only issued after the code
 *    verifies — payment remains available even inside the 48-hour change cutoff.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "otp", 20, 10 * 60 * 1000)) {
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
  if (await isRateLimitedShared(`otp-action:${action}:${email.trim().toLowerCase()}`, action === "send" ? 5 : 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please wait and try again." },
      { status: 429 },
    );
  }
  const genericSend = (options: { expiresAt?: string; retryAfterSeconds: number; sendLimitReason?: "cooldown" | "daily_limit" }) => ({
    ok: true,
    message: `If a booking or package purchase exists for that email, a code has been sent or may still be active. A code is valid for ${OTP_TTL_MIN} minutes.`,
    retryAfterSeconds: options.retryAfterSeconds,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.sendLimitReason ? { sendLimitReason: options.sendLimitReason } : {}),
  });

  let failureStage = "store_initialization";
  try {
    const store = getStore();

    if (action === "send") {
      // Apply the same per-address quota before checking eligibility. Keep the
      // response generic regardless of whether an eligible record is found.
      failureStage = "send_quota";
      const quota = await store.consumeOtpSendQuota(email, new Date().toISOString());
      if (!quota.allowed) {
        console.info("[otp] verification request was suppressed by the send quota");
        const retryAfterSeconds = quota.retryAfterSeconds;
        if (quota.reason === "daily_limit") {
          // The daily limit is only reachable after the prior ten-minute code
          // has expired. Do not present the daily wait as OTP validity.
          return NextResponse.json(genericSend({ retryAfterSeconds, sendLimitReason: "daily_limit" }));
        }
        const expiresAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
        return NextResponse.json(genericSend({ expiresAt, retryAfterSeconds, sendLimitReason: "cooldown" }));
      }

      failureStage = "eligible_booking_lookup";
      const found = await store.findBookingsByEmail(email);
      const purchases = await store.findPackagePurchasesByEmail(email);
      if (found.length === 0 && purchases.length === 0) {
        // Keep the response shape and apparent cooldown the same without
        // persisting a code or sending mail for an unknown email.
        return NextResponse.json(genericSend({
          expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString(),
          retryAfterSeconds: OTP_TTL_MIN * 60,
        }));
      }
      // Email ownership also grants access to historical bookings, so a past
      // or closed lesson can still be shown as expired with tutor contact info.
      const target = found[0];
      const purchaseTarget = purchases[0];
      failureStage = "otp_hash_generation";
      const otp = generateOtpCode();
      const expiresAt = otpExpiry();
      const otpHash = hashOtp(email, otp);
      failureStage = "otp_storage";
      await store.putOtp(email, otpHash, expiresAt);
      failureStage = "email_delivery";
      const sent = await sendBookingOtpEmail({
        studentName: target?.studentName ?? purchaseTarget?.studentName ?? "there",
        studentEmail: target?.email ?? purchaseTarget?.email ?? email,
        code: otp,
      });
      if (!sent) {
        console.error("[otp] verification email was not delivered; check Resend sender/domain settings");
      } else {
        console.info("[otp] verification email accepted by the configured provider");
      }
      return NextResponse.json(genericSend({ expiresAt, retryAfterSeconds: OTP_TTL_MIN * 60 }));
    }

    // verify / token both require the code.
    // OTP verification proves inbox ownership, but does not consume the code:
    // returning users can reuse it for the rest of its 10-minute lifetime.
    failureStage = "otp_verification";
    const verification = await store.verifyOtp(email, hashOtp(email, code ?? ""));
    if (!verification.ok) {
      const message =
        verification.reason === "locked"
          ? "Too many wrong attempts. Send a new code."
          : verification.reason === "expired"
            ? "That code has expired. Send a new one."
            : "That code doesn't match.";
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    failureStage = "verified_booking_lookup";
    const found = await store.findBookingsByEmail(email);
    const purchases = await store.findPackagePurchasesByEmail(email);

    if (action === "verify") {
      return NextResponse.json({
        ok: true,
        bookings: found.map((booking) => safeListItem(booking)),
        purchases: purchases.map(safePurchaseListItem),
        studentName: found[0]?.studentName ?? purchases[0]?.studentName ?? null,
      });
    }

    // action === "token"
    failureStage = "manage_token_issue";
    const wanted = reference?.toUpperCase();
    let target = wanted
      ? found.find((b) => b.reference === wanted)
      : found.find((b) => b.status === "pending_payment" || b.status === "confirmed" || b.status === "rescheduled") ?? found[0];
    const purchaseTarget = wanted
      ? purchases.find((purchase) => purchase.reference === wanted)
      : purchases.find((purchase) => purchase.paymentStatus === "paid" && purchase.creditsAvailable > 0) ?? purchases[0];
    if (!target && purchaseTarget) {
      const purchaseBookings = await store.findBookingsByPurchaseId(purchaseTarget.id);
      target = purchaseBookings.find((booking) => ["pending_payment", "confirmed", "rescheduled"].includes(booking.status)) ?? purchaseBookings[0];
    }
    if (!target && !purchaseTarget) {
      return NextResponse.json(
        { ok: false, error: "That booking could not be found for this email." },
        { status: 404 },
      );
    }
    const token = target
      ? await store.issueManageToken(target.id)
      : await store.issuePackagePurchaseManageToken(purchaseTarget!.id);
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
    console.error("[otp] failed at stage", failureStage);
    logSafeError("[otp] failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not process the request. Please try again." },
      { status: 500 },
    );
  }
}

function safeListItem(booking: BookingRecord): {
  studentName: string;
  reference: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  status: BookingRecord["status"];
  paymentStatus: BookingRecord["paymentStatus"];
  canOpen: boolean;
} {
  return {
    studentName: booking.studentName,
    reference: booking.reference,
    lessonName: booking.lessonName,
    durationMin: booking.durationMin,
    priceCad: booking.priceCad,
    startsAt: booking.startsAt,
    status: booking.status,
    paymentStatus: booking.paymentStatus ?? "due",
    canOpen: booking.status === "pending_payment" || booking.status === "confirmed" || booking.status === "rescheduled",
  };
}

function safePurchaseListItem(purchase: PackagePurchaseRecord) {
  return {
    studentName: purchase.studentName,
    reference: purchase.reference,
    lessonName: purchase.lessonName,
    creditsPurchased: purchase.creditsPurchased,
    creditsAvailable: purchase.creditsAvailable,
    paymentStatus: purchase.paymentStatus,
    purchasedAt: purchase.purchasedAt,
    validUntil: purchase.validUntil,
    canOpen: purchase.paymentStatus === "paid" || purchase.paymentStatus === "pending",
  };
}
