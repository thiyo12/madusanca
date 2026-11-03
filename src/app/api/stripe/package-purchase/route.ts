import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { getManageToken } from "@/lib/booking/manage-cookie";
import { siteBase } from "@/lib/booking/urls";
import { getStripe, stripeTaxCode, stripeTaxReady } from "@/lib/stripe/server";
import { isStripePaymentsEnabled } from "@/lib/stripe/payment-validation";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";

const schema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(10),
}).strict();

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
  if (await isIpRateLimitedShared(request, "stripe-package-purchase", 5, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many package purchase attempts. Please try again shortly." }, { status: 429 });
  }

  let body: unknown;
  try {
    const bounded = await readBoundedBody(request, 2_048);
    if (!bounded.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Choose a package and quantity." }, { status: 400 });

  try {
    const store = getStore();
    const token = await getManageToken();
    if (!token) return NextResponse.json({ ok: false, error: "Verify your email in My Booking before adding a package." }, { status: 401 });
    const tokenHash = hashToken(token);
    if (await isRateLimitedShared(`stripe-package-token:${tokenHash}`, 5, 10 * 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many package purchase attempts. Please try again shortly." }, { status: 429 });
    }

    const found = await store.getBookingByToken(tokenHash);
    if (!found) return NextResponse.json({ ok: false, error: "This booking session is invalid. Verify your email again." }, { status: 401 });
    const activePaidBooking = found.sessions.some((session) =>
      ["confirmed", "rescheduled"].includes(session.status) &&
      session.paymentStatus === "paid" && Date.parse(session.startsAt) - Date.now() > 48 * 60 * 60_000,
    );
    if (!activePaidBooking) {
      return NextResponse.json({ ok: false, error: "You can add packages from My Booking when you have an active paid lesson more than 48 hours away." }, { status: 409 });
    }

    const lesson = (await store.getLessons()).find((item) => item.id === parsed.data.lessonId && item.category === "package");
    if (!lesson) return NextResponse.json({ ok: false, error: "That package is no longer available." }, { status: 404 });
    const amountCad = Math.round(lesson.priceCad * parsed.data.quantity * 100) / 100;
    if (!Number.isFinite(amountCad) || amountCad <= 0 || amountCad > 999_999.99) {
      return NextResponse.json({ ok: false, error: "The selected package total is outside the checkout limit." }, { status: 400 });
    }

    const stripe = getStripe();
    if (!await stripeTaxReady(stripe)) {
      return NextResponse.json({ ok: false, error: "Stripe Tax is not ready for checkout. Please try again later." }, { status: 503 });
    }

    const reference = `WDA-A-${Array.from(randomBytes(6), (byte) => (byte % 36).toString(36)).join("").toUpperCase()}`;
    const purchase = await store.createPackagePurchase({
      reference,
      studentName: found.booking.studentName,
      email: found.booking.email,
      phone: found.booking.phone,
      notes: `Added from My Booking ${found.booking.reference}`,
      lessonId: lesson.id,
      lessonName: lesson.name,
      durationMin: lesson.durationMin,
      creditsPurchased: lesson.sessionCount * parsed.data.quantity,
      amountCad,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      submit_type: "book",
      customer_email: purchase.email,
      customer_creation: "always",
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      payment_intent_data: { statement_descriptor: "WISDOM DRIVING" },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${lesson.name} × ${parsed.data.quantity} · ${purchase.reference}`,
          metadata: { checkout_kind: "package_purchase", purchase_id: purchase.id, purchase_reference: purchase.reference },
        },
      },
      line_items: [{
        quantity: parsed.data.quantity,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(lesson.priceCad * 100),
          tax_behavior: "exclusive",
          product_data: {
            name: lesson.name,
            description: `${lesson.sessionCount * parsed.data.quantity} extra lessons; scheduled separately after purchase. GST calculated by Stripe Tax.`,
            tax_code: stripeTaxCode(),
            metadata: { lesson_id: lesson.id, purchase_reference: purchase.reference },
          },
        },
      }],
      client_reference_id: purchase.reference,
      metadata: {
        checkout_kind: "package_purchase",
        purchase_id: purchase.id,
        purchase_reference: purchase.reference,
        lesson_id: lesson.id,
        lesson_name: lesson.name,
      },
      success_url: `${siteBase()}/booking/manage?payment=success&purchase=added`,
      cancel_url: `${siteBase()}/booking/manage?payment=cancelled&purchase=added`,
      integration_identifier: `wisdom_web_${Array.from(randomBytes(8), (byte) => String.fromCharCode(97 + byte % 26)).join("")}`,
    }, { idempotencyKey: `wda-package-purchase-${purchase.id}` });

    if (!session.url) return NextResponse.json({ ok: false, error: "Stripe did not return a Checkout URL. Please try again." }, { status: 502 });
    await store.setStripePackagePurchaseCheckout(purchase.id, session.id, new Date(session.expires_at * 1000).toISOString());
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    logSafeError("[stripe/package-purchase] failed", error);
    return NextResponse.json({ ok: false, error: "Could not start secure package checkout. Your current booking is unchanged; please try again." }, { status: 500 });
  }
}
