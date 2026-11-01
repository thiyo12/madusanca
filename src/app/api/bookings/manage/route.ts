import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { validateSlot } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { manageSchema } from "@/lib/validation/booking";
import { maskEmail } from "@/lib/booking/format";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import {
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "@/lib/email/booking-emails";
import type { BookingRecord } from "@/lib/booking/types";
import { manageUrl as buildManageUrl, siteBase } from "@/lib/booking/urls";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { getStripe } from "@/lib/stripe/server";
import { getManageToken, MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { dayKeyOf } from "@/lib/booking/format";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8_192;

const ERROR_STATUS: Record<string, number> = {
  expired: 410,
  not_found: 404,
  not_modifiable: 409,
  conflict: 409,
  cutoff: 409,
  reschedule_limit: 409,
};

const SELF_SERVICE_CUTOFF_MS = 48 * 60 * 60 * 1000;

function isInsideSelfServiceWindow(startsAt: string): boolean {
  return Date.parse(startsAt) - Date.now() < SELF_SERVICE_CUTOFF_MS;
}

function errorResponse(error: string, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: ERROR_STATUS[error] ?? 400 },
  );
}

function safeView(booking: BookingRecord): {
  id: string;
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  emailMasked: string;
  status: string;
  studentRescheduleCount: number;
  paymentStatus: string;
  invoiceUrl?: string;
  sessionIndex: number;
  sessionCount: number;
  packagePriceCad: number;
  packageWindowStart: string;
} {
  return {
    id: booking.id,
    reference: booking.reference,
    lessonId: booking.lessonId,
    lessonName: booking.lessonName,
    durationMin: booking.durationMin,
    priceCad: booking.packagePriceCad ?? booking.priceCad,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    studentName: booking.studentName,
    emailMasked: maskEmail(booking.email),
    status: booking.status,
    studentRescheduleCount: booking.studentRescheduleCount ?? 0,
    paymentStatus: booking.paymentStatus ?? "due",
    invoiceUrl: booking.stripeInvoiceUrl,
    sessionIndex: booking.sessionIndex ?? 1,
    sessionCount: booking.sessionCount ?? 1,
    packagePriceCad: booking.packagePriceCad ?? booking.priceCad,
    packageWindowStart: booking.packageWindowStart ?? dayKeyOf(booking.startsAt),
  };
}

async function load(hash: string) {
  const store = getStore();
  return store.getBookingByToken(hash);
}

