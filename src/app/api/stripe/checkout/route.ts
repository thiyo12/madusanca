import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { clientIp, isRateLimited } from "@/lib/server/rate-limit";
import { siteBase } from "@/lib/booking/urls";
import { recordPaidCheckoutSession } from "@/lib/stripe/fulfill";
import { getStripe, stripeTaxCode, stripeTaxReady } from "@/lib/stripe/server";
import { readBoundedBody } from "@/lib/server/read-bounded-body";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2_048;

const checkoutSchema = z.object({
  token: z.string().trim().min(32).max(128),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (isRateLimited(`stripe-checkout:${clientIp(request)}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many checkout attempts. Please try again shortly." },
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

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Open the private manage link for this booking." }, { status: 400 });
  }

  try {
    const store = getStore();
    const tokenHash = hashToken(parsed.data.token);
    let found = await store.getBookingByToken(tokenHash);
    if (!found) {
      return NextResponse.json({ ok: false, error: "This booking link is invalid or has expired." }, { status: 404 });
    }
    if (found.booking.status === "cancelled" || found.booking.status === "completed") {
      return NextResponse.json({ ok: false, error: "This booking cannot be paid online." }, { status: 409 });
    }
    if (found.booking.paymentStatus === "paid") {
      return NextResponse.json({ ok: true, paid: true, invoiceUrl: found.booking.stripeInvoiceUrl });
    }
    if (found.booking.paymentStatus !== "due") {
      return NextResponse.json({ ok: false, error: "There is no online payment due for this booking." }, { status: 409 });
    }
    const stripe = getStripe();
    if (found.booking.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(found.booking.stripeCheckoutSessionId);
      const sessionStillValid = !found.booking.stripeCheckoutExpiresAt ||
        Date.parse(found.booking.stripeCheckoutExpiresAt) > Date.now();
      if (existing.status === "open" && existing.url && sessionStillValid) {
        return NextResponse.json({ ok: true, url: existing.url });
      }
      if (existing.status === "open") {
        await stripe.checkout.sessions.expire(existing.id);
        await store.handleStripeCheckoutEvent({
          eventId: `expired-checkout-reconcile-${existing.id}`,
          eventType: "expired",
          bookingId: found.booking.id,
          sessionId: existing.id,
        });
        found = await store.getBookingByToken(tokenHash);
        if (!found) return NextResponse.json({ ok: false, error: "This booking link is invalid or has expired." }, { status: 404 });
      }
      if (existing.status === "complete") {
        if (existing.payment_status === "paid") {
          await recordPaidCheckoutSession(existing, `checkout-reconcile-${existing.id}`);
          return NextResponse.json({ ok: true, paid: true });
        }
        return NextResponse.json({
          ok: false,
          error: "Payment is still processing. Refresh your booking in a moment before trying again.",
        }, { status: 409 });
      }

      await store.handleStripeCheckoutEvent({
        eventId: `expired-checkout-refresh-${existing.id}`,
        eventType: "expired",
        bookingId: found.booking.id,
        sessionId: existing.id,
      });
      found = await store.getBookingByToken(tokenHash);
      if (!found) {
        return NextResponse.json({ ok: false, error: "This booking link is invalid or has expired." }, { status: 404 });
      }
    }

    if (
      found.booking.status === "pending_payment" &&
      found.booking.stripeCheckoutExpiresAt &&
      Date.parse(found.booking.stripeCheckoutExpiresAt) <= Date.now()
    ) {
      return NextResponse.json({
        ok: false,
        error: "This unpaid booking hold has expired. Please request a new booking time.",
      }, { status: 409 });
    }

    if (!await stripeTaxReady(stripe)) {
      return NextResponse.json({
        ok: false,
        error: "Stripe Tax is not active for Canada in this test environment yet. In Stripe Test mode, add your head-office address and Canadian GST registration under Tax settings, then try again.",
      }, { status: 503 });
    }

    const taxCode = stripeTaxCode();
    const checkoutExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: checkoutExpiresAt,
      submit_type: "book",
      customer_email: found.booking.email,
      customer_creation: "always",
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      payment_intent_data: {
        statement_descriptor: "WISDOM DRIVING",
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${found.booking.lessonName} · ${found.booking.reference}`,
          metadata: {
            booking_id: found.booking.id,
            booking_reference: found.booking.reference,
          },
        },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(found.booking.priceCad * 100),
          tax_behavior: "exclusive",
          product_data: {
            name: found.booking.lessonName,
            description: `${found.booking.durationMin}-minute booked session; GST calculated by Stripe Tax.`,
            tax_code: taxCode,
            metadata: {
              booking_id: found.booking.id,
              booking_reference: found.booking.reference,
            },
          },
        },
      }],
      client_reference_id: found.booking.reference,
      metadata: {
        booking_id: found.booking.id,
        booking_reference: found.booking.reference,
      },
      success_url: `${siteBase()}/booking/manage?token=${encodeURIComponent(parsed.data.token)}&payment=success`,
      cancel_url: `${siteBase()}/booking/manage?token=${encodeURIComponent(parsed.data.token)}&payment=cancelled`,
      integration_identifier: `wisdom_web_${randomLetters(8)}`,
    }, {
      idempotencyKey: `wisdom-booking-${found.booking.id}-${found.booking.stripeCheckoutAttempt ?? 0}`,
    });

    if (!session.url) {
      return NextResponse.json({ ok: false, error: "Stripe did not return a Checkout URL. Please try again." }, { status: 502 });
    }

    try {
      await store.setStripeCheckoutSession(
        found.booking.id,
        session.id,
        new Date(session.expires_at * 1000).toISOString(),
        found.booking.startsAt,
      );
    } catch (error) {
      // A booking may have been cancelled/rescheduled while Stripe created the
      // session. Do not leave an untracked, payable session behind.
      try {
        const latest = await stripe.checkout.sessions.retrieve(session.id);
        if (latest.status === "open") await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        console.error("[stripe/checkout] orphan session expiry failed", expireError);
      }
      throw error;
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("[stripe/checkout] failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not start secure payment. Your booking is saved; please try again or contact the school." },
      { status: 500 },
    );
  }
}

function randomLetters(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => String.fromCharCode(97 + byte % 26)).join("");
}
