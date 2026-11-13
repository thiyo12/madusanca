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
import type { BookingRecord, BookingStore, PackagePurchaseRecord } from "@/lib/booking/types";
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
const ADDON_SOURCE_PREFIX = "Added from My Booking ";

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
    isAdditionalPackage: booking.notes.startsWith(ADDON_SOURCE_PREFIX),
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

function addonSourceReference(purchase: PackagePurchaseRecord | null | undefined): string | null {
  return purchase?.notes.startsWith(ADDON_SOURCE_PREFIX)
    ? purchase.notes.slice(ADDON_SOURCE_PREFIX.length).trim()
    : null;
}

function packageGroupId(booking: BookingRecord): string {
  return booking.packageId ?? booking.id;
}

/**
 * My Booking add-ons are separate package groups. Rejoin only purchases whose
 * stored source note points at this exact booking reference, so an email that
 * owns unrelated bookings does not accidentally merge them into this view.
 */
async function loadManageContext(
  store: BookingStore,
  seedBooking: BookingRecord | null,
  seedPurchase: PackagePurchaseRecord | null,
): Promise<{ booking: BookingRecord | null; sessions: BookingRecord[]; purchase: PackagePurchaseRecord | null }> {
  const email = seedBooking?.email ?? seedPurchase?.email;
  if (!email) return { booking: seedBooking, sessions: seedBooking ? [seedBooking] : [], purchase: seedPurchase };

  const [allBookings, purchases] = await Promise.all([
    store.findBookingsByEmail(email),
    store.findPackagePurchasesByEmail(email),
  ]);
  const originReference = addonSourceReference(seedPurchase) ?? seedBooking?.reference ?? null;
  const originRecord = originReference
    ? allBookings.find((item) => item.reference === originReference) ?? null
    : null;
  const primaryCandidate = originRecord ?? seedBooking;
  const primaryGroup = primaryCandidate
    ? allBookings.filter((item) => packageGroupId(item) === packageGroupId(primaryCandidate))
    : [];
  const booking = primaryGroup.find((item) => (item.sessionIndex ?? 1) === 1) ?? primaryCandidate;

  const linkedPurchases = originReference
    ? purchases.filter((item) => item.notes === `${ADDON_SOURCE_PREFIX}${originReference}` && !["failed", "refunded"].includes(item.paymentStatus))
    : [];
  if (seedPurchase && !linkedPurchases.some((item) => item.id === seedPurchase.id)) linkedPurchases.push(seedPurchase);

  const linkedSessions = (await Promise.all(linkedPurchases.map((item) => store.findBookingsByPurchaseId(item.id)))).flat();
  const combined = new Map<string, BookingRecord>();
  for (const item of [...primaryGroup, ...linkedSessions, ...(seedBooking ? [seedBooking] : [])]) combined.set(item.id, item);
  const sessions = [...combined.values()].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

  const primaryPurchaseId = booking?.purchaseId;
  const purchase = primaryPurchaseId
    ? await store.getPackagePurchaseById(primaryPurchaseId)
    : seedPurchase;
  return { booking, sessions, purchase };
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
          const seedBooking = purchaseBookings.find((session) => (session.sessionIndex ?? 1) === 1) ?? purchaseBookings[0] ?? null;
          const context = await loadManageContext(getStore(), seedBooking, purchase);
          const activePaidSessions = context.sessions.filter((session) =>
            ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid" && Date.parse(session.startsAt) > Date.now(),
          );
          const addOnOptions = activePaidSessions.length > 0
            ? (await getStore().getLessons()).filter((lesson) => lesson.category === "package")
              .map(({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }) => ({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }))
            : [];
          const activeBookingRecord = context.booking ?? activePaidSessions[0] ?? seedBooking;
          return NextResponse.json({
            ok: true,
            ...(context.purchase ? { purchase: safePurchaseView(context.purchase) } : {}),
            ...(activeBookingRecord ? { booking: { ...safeView(activeBookingRecord), addOnOptions } } : {}),
            sessions: context.sessions.map(safeView),
          });
        }
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      const purchaseId = found.booking.purchaseId ?? found.sessions.find((session) => session.purchaseId)?.purchaseId;
      const linkedPurchase = purchaseId ? await getStore().getPackagePurchaseById(purchaseId) : null;
      const context = await loadManageContext(getStore(), found.booking, linkedPurchase);
      const activePaidSessions = context.sessions.filter((session) => ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid" && Date.parse(session.startsAt) > Date.now());
      // Add-ons reserve their own future lesson times, so do not hide the
      // option just because an existing lesson is inside the 48-hour cutoff.
      const canAddPackage = activePaidSessions.length > 0;
      const packages = canAddPackage ? (await getStore().getLessons()).filter((lesson) => lesson.category === "package") : [];
      return NextResponse.json({
        ok: true,
        booking: {
          ...safeView(context.booking ?? found.booking),
          addOnOptions: canAddPackage ? packages.map(({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category }) => ({ id, name, priceCad, durationMin, sessionCount, description, features, icon, popular, category })) : [],
        },
        sessions: context.sessions.map(safeView),
        ...(context.purchase ? { purchase: safePurchaseView(context.purchase) } : {}),
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
    const tokenPurchase = found
      ? (found.booking.purchaseId ? await store.getPackagePurchaseById(found.booking.purchaseId) : null)
      : await store.getPackagePurchaseByToken(hash);
    const purchaseBookings = !found && tokenPurchase ? await store.findBookingsByPurchaseId(tokenPurchase.id) : [];
    const seedBooking = found?.booking ?? purchaseBookings.find((session) => (session.sessionIndex ?? 1) === 1) ?? purchaseBookings[0] ?? null;
    if (!seedBooking) {
      return errorResponse("not_found", "This booking link is invalid or has expired.");
    }
    const context = await loadManageContext(store, seedBooking, tokenPurchase);
    const targetBooking = context.sessions.find((session) => session.id === sessionId);
    if (!targetBooking) return errorResponse("not_found", "That lesson is not part of this My Booking group.");
    const targetGroupId = packageGroupId(targetBooking);
    const paymentBooking = context.sessions.find((session) => packageGroupId(session) === targetGroupId && session.stripeCheckoutSessionId) ?? targetBooking;
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
      (context.sessions.length > 1 && context.sessions.every((session) => session.paymentStatus === "paid"));
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
    const updatedPurchaseId = updated?.booking.purchaseId ?? result.value.purchaseId;
    const updatedPurchase = updatedPurchaseId ? await store.getPackagePurchaseById(updatedPurchaseId) : null;
    const updatedContext = await loadManageContext(store, updated?.booking ?? result.value, updatedPurchase);

    const response = NextResponse.json({
      ok: true,
      booking: safeView(updatedContext.booking ?? result.value),
      sessions: updatedContext.sessions.map(safeView),
      ...(updatedContext.purchase ? { purchase: safePurchaseView(updatedContext.purchase) } : {}),
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