async function expireUpgradeCheckout(booking: BookingRecord): Promise<boolean> {
  const sessionId = booking.stripeUpgradeCheckoutSessionId;
  if (!sessionId) return false;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === "complete") return true;
  if (session.status === "open") await stripe.checkout.sessions.expire(session.id);

  if (
    !booking.stripeUpgradeTargetLessonId || !booking.stripeUpgradeTargetLessonName ||
    !booking.stripeUpgradeTargetDurationMin || booking.stripeUpgradeTargetPriceCad === undefined ||
    booking.stripeUpgradeFromPriceCad === undefined
  ) throw new Error("Stored package upgrade details are incomplete.");

  await getStore().handleStripeUpgradeCheckoutEvent({
    eventId: `customer-change-upgrade-expire-${session.id}`,
    eventType: "expired",
    bookingId: booking.id,
    sessionId: session.id,
    targetLessonId: booking.stripeUpgradeTargetLessonId,
    targetLessonName: booking.stripeUpgradeTargetLessonName,
    targetDurationMin: booking.stripeUpgradeTargetDurationMin,
    targetPriceCad: booking.stripeUpgradeTargetPriceCad,
    fromPriceCad: booking.stripeUpgradeFromPriceCad,
  });
  return false;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "manage", 15, 10 * 60 * 1000)) {
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

  const parsed = manageSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { action, startsAt, sessionId } = parsed.data;
  const token = await getManageToken();
  if (!token) return errorResponse("not_found", "Open the private booking link or verify your email to continue.");
  const hash = hashToken(token);
  if (await isRateLimitedShared(`manage-token:${hash}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  try {
    if (action === "get") {
      const found = await load(hash);
      if (!found) {
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      const currentPackagePrice = found.booking.packagePriceCad ?? found.booking.priceCad;
      const upgradeOptions = found.sessions.every((session) => ["confirmed", "rescheduled"].includes(session.status)) && found.booking.paymentStatus === "paid"
        ? (await getStore().getLessons()).filter((lesson) => lesson.category === "package" && lesson.priceCad > currentPackagePrice)
          .map(({ id, name, priceCad }) => ({ id, name, priceCad, balanceCad: Math.round((priceCad - currentPackagePrice) * 100) / 100 }))
        : [];
      return NextResponse.json({
        ok: true,
        booking: { ...safeView(found.booking), upgradeOptions },
        sessions: found.sessions.map(safeView),
      });
    }

    if (action === "cancel") {
      const store = getStore();
      const found = await load(hash);
      if (!found) {
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      const paymentBooking = found.sessions.find((session) => session.stripeCheckoutSessionId) ?? found.booking;
      if (found.sessions.every((session) => ["cancelled", "completed"].includes(session.status))) {
        return errorResponse("not_modifiable", "This booking can no longer be changed.");
      }
      if (found.sessions.some((session) => session.paymentStatus === "paid")) {
        return errorResponse("not_modifiable", "This package has been paid. Contact the school for cancellation or refund help.");
      }
      try {
        if (await expireUpgradeCheckout(paymentBooking)) {
          return errorResponse("not_modifiable", "An upgrade payment is complete or processing. Refresh the booking and try again.");
        }
      } catch (error) {
        logSafeError("[bookings/manage] upgrade cancellation check failed", error);
        return NextResponse.json({ ok: false, error: "Could not verify upgrade payment status. Please try again shortly." }, { status: 503 });
      }
      if (found.sessions.some((session) => isInsideSelfServiceWindow(session.startsAt))) {
        return errorResponse("cutoff", messageFor("cutoff"));
      }
      if (paymentBooking.stripeCheckoutSessionId) {
        try {
          const stripe = (await import("@/lib/stripe/server")).getStripe();
          const session = await stripe.checkout.sessions.retrieve(paymentBooking.stripeCheckoutSessionId);
          if (session.status === "complete") {
            return errorResponse("not_modifiable", session.payment_status === "paid"
              ? "This booking has already been paid. Contact the school for cancellation or refund help."
              : "Payment is still processing. Please try again after Stripe confirms its status.");
          }
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
          await store.handleStripeCheckoutEvent({
            eventId: `customer-cancel-expire-${session.id}`,
            eventType: "expired",
            bookingId: paymentBooking.id,
            sessionId: session.id,
          });
        } catch (error) {
          logSafeError("[bookings/manage] Checkout cancellation check failed", error);
          return NextResponse.json({ ok: false, error: "Could not verify payment status. Please try again shortly." }, { status: 503 });
        }
      }
      const result = await store.cancelBookingByToken(hash);
      if (!result.ok) {
        return errorResponse(result.error, messageFor(result.error));
      }
      const emailSent = await sendBookingCancelledEmail({
        reference: result.value.reference,
        lessonName: result.value.lessonName,
        durationMin: result.value.durationMin,
        startsAt: result.value.startsAt,
        studentName: result.value.studentName,
        studentEmail: result.value.email,
        manageUrl: siteBase(),
      });
      const updated = await store.getBookingByToken(hash);
      return NextResponse.json({
        ok: true,
        booking: safeView(result.value),
        sessions: updated?.sessions.map(safeView) ?? [safeView(result.value)],
        emailSent,
      });
    }

    // action === "reschedule"
    if (!startsAt) {
      return NextResponse.json(
        { ok: false, error: "Please choose a new time." },
        { status: 400 },
      );
    }

    const store = getStore();
    const found = await load(hash);
    if (!found) {
      return errorResponse("not_found", "This booking link is invalid or has expired.");
    }
    const targetBooking = found.sessions.find((session) => session.id === sessionId) ?? found.booking;
    const paymentBooking = found.sessions.find((session) => session.stripeCheckoutSessionId) ?? found.booking;
    if (targetBooking.status === "cancelled" || targetBooking.status === "completed") {
      return errorResponse("not_modifiable", "This booking can no longer be changed.");
    }
    try {
      if (await expireUpgradeCheckout(paymentBooking)) {
        return errorResponse("not_modifiable", "An upgrade payment is complete or processing. Refresh the booking and try again.");
      }
    } catch (error) {
      logSafeError("[bookings/manage] upgrade reschedule check failed", error);
      return NextResponse.json({ ok: false, error: "Could not verify upgrade payment status. Please try again shortly." }, { status: 503 });
    }
    if (isInsideSelfServiceWindow(targetBooking.startsAt)) {
      return errorResponse("cutoff", messageFor("cutoff"));
    }
    const paidMultiSessionPackage = found.sessions.length > 1 &&
      found.sessions.every((session) => session.paymentStatus === "paid");
    if (!paidMultiSessionPackage && paymentBooking.stripeCheckoutSessionId) {
      try {
        const stripe = (await import("@/lib/stripe/server")).getStripe();
        const session = await stripe.checkout.sessions.retrieve(paymentBooking.stripeCheckoutSessionId);
        if (session.status === "complete") {
          return errorResponse("not_modifiable", session.payment_status === "paid"
            ? "This booking has already been paid. Contact the school before rescheduling."
            : "Payment is still processing. Please try again after Stripe confirms its status.");
        }
        if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
        await store.handleStripeCheckoutEvent({
          eventId: `customer-reschedule-expire-${session.id}`,
          eventType: "expired",
          bookingId: paymentBooking.id,
          sessionId: session.id,
        });
      } catch (error) {
        logSafeError("[bookings/manage] Checkout reschedule check failed", error);
        return NextResponse.json({ ok: false, error: "Could not verify payment status. Please try again shortly." }, { status: 503 });
      }
    }

    // Use the duration stored on the booking — catalogue edits must not
    // retroactively change lessons already booked.
    const durationMin = targetBooking.durationMin;
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) {
      return NextResponse.json({ ok: false, error: "Invalid date." }, { status: 400 });
    }
    const endsAt = new Date(startMs + durationMin * 60000).toISOString();

    const now = new Date();
    const [rules, blackouts, busy] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      ),
    ]);
    // The customer's own current slot counts as free while rescheduling.
    const ownBusy = busy.filter(
      (interval) =>
        !(interval.startsAt === targetBooking.startsAt && interval.endsAt === targetBooking.endsAt),
    );

    const validation = validateSlot(new Date(startMs).toISOString(), {
      lessonDurationMin: durationMin,
      busy: ownBusy,
      blackouts,
      rules,
      now,
    });
    if (!validation.valid) {
      return NextResponse.json(
        {
          ok: false,
          error:
            validation.reason === "occupied"
              ? "That time was just taken. Please pick another slot."
              : "That time is no longer available. Please pick another slot.",
        },
        { status: 409 },
      );
    }

    const newToken = generateToken();
    const previousStartsAt = targetBooking.startsAt;
    const result = await store.reschedulePackageSessionByToken(hash, targetBooking.id, new Date(startMs).toISOString(), endsAt, {
      hash: hashToken(newToken),
      expiresAt: tokenExpiry(),
    });
    if (!result.ok) {
      return errorResponse(result.error, messageFor(result.error));
    }

    const manageUrl = buildManageUrl(newToken);
    const emailSent = await sendBookingRescheduledEmail({
      reference: result.value.reference,
      lessonName: result.value.lessonName,
      durationMin: result.value.durationMin,
      startsAt: result.value.startsAt,
      previousStartsAt,
      studentName: result.value.studentName,
      studentEmail: result.value.email,
      manageUrl,
    });
    const updated = await store.getBookingByToken(hashToken(newToken));

    const response = NextResponse.json({
      ok: true,
      booking: safeView(result.value),
      sessions: updated?.sessions.map(safeView) ?? [safeView(result.value)],
      emailSent,
    });
    response.cookies.set(MANAGE_COOKIE_NAME, newToken, manageCookieOptions);
    return response;
  } catch (error) {
    logSafeError("[bookings] manage failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not update the booking. Please try again." },
      { status: 500 },
    );
  }
}

function messageFor(error: string): string {
  switch (error) {
    case "expired":
      return "This booking link has expired. Please contact us to make changes.";
    case "not_modifiable":
      return "This booking can no longer be changed.";
    case "conflict":
      return "That time was just taken. Please pick another slot.";
    case "cutoff":
      return "Online changes close 48 hours before the lesson. Please call the school for help with this booking.";
    case "reschedule_limit":
      return "This booking has already been rescheduled twice online. Call Shan at +1 236-234-3229 for help.";
    default:
      return "This booking link is invalid or has expired.";
  }
}
