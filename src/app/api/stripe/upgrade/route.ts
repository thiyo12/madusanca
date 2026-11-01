import { createHash, randomBytes } from "crypto";
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
import { isStripePaymentsEnabled } from "@/lib/stripe/payment-validation";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { validateSlot } from "@/lib/booking/slots";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";

export const dynamic = "force-dynamic";
const schema = z.object({ targetLessonId: z.string().trim().min(1).max(100), sessions: z.array(z.string().datetime()).min(1).max(10) }).strict();

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
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Select a package and new times for every session." }, { status: 400 });

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
    if (!found.sessions.every((session) => ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid")) {
      return NextResponse.json({ ok: false, error: "Only paid, active bookings can be upgraded online." }, { status: 409 });
    }
    const target = (await store.getLessons()).find((lesson) => lesson.id === parsed.data.targetLessonId && lesson.category === "package");
    const currentPriceCad = booking.packagePriceCad ?? booking.priceCad;
    if (!target || target.priceCad <= currentPriceCad) return NextResponse.json({ ok: false, error: "Choose a higher-priced package to upgrade." }, { status: 400 });
    const proposed = parsed.data.sessions.map((startsAt) => ({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(Date.parse(startsAt) + target.durationMin * 60_000).toISOString() })).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    if (proposed.length !== target.sessionCount) return NextResponse.json({ ok: false, error: "Choose a new time for every session in the package." }, { status: 400 });
    const firstDay = dayKeyOf(proposed[0].startsAt);
    if (proposed.some((item) => dayKeyOf(item.startsAt) > addMonthsToKey(firstDay, 2))) return NextResponse.json({ ok: false, error: "All package sessions must be within two months of the first session." }, { status: 400 });
    for (let index = 1; index < proposed.length; index += 1) {
      if (Date.parse(proposed[index].startsAt) < Date.parse(proposed[index - 1].endsAt)) return NextResponse.json({ ok: false, error: "Package sessions cannot overlap." }, { status: 400 });
    }
    const oldSchedule = new Set(found.sessions.map((item) => `${item.startsAt}|${item.endsAt}`));
    const oldProposedSchedule = new Set((booking.stripeUpgradeTargetSessions ?? []).map((item) => `${item.startsAt}|${item.endsAt}`));
    const from = new Date(Date.now()).toISOString();
    const to = proposed.at(-1)!.endsAt;
    const [busy, blackouts, rules] = await Promise.all([store.getBusy(from, to), store.getBlackouts(), store.getRules()]);
    const availableBusy = busy.filter((item) => !oldSchedule.has(`${item.startsAt}|${item.endsAt}`) && !oldProposedSchedule.has(`${item.startsAt}|${item.endsAt}`));
    for (const item of proposed) {
      const validation = validateSlot(item.startsAt, { lessonDurationMin: target.durationMin, busy: availableBusy, blackouts, rules, now: new Date() });
      if (!validation.valid) return NextResponse.json({ ok: false, error: "One of those times is no longer available. Please choose new session times." }, { status: 409 });
      availableBusy.push(item);
    }
    const amountCad = Math.round((target.priceCad - currentPriceCad) * 100) / 100;
    const stripe = getStripe();
    let upgradeAttempt = booking.stripeUpgradeAttempt ?? 0;
    if (booking.stripeUpgradeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(booking.stripeUpgradeCheckoutSessionId);
      if (existing.status === "open" && existing.url && existing.metadata?.target_lesson_id === target.id &&
        JSON.stringify(booking.stripeUpgradeTargetSessions ?? []) === JSON.stringify(proposed)) return NextResponse.json({ ok: true, url: existing.url });
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
        target_price_cad: String(target.priceCad), from_price_cad: String(currentPriceCad) },
      success_url: `${siteBase()}/booking/manage?payment=success`,
      cancel_url: `${siteBase()}/booking/manage?payment=cancelled`,
      integration_identifier: `wisdom_web_${Array.from(randomBytes(8), (byte) => String.fromCharCode(97 + byte % 26)).join("")}`,
    }, { idempotencyKey: `wisdom-upgrade-${booking.id}-${upgradeAttempt}-${createHash("sha256").update(JSON.stringify(proposed)).digest("hex").slice(0, 16)}` });
    if (!session.url) return NextResponse.json({ ok: false, error: "Stripe did not return a Checkout URL. Please try again." }, { status: 502 });
    try {
      await store.setStripeUpgradeCheckoutSession(booking.id, session.id, target, currentPriceCad, amountCad, booking.startsAt, proposed);
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
