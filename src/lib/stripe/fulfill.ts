import type Stripe from "stripe";
import { getStore } from "@/lib/booking/store";
import { getStripe } from "@/lib/stripe/server";

/** Persist verified paid-session data; webhook event IDs make retries idempotent. */
export async function recordPaidCheckoutSession(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId || session.payment_status !== "paid") return;

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
      console.error("[stripe] invoice link lookup failed", error);
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
