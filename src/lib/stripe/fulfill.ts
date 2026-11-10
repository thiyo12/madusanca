import "server-only";

import type Stripe from "stripe";
import { getStore } from "@/lib/booking/store";
import { getStripe } from "@/lib/stripe/server";
import { manageUrl } from "@/lib/booking/urls";
import { sendBookingPaymentReceivedEmail, sendPackagePurchasePaidEmail } from "@/lib/email/booking-emails";
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
  const store = getStore();
  const booking = await store.getBookingByCheckoutSession(session.id);
  if (!booking || booking.id !== bookingId) {
    throw new Error("Stripe Checkout session does not match the stored booking payment.");
  }
  const addons = await store.getBookingCheckoutAddons(booking.id, session.id);
  const addonAmountCad = addons.reduce((sum, addon) => sum + addon.amountCad, 0);
  if (!matchesInitialBookingPayment(session, booking, addonAmountCad)) {
    throw new Error("Stripe Checkout session does not match the stored booking and add-on payment.");
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

  const shouldNotifyPayment = booking.paymentStatus !== "paid";
  await store.handleStripeCheckoutEvent({
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
  if (shouldNotifyPayment) {
    try {
      await sendBookingPaymentReceivedEmail({
        reference: booking.reference,
        lessonName: booking.lessonName,
        durationMin: booking.durationMin,
        startsAt: booking.startsAt,
        studentName: booking.studentName,
        studentEmail: booking.email,
        manageUrl: manageUrl(),
        invoiceUrl,
      });
      for (const addon of addons) {
        if (addon.paymentStatus !== "pending") continue;
        await sendPackagePurchasePaidEmail({
          reference: addon.reference,
          lessonName: addon.lessonName,
          creditsPurchased: addon.creditsPurchased,
          amountCad: addon.amountCad,
          studentName: addon.studentName,
          studentEmail: addon.email,
          manageUrl: manageUrl(),
          invoiceUrl,
        });
      }
    } catch (error) {
      console.error("[stripe] payment confirmation email failed", error instanceof Error ? error.name : "UnknownError");
    }
  }
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

export async function recordPaidPackagePurchaseCheckoutSession(
  session: Stripe.Checkout.Session,
  eventId: string,
  paidAt: Date,
): Promise<void> {
  const purchaseId = session.metadata?.purchase_id;
  const bundle = session.metadata?.checkout_kind === "package_purchase_bundle";
  if (session.payment_status !== "paid" || (!bundle && session.metadata?.checkout_kind !== "package_purchase") || !purchaseId) return;
  const store = getStore();
  const purchases = bundle
    ? await store.getPackagePurchasesByCheckoutSession(session.id)
    : [await store.getPackagePurchaseByCheckoutSession(session.id)].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const ids = (session.metadata?.purchase_ids ?? purchaseId).split(",").filter(Boolean).sort();
  const actualIds = purchases.map((item) => item.id).sort();
  const expectedSubtotal = Math.round(purchases.reduce((sum, item) => sum + item.amountCad, 0) * 100);
  if (!purchases.length || !ids.includes(purchaseId) || actualIds.join(",") !== ids.join(",") ||
      (session.amount_subtotal ?? -1) !== expectedSubtotal || purchases.some((purchase) =>
        purchase.stripeCheckoutSessionId !== session.id || purchase.currency.toLowerCase() !== "cad" || purchase.source !== "new"
      )) {
    throw new Error("Stripe Checkout session does not match the stored package purchase.");
  }

  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  let invoiceUrl = typeof session.invoice === "object" ? session.invoice?.hosted_invoice_url ?? undefined : undefined;
  if (invoiceId && !invoiceUrl) {
    try { invoiceUrl = (await getStripe().invoices.retrieve(invoiceId)).hosted_invoice_url ?? undefined; }
    catch (error) { console.error("[stripe] package purchase invoice lookup failed", error instanceof Error ? error.name : "unknown error"); }
  }

  const aggregateTax = session.total_details?.amount_tax ?? 0;
  const totalBaseCents = purchases.reduce((sum, item) => sum + Math.round(item.amountCad * 100), 0);
  let taxAllocated = 0;
  for (const [index, purchase] of purchases.entries()) {
    const wasPending = purchase.paymentStatus === "pending";
    const itemSubtotal = Math.round(purchase.amountCad * 100);
    const itemTax = index === purchases.length - 1
      ? aggregateTax - taxAllocated
      : Math.floor(aggregateTax * itemSubtotal / totalBaseCents);
    taxAllocated += itemTax;
    if (wasPending) await store.handleStripePackagePurchaseEvent({
      eventId: purchases.length === 1 ? eventId : `${eventId}:${index + 1}`,
      eventType: "paid",
      purchaseId: purchase.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      invoiceId,
      invoiceUrl,
      subtotalCents: itemSubtotal,
      taxCents: itemTax,
      totalCents: itemSubtotal + itemTax,
      currency: session.currency ?? undefined,
      paidAt: paidAt.toISOString(),
    });
    if (wasPending) {
    try {
      await sendPackagePurchasePaidEmail({
        reference: purchase.reference,
        lessonName: purchase.lessonName,
        creditsPurchased: purchase.creditsPurchased,
        amountCad: purchase.amountCad,
        studentName: purchase.studentName,
        studentEmail: purchase.email,
        manageUrl: manageUrl(),
        invoiceUrl,
      });
    } catch (error) {
      console.error("[stripe] package payment confirmation email failed", error instanceof Error ? error.name : "UnknownError");
    }
    }
  }
}
