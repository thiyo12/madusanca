import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { getStripe } from "@/lib/stripe/server";
import { recordPaidCheckoutSession, recordPaidUpgradeCheckoutSession } from "@/lib/stripe/fulfill";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    const result = await readBoundedBody(request, 1_048_576);
    if (!result.ok) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
    event = getStripe().webhooks.constructEvent(result.text, signature, secret);
  } catch (error) {
    logSafeError("[stripe/webhook] signature verification failed", error);
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  const paidEvent =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded";
  const expiredEvent =
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed";
  if (!paidEvent && !expiredEvent) return NextResponse.json({ received: true });

  const session = event.data.object as Stripe.Checkout.Session;
  const isUpgrade = session.metadata?.checkout_kind === "package_upgrade";
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return NextResponse.json({ received: true });

  if (paidEvent && session.payment_status !== "paid") {
    // Some payment methods complete asynchronously; wait for the success event.
    return NextResponse.json({ received: true, awaitingPayment: true });
  }

  try {
    const store = getStore();
    if (paidEvent) {
      if (isUpgrade) await recordPaidUpgradeCheckoutSession(session, event.id);
      else await recordPaidCheckoutSession(session, event.id);
    } else {
      const expired = {
        eventId: event.id,
        eventType: "expired",
        bookingId,
        sessionId: session.id,
      } as const;
      if (isUpgrade) {
        const booking = await store.getBookingByUpgradeCheckoutSession(session.id);
        if (booking?.stripeUpgradeTargetLessonId && booking.stripeUpgradeTargetLessonName && booking.stripeUpgradeTargetDurationMin && booking.stripeUpgradeTargetPriceCad !== undefined && booking.stripeUpgradeFromPriceCad !== undefined) {
          await store.handleStripeUpgradeCheckoutEvent({ ...expired, ...{
            targetLessonId: booking.stripeUpgradeTargetLessonId,
            targetLessonName: booking.stripeUpgradeTargetLessonName,
            targetDurationMin: booking.stripeUpgradeTargetDurationMin,
            targetPriceCad: booking.stripeUpgradeTargetPriceCad,
            fromPriceCad: booking.stripeUpgradeFromPriceCad,
          } });
        }
      } else await store.handleStripeCheckoutEvent(expired);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    logSafeError("[stripe/webhook] event processing failed", error);
    return NextResponse.json({ error: "Could not process Stripe event." }, { status: 500 });
  }
}
