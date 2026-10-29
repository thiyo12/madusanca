import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { getStripe } from "@/lib/stripe/server";
import { recordPaidCheckoutSession } from "@/lib/stripe/fulfill";
import { readBoundedBody } from "@/lib/server/read-bounded-body";

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
    console.error("[stripe/webhook] signature verification failed", error);
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
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return NextResponse.json({ received: true });

  if (paidEvent && session.payment_status !== "paid") {
    // Some payment methods complete asynchronously; wait for the success event.
    return NextResponse.json({ received: true, awaitingPayment: true });
  }

  try {
    const store = getStore();
    if (paidEvent) {
      await recordPaidCheckoutSession(session, event.id);
    } else {
      await store.handleStripeCheckoutEvent({
        eventId: event.id,
        eventType: "expired",
        bookingId,
        sessionId: session.id,
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe/webhook] event processing failed", error);
    return NextResponse.json({ error: "Could not process Stripe event." }, { status: 500 });
  }
}
