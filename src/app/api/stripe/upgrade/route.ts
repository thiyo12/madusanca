import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { siteBase } from "@/lib/booking/urls";
import { recordPaidUpgradeCheckoutSession } from "@/lib/stripe/fulfill";
import { getStripe, stripeTaxCode, stripeTaxReady } from "@/lib/stripe/server";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { getManageToken } from "@/lib/booking/manage-cookie";
import { isTestModeStripeSecretKey } from "@/lib/stripe/payment-validation";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";

export const dynamic = "force-dynamic";
const schema = z.object({ targetLessonId: z.string().trim().min(1).max(100) }).strict();

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (process.env.NODE_ENV === "production" && !isTestModeStripeSecretKey(process.env.STRIPE_SECRET_KEY)) {
    return NextResponse.json({ ok: false, error: "Online payments are disabled until test-mode checkout is configured." }, { status: 503 });
  }
  if (await isIpRateLimitedShared(request, "stripe-upgrade", 5, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many upgrade attempts. Please try again shortly." }, { status: 429 });
  }
  let body: unknown;
  try {
    const result = await readBoundedBody(request, 2_048);
    if (!result.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    body = JSON.parse(result.text);
  } catch { return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Open the private manage link and select a package." }, { status: 400 });

  try {
    const store = getStore();
    const token = await getManageToken();
    if (!token) return NextResponse.json({ ok: false, error: "Open the private manage link for this booking." }, { status: 401 });
    const tokenHash = hashToken(token);
    if (await isRateLimitedShared(`stripe-upgrade-token:${tokenHash}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "Too many upgrade attempts. Please try again shortly." }, { status: 429 });
    }
    const found = await store.getBookingByToken(tokenHash);
    if (!found) return NextResponse.json({ ok: false, error: "This booking link is invalid or has expired." }, { status: 404 });
    const booking = found.booking;
    if (!["confirmed", "rescheduled"].includes(booking.status) || booking.paymentStatus !== "paid") {
      return NextResponse.json({ ok: false, error: "Only paid, active bookings can be upgraded online." }, { status: 409 });
    }
    const target = (await store.getLessons()).find((lesson) => lesson.id === parsed.data.targetLessonId && lesson.category === "package");
    if (!target || target.priceCad <= booking.priceCad) return NextResponse.json({ ok: false, error: "Choose a higher-priced package to upgrade." }, { status: 400 });
    const amountCad = Math.round((target.priceCad - booking.priceCad) * 100) / 100;
    const stripe = getStripe();
    let upgradeAttempt = booking.stripeUpgradeAttempt ?? 0;
    if (booking.stripeUpgradeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(booking.stripeUpgradeCheckoutSessionId);
      if (existing.status === "open" && existing.url && existing.metadata?.target_lesson_id === target.id) return NextResponse.json({ ok: true, url: existing.url });
      if (existing.status === "complete" && existing.payment_status === "paid") {
        await recordPaidUpgradeCheckoutSession(existing, `upgrade-reconcile-${existing.id}`);
        return NextResponse.json({ ok: true, paid: true });
      }
      if (existing.status === "open") await stripe.checkout.sessions.expire(existing.id);
      const current = await store.getBookingByUpgradeCheckoutSession(existing.id);
      if (current?.stripeUpgradeTargetLessonId && current.stripeUpgradeTargetLessonName && current.stripeUpgradeTargetDurationMin && current.stripeUpgradeTargetPriceCad !== undefined && current.stripeUpgradeFromPriceCad !== undefined) {
        await store.handleStripeUpgradeCheckoutEvent({ eventId: `upgrade-expired-reconcile-${existing.id}`, eventType: "expired", bookingId: booking.id, sessionId: existing.id,
          targetLessonId: current.stripeUpgradeTargetLessonId, targetLessonName: current.stripeUpgradeTargetLessonName,
          targetDurationMin: current.stripeUpgradeTargetDurationMin, targetPriceCad: current.stripeUpgradeTargetPriceCad,
          fromPriceCad: current.stripeUpgradeFromPriceCad });
        upgradeAttempt += 1;
      }
    }
    if (!await stripeTaxReady(stripe)) return NextResponse.json({ ok: false, error: "Stripe Tax is not ready for this test environment." }, { status: 503 });

    const session = await stripe.checkout.sessions.create({
      mode: "payment", submit_type: "book", customer_email: booking.email, customer_creation: "always",
      billing_address_collection: "auto", automatic_tax: { enabled: true },
      payment_intent_data: { statement_descriptor: "WISDOM DRIVING" },
      invoice_creation: { enabled: true, invoice_data: { description: `Upgrade to ${target.name} · ${booking.reference}`, metadata: { booking_id: booking.id, booking_reference: booking.reference, checkout_kind: "package_upgrade" } } },
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: Math.round(amountCad * 100), tax_behavior: "exclusive",
        product_data: { name: `Upgrade to ${target.name}`, description: `Balance due after credit for ${booking.lessonName}. GST calculated by Stripe Tax.`, tax_code: stripeTaxCode(), metadata: { booking_id: booking.id, booking_reference: booking.reference } } } }],
      client_reference_id: booking.reference,
      metadata: { booking_id: booking.id, booking_reference: booking.reference, checkout_kind: "package_upgrade",
        target_lesson_id: target.id, target_lesson_name: target.name, target_duration_min: String(target.durationMin),
        target_price_cad: String(target.priceCad), from_price_cad: String(booking.priceCad) },
      success_url: `${siteBase()}/booking/manage?payment=success`,
      cancel_url: `${siteBase()}/booking/manage?payment=cancelled`,
      integration_identifier: `wisdom_web_${Array.from(randomBytes(8), (byte) => String.fromCharCode(97 + byte % 26)).join("")}`,
    }, { idempotencyKey: `wisdom-upgrade-${booking.id}-${upgradeAttempt}-${target.id}` });
    if (!session.url) return NextResponse.json({ ok: false, error: "Stripe did not return a Checkout URL. Please try again." }, { status: 502 });
    try {
      await store.setStripeUpgradeCheckoutSession(booking.id, session.id, target, booking.priceCad, amountCad, booking.startsAt);
    } catch (error) {
      try { if ((await stripe.checkout.sessions.retrieve(session.id)).status === "open") await stripe.checkout.sessions.expire(session.id); }
      catch (expireError) { logSafeError("[stripe/upgrade] orphan session expiry failed", expireError); }
      throw error;
    }
    return NextResponse.json({ ok: true, url: session.url, amountCad });
  } catch (error) {
    logSafeError("[stripe/upgrade] failed", error);
    return NextResponse.json({ ok: false, error: "Could not start secure upgrade payment. Your booking is unchanged; please try again or contact the school." }, { status: 500 });
  }
}
