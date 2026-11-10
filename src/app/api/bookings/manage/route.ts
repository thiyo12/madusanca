import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { validateSlot } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { manageSchema } from "@/lib/validation/booking";
import { maskEmail } from "@/lib/booking/format";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import {
  sendBookingRescheduledEmail,
} from "@/lib/email/booking-emails";
import type { BookingRecord, PackagePurchaseRecord } from "@/lib/booking/types";
import { manageUrl as buildManageUrl } from "@/lib/booking/urls";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { getStripe } from "@/lib/stripe/server";
import { getManageToken, MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { dayKeyOf } from "@/lib/booking/format";
import { isInsideSelfServiceWindow } from "@/lib/booking/manage-policy";

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
  isAdditionalPackage: boolean;
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
    isAdditionalPackage: Boolean(booking.purchaseId),
  };
}

function safePurchaseView(purchase: PackagePurchaseRecord) {
  return {
    id: purchase.id,
    reference: purchase.reference,
    lessonId: purchase.lessonId,
    lessonName: purchase.lessonName,
    durationMin: purchase.durationMin,
    creditsPurchased: purchase.creditsPurchased,
    creditsAvailable: purchase.creditsAvailable,
    amountCad: purchase.amountCad,
    paymentStatus: purchase.paymentStatus,
    purchasedAt: purchase.purchasedAt,
    validUntil: purchase.validUntil,
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
  if (action === "cancel") {
    return NextResponse.json({
      ok: false,
      error: "Students cannot cancel sessions online. Please contact your driving instructor for help.",
    }, { status: 403 });
  }
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
        const purchase = await getStore().getPackagePurchaseByToken(hash);
        if (purchase) {
          const purchaseBookings = await getStore().findBookingsByPurchaseId(purchase.id);
          const activePaidSessions = purchaseBookings.filter((session) =>
            ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid" && Date.parse(session.startsAt) > Date.now(),
          );
          const addOnOptions = activePaidSessions.length > 0
            ? (await getStore().getLessons()).filter((lesson) => lesson.category === "package")
              .map(({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }) => ({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }))
            : [];
          const sessions = purchaseBookings.map(safeView);
          const activeBookingRecord = activePaidSessions[0] ?? purchaseBookings.find((session) => !["cancelled", "completed"].includes(session.status));
          return NextResponse.json({
            ok: true,
            purchase: safePurchaseView(purchase),
            ...(activeBookingRecord ? { booking: { ...safeView(activeBookingRecord), addOnOptions } } : {}),
            sessions,
          });
        }
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      const purchaseId = found.sessions.find((session) => session.purchaseId)?.purchaseId;
      const purchase = purchaseId ? await getStore().getPackagePurchaseById(purchaseId) : null;
      const activePaidSessions = found.sessions.filter((session) => ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid" && Date.parse(session.startsAt) > Date.now());
      // Add-ons reserve their own future lesson times, so do not hide the
      // option just because an existing lesson is inside the 48-hour cutoff.
      const canAddPackage = activePaidSessions.length > 0;
      const packages = canAddPackage ? (await getStore().getLessons()).filter((lesson) => lesson.category === "package") : [];
      return NextResponse.json({
        ok: true,
        booking: {
          ...safeView(found.booking),
          addOnOptions: canAddPackage ? packages.map(({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }) => ({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category })) : [],
        },
        sessions: found.sessions.map(safeView),
        ...(purchase ? { purchase: safePurchaseView(purchase) } : {}),
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
    if (["cancelled", "completed", "no_show"].includes(targetBooking.status) || Date.parse(targetBooking.startsAt) <= Date.now()) {
      return errorResponse("not_modifiable", "This lesson has expired or is closed. Please contact your tutor for help.");
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
    const paidBooking = targetBooking.paymentStatus === "paid" ||
      (found.sessions.length > 1 && found.sessions.every((session) => session.paymentStatus === "paid"));
    if (!paidBooking && paymentBooking.stripeCheckoutSessionId) {
      try {
        const stripe = (await import("@/lib/stripe/server")).getStripe();
        const session = await stripe.checkout.sessions.retrieve(paymentBooking.stripeCheckoutSessionId);
        if (session.status === "complete") {
          return errorResponse("not_modifiable", session.payment_status === "paid"
            ? "Payment is complete, but this booking has not been marked paid yet. Please refresh and try again."
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
    const dayKey = dayKeyOf(new Date(startMs).toISOString());
    const [rules, dateOverrides, blackouts, busy] = await Promise.all([
      store.getRules(),
      store.getDateOverrides(dayKey, dayKey),
      store.getBlackouts(),
      store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      ),
    ]);
    // The customer's own current slot counts as free while rescheduling.
    const ownBusy = busy.filter(
      (interval) => interval.startsAt !== targetBooking.startsAt,
    );

    const validation = validateSlot(new Date(startMs).toISOString(), {
      lessonDurationMin: durationMin,
      busy: ownBusy,
      blackouts,
      rules,
      dateOverrides,
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

    const manageUrl = buildManageUrl();
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
      return "This appointment is within 48 hours. Please contact your driving instructor to request a change.";
    case "reschedule_limit":
      return "This lesson has already used its one online reschedule. Call Shan at +1 236-234-3229 for help.";
    default:
      return "This booking link is invalid or has expired.";
  }
}
