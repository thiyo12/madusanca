"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { dayKeyOf } from "@/lib/booking/format";
import type { BookingRecord } from "@/lib/booking/types";
import { validateSlot } from "@/lib/booking/slots";
import { manageUrl, siteBase } from "@/lib/booking/urls";
import { getStripe } from "@/lib/stripe/server";
import {
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "@/lib/email/booking-emails";
import { logSafeError } from "@/lib/server/safe-log";
import { isoDateTimeSchema } from "@/lib/validation/booking";

const idSchema = z.string().min(1).max(64);
const statusSchema = z.enum(["confirmed", "completed", "cancelled", "no_show"]);
const paymentStatusSchema = z.literal("paid");
const chequeStatusSchema = z.enum(["none", "received", "cleared", "returned"]);

function revalidateAdmin(): void {
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/payments");
  revalidatePath("/admin");
}

function fail(message: string): never {
  failAt("/admin/bookings", message);
}

function failAt(path: "/admin/bookings" | "/admin/payments", message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function setBookingStatusAction(
  bookingId: string,
  status: z.infer<typeof statusSchema>,
): Promise<void> {
  await requireAdmin("/admin/bookings");
  if (!idSchema.safeParse(bookingId).success || !statusSchema.safeParse(status).success) {
    fail("Invalid request.");
  }

  const store = getStore();
  const booking = await store.getBookingById(bookingId);
  if (!booking) fail("Booking not found.");

  if (status === "no_show" && Date.parse(booking.startsAt) > Date.now()) {
    fail("A lesson can only be marked no-show after its scheduled start time.");
  }

  if (status === "cancelled" || status === "completed") {
    const sameEmailBookings = await store.listBookings({ search: booking.email });
    const packageId = booking.packageId ?? booking.id;
    const packageSessions = sameEmailBookings.filter((item) => (item.packageId ?? item.id) === packageId);
    if (status === "cancelled" && packageSessions.some((item) => item.paymentStatus === "paid")) {
      fail("This package has been paid. Reconcile cancellation or refund in Stripe before changing it.");
    }
    const checkoutOwner = packageSessions.find((item) => item.stripeCheckoutSessionId) ?? booking;
    const upgradeOwner = packageSessions.find((item) => item.stripeUpgradeCheckoutSessionId);
    if (packageSessions.some((item) => item.paymentStatus === "due")) await expireOpenCheckout(checkoutOwner);
    if (upgradeOwner) await expireOpenUpgradeCheckout(upgradeOwner);
  }

  const result = await store.updateBookingStatus(bookingId, status);
  if (!result.ok) {
    fail(
      result.error === "not_modifiable"
        ? "This booking is closed and can no longer change."
        : "Could not update the booking.",
    );
  }

  if (status === "cancelled") {
    try {
      await sendBookingCancelledEmail({
        reference: booking.reference,
        lessonName: booking.lessonName,
        durationMin: booking.durationMin,
        startsAt: booking.startsAt,
        studentName: booking.studentName,
        studentEmail: booking.email,
        manageUrl: siteBase(),
      });
    } catch (error) {
      logSafeError("[admin] cancel email failed", error);
    }
  }

  revalidateAdmin();
}

export async function setBookingPaymentAction(
  bookingId: string,
  paymentStatus: z.infer<typeof paymentStatusSchema>,
  returnTo: "/admin/bookings" | "/admin/payments" = "/admin/bookings",
): Promise<void> {
  const safeReturnTo = returnTo === "/admin/payments" ? "/admin/payments" : "/admin/bookings";
  await requireAdmin(safeReturnTo);
  const paymentFail = (message: string): never => redirect(`${safeReturnTo}?error=${encodeURIComponent(message)}`);
  if (!idSchema.safeParse(bookingId).success || !paymentStatusSchema.safeParse(paymentStatus).success) {
    paymentFail("Invalid request.");
  }

  const store = getStore();
  const booking = await store.getBookingById(bookingId);
  if (!booking) return paymentFail("Booking not found.");

  if (booking.paymentStatus !== "due") paymentFail("Only bookings with payment due can be marked paid by cash.");

  if (booking.stripePaymentIntentId) {
    try {
      const stripe = getStripe();
      const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
      if (intent.status === "succeeded" || intent.status === "processing") {
        paymentFail("Stripe shows a successful or processing card payment. This booking cannot be marked paid by cash.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
      logSafeError("[admin/payments] Stripe reconciliation failed", error);
      paymentFail("Could not verify the Stripe payment. Try again later.");
    }
  }

  const sameEmailBookings = await store.listBookings({ search: booking.email });
  const packageId = booking.packageId ?? booking.id;
  const checkoutOwner = sameEmailBookings.find((item) =>
    (item.packageId ?? item.id) === packageId && item.stripeCheckoutSessionId,
  ) ?? booking;
  await expireOpenCheckout(checkoutOwner, safeReturnTo);

  const result = await store.updatePaymentStatus(bookingId, paymentStatus);
  if (!result.ok) {
    paymentFail(result.error === "not_found"
      ? "Booking not found."
      : "The booking hold expired and at least one reserved time is no longer available. Reschedule the booking or package into an available time first; then mark it paid.");
  }

  revalidateAdmin();
}

export async function updateBookingChequeAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/payments");
  const parsed = z.object({ bookingId: idSchema, status: chequeStatusSchema, reference: z.string().trim().max(80) }).safeParse({ bookingId: formData.get("bookingId"), status: formData.get("status"), reference: formData.get("reference") });
  if (!parsed.success) redirect("/admin/payments?error=Invalid+cheque+details.");
  const store = getStore();
  const booking = await store.getBookingById(parsed.data.bookingId);
  if (!booking) redirect("/admin/payments?error=Booking+not+found.");
  if (booking.stripePaymentIntentId && booking.paymentStatus === "paid" && parsed.data.status !== "none") {
    redirect("/admin/payments?error=This+booking+is+already+paid+through+Stripe.");
  }
  if ((parsed.data.status === "received" || parsed.data.status === "cleared") && booking.paymentStatus === "due") {
    const sameEmailBookings = await store.listBookings({ search: booking.email });
    const checkoutOwner = sameEmailBookings.find((item) => (item.packageId ?? item.id) === (booking.packageId ?? booking.id) && item.stripeCheckoutSessionId);
    if (checkoutOwner) await expireOpenCheckout(checkoutOwner, "/admin/payments");
  }
  const result = await store.updateBookingCheque(booking.id, parsed.data.status, parsed.data.reference);
  if (!result.ok) redirect("/admin/payments?error=Could+not+update+cheque+tracking.");
  revalidatePath("/admin/payments");
  revalidateAdmin();
}

export async function updatePackageChequeAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/payments");
  const parsed = z.object({ purchaseId: z.uuid(), status: chequeStatusSchema, reference: z.string().trim().max(80) }).safeParse({ purchaseId: formData.get("purchaseId"), status: formData.get("status"), reference: formData.get("reference") });
  if (!parsed.success) redirect("/admin/payments?error=Invalid+cheque+details.");
  const store = getStore();
  const purchase = await store.getPackagePurchaseById(parsed.data.purchaseId);
  if (!purchase) redirect("/admin/payments?error=Package+purchase+not+found.");
  if (purchase.stripePaymentIntentId && purchase.paymentStatus === "paid" && status !== "none") {
    redirect("/admin/payments?error=This+purchase+is+already+paid+through+Stripe.");
  }
  if ((parsed.data.status === "received" || parsed.data.status === "cleared") && purchase.paymentStatus === "pending" && purchase.stripeCheckoutSessionId) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(purchase.stripeCheckoutSessionId);
      if (session.status === "complete") redirect("/admin/payments?error=Stripe+Checkout+is+complete+or+processing.+Verify+it+before+recording+a+cheque.");
      if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
      await store.handleStripePackagePurchaseEvent({
        eventId: `admin-cheque-expire-${session.id}`,
        eventType: "expired",
        purchaseId: purchase.id,
        sessionId: session.id,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
      logSafeError("[admin/payments] package Checkout expiry failed", error);
      redirect("/admin/payments?error=Could+not+verify+or+close+the+Stripe+Checkout+session.");
    }
  }
  const result = await store.updatePackagePurchaseCheque(purchase.id, parsed.data.status, parsed.data.reference);
  if (!result.ok) redirect("/admin/payments?error=Could+not+update+package+cheque+tracking.");
  revalidatePath("/admin/payments");
}

async function expireOpenCheckout(booking: BookingRecord, returnTo: "/admin/bookings" | "/admin/payments" = "/admin/bookings"): Promise<void> {
  if (!booking.stripeCheckoutSessionId) return;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(booking.stripeCheckoutSessionId);
    if (session.status === "complete") {
      failAt(returnTo, session.payment_status === "paid"
        ? "This booking has a completed Stripe payment. Reconcile the payment before cancelling."
        : "Stripe shows this Checkout is complete and payment may be processing. Verify it before changing the booking.");
    }
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    await getStore().handleStripeCheckoutEvent({
      eventId: `admin-change-expire-${session.id}`,
      eventType: "expired",
      bookingId: booking.id,
      sessionId: session.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
    logSafeError("[admin/bookings] checkout expiry failed", error);
    failAt(returnTo, "Could not verify or close the Stripe Checkout session. Try again.");
  }
}

async function expireOpenUpgradeCheckout(booking: BookingRecord): Promise<void> {
  const sessionId = booking.stripeUpgradeCheckoutSessionId;
  if (!sessionId) return;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") {
      fail("An upgrade payment is complete or processing. Verify it in Stripe before changing the booking.");
    }
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    if (
      !booking.stripeUpgradeTargetLessonId || !booking.stripeUpgradeTargetLessonName ||
      !booking.stripeUpgradeTargetDurationMin || booking.stripeUpgradeTargetPriceCad === undefined ||
      booking.stripeUpgradeFromPriceCad === undefined
    ) throw new Error("Stored package upgrade details are incomplete.");
    await getStore().handleStripeUpgradeCheckoutEvent({
      eventId: `admin-change-upgrade-expire-${session.id}`,
      eventType: "expired",
      bookingId: booking.id,
      sessionId: session.id,
      targetLessonId: booking.stripeUpgradeTargetLessonId,
      targetLessonName: booking.stripeUpgradeTargetLessonName,
      targetDurationMin: booking.stripeUpgradeTargetDurationMin,
      targetPriceCad: booking.stripeUpgradeTargetPriceCad,
      fromPriceCad: booking.stripeUpgradeFromPriceCad,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
    logSafeError("[admin/bookings] upgrade checkout expiry failed", error);
    fail("Could not verify or close the upgrade Checkout session. Try again.");
  }
}

export interface RescheduleState {
  error: string | null;
}

const rescheduleSchema = z.object({
  bookingId: z.string().min(1).max(64),
  startsAt: isoDateTimeSchema,
}).strict();

export async function rescheduleBookingAction(
  _prevState: RescheduleState,
  formData: FormData,
): Promise<RescheduleState> {
  await requireAdmin("/admin/bookings");

  const parsed = rescheduleSchema.safeParse({
    bookingId: formData.get("bookingId"),
    startsAt: formData.get("startsAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose a new time." };
  }

  const store = getStore();
  const booking = await store.getBookingById(parsed.data.bookingId);
  if (!booking) return { error: "Booking not found." };
  try {
    await expireOpenCheckout(booking);
    await expireOpenUpgradeCheckout(booking);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
    logSafeError("[admin/bookings] reschedule payment check failed", error);
    return { error: "Could not verify or close the Stripe Checkout session. Try again." };
  }

  const startMs = Date.parse(parsed.data.startsAt);
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + booking.durationMin * 60000).toISOString();
  const previousStartsAt = booking.startsAt;

  const dayKey = dayKeyOf(startsAt);
  const [rules, blackouts, busy, dateOverrides] = await Promise.all([
    store.getRules(),
    store.getBlackouts(),
    store.getBusy(
      new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
      new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
    ),
    store.getDateOverrides(dayKey, dayKey),
  ]);
  const otherBusy = busy.filter(
    (interval) => interval.startsAt !== booking.startsAt,
  );
  const validation = validateSlot(startsAt, {
    lessonDurationMin: booking.durationMin,
    busy: otherBusy,
    blackouts,
    rules,
    dateOverrides,
    now: new Date(),
  });
  if (!validation.valid) {
    return {
      error: validation.reason === "occupied"
        ? "That time is already taken — pick another slot."
        : "That time is no longer inside the available schedule. Choose another slot.",
    };
  }

  const result = await store.adminRescheduleBooking(booking.id, startsAt, endsAt);
  if (!result.ok) {
    return {
      error:
        result.error === "conflict"
          ? "That time is already taken — pick another slot."
          : result.error === "not_modifiable"
            ? "This booking is closed and can no longer change."
            : "Could not reschedule the booking.",
    };
  }

  // Supabase rotates the student's manage link — send them the fresh one.
  if (result.value.newToken) {
    try {
      const emailSent = await sendBookingRescheduledEmail({
        reference: result.value.booking.reference,
        lessonName: result.value.booking.lessonName,
        durationMin: result.value.booking.durationMin,
        startsAt: result.value.booking.startsAt,
        previousStartsAt,
        studentName: result.value.booking.studentName,
        studentEmail: result.value.booking.email,
        manageUrl: manageUrl(),
      });
      if (!emailSent) console.error("[admin] reschedule notification was not delivered");
    } catch (error) {
      logSafeError("[admin] reschedule email failed", error);
    }
  }

  revalidateAdmin();
  return { error: null };
}
