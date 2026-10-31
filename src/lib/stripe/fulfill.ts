import "server-only";

import type Stripe from "stripe";
import { getStore } from "@/lib/booking/store";
import { getStripe } from "@/lib/stripe/server";
import {
  matchesInitialBookingPayment,
  matchesUpgradeBookingPayment,
} from "@/lib/stripe/payment-validation";

/** Persist verified paid-session data; webhook event IDs make retries idempotent. */
export async function recordPaidCheckoutSession(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId || session.payment_status !== "paid") return;

  // Trust the stored booking/session relationship, not webhook-supplied metadata
  // alone. Stripe Tax is additive, so compare the pre-tax subtotal to our price.
  const booking = await getStore().getBookingByCheckoutSession(session.id);
  if (!booking || booking.id !== bookingId || !matchesInitialBookingPayment(session, booking)) {
    throw new Error("Stripe Checkout session does not match the stored booking payment.");
  }

  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  let invoiceUrl = typeof session.invoice === "object"
    ? session.invoice?.hosted_invoice_url ?? undefined
    : undefined;
  if (invoiceId && !invoiceUrl) {
    try {
      const invoice = await getStripe().invoices.retrieve(invoiceId);
      invoiceUrl = invoice.hosted_invoice_url ?? undefined;
    } catch (error) {
      // Invoice creation can lag behind Checkout completion; payment fulfillment
      // must still proceed, and the original Stripe invoice remains available.
      console.error("[stripe] invoice link lookup failed", error instanceof Error ? error.name : "unknown error");
    }
  }

  await getStore().handleStripeCheckoutEvent({
    eventId,
    eventType: "paid",
    bookingId,
    sessionId: session.id,
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id,
    invoiceId,
    invoiceUrl,
    subtotalCents: session.amount_subtotal ?? undefined,
    taxCents: session.total_details?.amount_tax ?? undefined,
    totalCents: session.amount_total ?? undefined,
    currency: session.currency ?? undefined,
  });
}

export async function recordPaidUpgradeCheckoutSession(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  const metadata = session.metadata;
  if (session.payment_status !== "paid" || metadata?.checkout_kind !== "package_upgrade") return;
  const bookingId = metadata.booking_id;
  const targetLessonId = metadata.target_lesson_id;
  const targetLessonName = metadata.target_lesson_name;
  const targetDurationMin = Number(metadata.target_duration_min);
  const targetPriceCad = Number(metadata.target_price_cad);
  const fromPriceCad = Number(metadata.from_price_cad);
  if (!bookingId || !targetLessonId || !targetLessonName || !Number.isInteger(targetDurationMin) || !Number.isFinite(targetPriceCad) || !Number.isFinite(fromPriceCad)) {
    throw new Error("Stripe upgrade session metadata is incomplete.");
  }
  const booking = await getStore().getBookingByUpgradeCheckoutSession(session.id);
  if (!booking || booking.id !== bookingId || !matchesUpgradeBookingPayment(session, booking)) {
    throw new Error("Stripe Checkout session does not match the stored package upgrade.");
  }
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  let invoiceUrl = typeof session.invoice === "object" ? session.invoice?.hosted_invoice_url ?? undefined : undefined;
  if (invoiceId && !invoiceUrl) {
    try { invoiceUrl = (await getStripe().invoices.retrieve(invoiceId)).hosted_invoice_url ?? undefined; }
    catch (error) { console.error("[stripe] upgrade invoice link lookup failed", error instanceof Error ? error.name : "unknown error"); }
  }
  await getStore().handleStripeUpgradeCheckoutEvent({
    eventId, eventType: "paid", bookingId, sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    invoiceId, invoiceUrl, subtotalCents: session.amount_subtotal ?? undefined,
    taxCents: session.total_details?.amount_tax ?? undefined, totalCents: session.amount_total ?? undefined,
    currency: session.currency ?? undefined, targetLessonId, targetLessonName,
    targetDurationMin, targetPriceCad, fromPriceCad,
  });
}
