import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { getManageToken } from "@/lib/booking/manage-cookie";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { siteBase } from "@/lib/booking/urls";
import { recordPaidCheckoutSession } from "@/lib/stripe/fulfill";
import { getStripe, stripeTaxCode, stripeTaxReady } from "@/lib/stripe/server";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { isStripePaymentsEnabled } from "@/lib/stripe/payment-validation";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { getCheckoutGrantBookingId } from "@/lib/booking/checkout-cookie";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2_048;

const checkoutSchema = z.object({ checkoutOnly: z.boolean().optional() }).strict();

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (!isStripePaymentsEnabled({
    nodeEnv: process.env.NODE_ENV,
    secretKey: process.env.STRIPE_SECRET_KEY,
    livePaymentsEnabled: process.env.STRIPE_LIVE_PAYMENTS_ENABLED,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  })) {
    return NextResponse.json({ ok: false, error: "Online payments are not enabled for this Stripe configuration." }, { status: 503 });
  }
  if (await isIpRateLimitedShared(request, "stripe-checkout", 8, 10 * 60 * 1000)) {
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
    const token = parsed.data.checkoutOnly ? null : await getManageToken();
    const checkoutGrantBookingId = !token ? await getCheckoutGrantBookingId() : null;
    if (!token && !checkoutGrantBookingId) return NextResponse.json({ ok: false, error: "Open the private manage link for this booking." }, { status: 401 });
    const tokenHash = token ? hashToken(token) : null;
    const rateKey = tokenHash ?? `checkout-grant:${checkoutGrantBookingId}`;
    if (await isRateLimitedShared(`stripe-checkout-token:${rateKey}`, 8, 10 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "Too many checkout attempts. Please try again shortly." }, { status: 429 });
    }
    const loadBooking = () => tokenHash
      ? store.getBookingByToken(tokenHash)
      : store.getBookingCheckoutBundle(checkoutGrantBookingId!).then((bundle) => bundle ? { ...bundle, tokenExpiresAt: "" } : null);
    let found = await loadBooking();
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
    const lessons = await store.getLessons();
    // Add-on lesson sessions are persisted with the booking bundle. Derive
    // checkout add-ons from those server-side rows, never from browser input.
    const scheduledSessionCounts = new Map<string, number>();
    for (const session of found.sessions) {
      scheduledSessionCounts.set(session.lessonId, (scheduledSessionCounts.get(session.lessonId) ?? 0) + 1);
    }
    const primaryLesson = lessons.find((item) => item.id === found!.booking.lessonId);
    if (!primaryLesson) throw new Error("Stored primary booking lesson is missing from the catalogue.");
    const primarySessionCount = scheduledSessionCounts.get(primaryLesson.id) ?? 0;
    if (primarySessionCount < primaryLesson.sessionCount) {
      throw new Error("Stored primary booking sessions do not match the package catalogue.");
    }
    const scheduledAddOnCounts = new Map(scheduledSessionCounts);
    const primaryAddOnCount = primarySessionCount - primaryLesson.sessionCount;
    if (primaryAddOnCount) scheduledAddOnCounts.set(primaryLesson.id, primaryAddOnCount);
    else scheduledAddOnCounts.delete(primaryLesson.id);
    const addOnPackages = [...scheduledAddOnCounts].map(([lessonId, sessionTotal]) => {
      const lesson = lessons.find((item) => item.id === lessonId && item.category === "package");
      if (!lesson || sessionTotal % lesson.sessionCount !== 0) {
        throw new Error("Stored add-on booking sessions do not match the package catalogue.");
      }
      return { lessonId, quantity: sessionTotal / lesson.sessionCount };
    });
    if (found.booking.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(found.booking.stripeCheckoutSessionId);
      const sessionStillValid = !found.booking.stripeCheckoutExpiresAt ||
        Date.parse(found.booking.stripeCheckoutExpiresAt) > Date.now();
      if (existing.status === "open" && existing.url && sessionStillValid) {
        const savedAddons = await store.getBookingCheckoutAddons(found.booking.id, existing.id);
        const requestedAmounts = addOnPackages.map((selection) => {
          const item = lessons.find((lesson) => lesson.id === selection.lessonId && lesson.category === "package");
          return item ? `${item.id}:${Math.round(item.priceCad * selection.quantity * 100)}` : `${selection.lessonId}:invalid`;
        }).sort();
        const savedAmountMap = new Map<string, number>();
        for (const purchase of savedAddons) savedAmountMap.set(purchase.lessonId, (savedAmountMap.get(purchase.lessonId) ?? 0) + Math.round(purchase.amountCad * 100));
        const savedAmounts = [...savedAmountMap].map(([id, cents]) => `${id}:${cents}`).sort();
        if (JSON.stringify(requestedAmounts) !== JSON.stringify(savedAmounts)) {
          return NextResponse.json({ ok: false, error: "A Checkout session is already open with a different selection. Finish or wait for it to expire before changing extras." }, { status: 409 });
        }
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
        found = await loadBooking();
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
      found = await loadBooking();
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
    const addOns = addOnPackages.map((selection) => ({
      quantity: selection.quantity,
      lesson: lessons.find((lesson) => lesson.id === selection.lessonId && lesson.category === "package"),
    }));
    if (addOns.some((selection) => !selection.lesson)) {
      return NextResponse.json({ ok: false, error: "An additional lesson is no longer available. Return to the catalogue and review your selection." }, { status: 409 });
    }
    const addOnSubtotal = addOns.reduce((sum, item) => sum + (item.lesson?.priceCad ?? 0) * item.quantity, 0);
    if (found.booking.packagePriceCad! + addOnSubtotal > 999_999.99) {
      return NextResponse.json({ ok: false, error: "The selected total exceeds the secure checkout limit. Reduce package quantities and try again." }, { status: 400 });
    }
    const validAddOns = addOns as Array<{ quantity: number; lesson: NonNullable<(typeof addOns)[number]["lesson"]> }>;
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
            description: `${found.booking.lessonName}${validAddOns.length ? ` + ${validAddOns.map(({ lesson, quantity }) => `${lesson.name} × ${quantity}`).join(", ")}` : ""} · ${found.booking.reference}`,
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
        unit_amount: Math.round((found.booking.packagePriceCad ?? found.booking.priceCad) * 100),
          tax_behavior: "exclusive",
          product_data: {
            name: found.booking.lessonName,
            description: `${found.sessions.length} separately scheduled ${found.booking.durationMin}-minute session${found.sessions.length === 1 ? "" : "s"}; GST calculated by Stripe Tax.`,
            tax_code: taxCode,
            metadata: {
              booking_id: found.booking.id,
              booking_reference: found.booking.reference,
            },
          },
        },
      }, ...validAddOns.map(({ lesson: addon, quantity }) => ({
        quantity,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(addon.priceCad * 100),
          tax_behavior: "exclusive" as const,
          product_data: {
            name: addon.name,
            description: `${addon.sessionCount * quantity} lessons across ${quantity} package${quantity === 1 ? "" : "s"}; all appointments selected in this booking. GST calculated by Stripe Tax.`,
            tax_code: taxCode,
            metadata: { lesson_id: addon.id, booking_reference: found!.booking.reference },
          },
        },
      }))],
      client_reference_id: found.booking.reference,
      metadata: {
        booking_id: found.booking.id,
        booking_reference: found.booking.reference,
        lesson_id: found.booking.lessonId,
        lesson_name: found.booking.lessonName,
      },
      success_url: `${siteBase()}/booking/manage?payment=success`,
      cancel_url: `${siteBase()}/booking?payment=cancelled`,
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
        addOnPackages,
      );
    } catch (error) {
      // A booking may have been cancelled/rescheduled while Stripe created the
      // session. Do not leave an untracked, payable session behind.
      try {
        const latest = await stripe.checkout.sessions.retrieve(session.id);
        if (latest.status === "open") await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        logSafeError("[stripe/checkout] orphan session expiry failed", expireError);
      }
      throw error;
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    logSafeError("[stripe/checkout] failed", error);
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
