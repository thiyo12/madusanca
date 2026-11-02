import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { siteBase } from "@/lib/booking/urls";
import { getStripe, stripeTaxCode, stripeTaxReady } from "@/lib/stripe/server";
import { isStripePaymentsEnabled } from "@/lib/stripe/payment-validation";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2_048;
const purchaseSchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  studentName: z.string().trim().min(2).max(80),
  email: z.email().max(160),
  phone: z.string().trim().min(7).max(25),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  website: z.string().trim().max(120).optional().or(z.literal("")),
  consent: z.literal(true),
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
  if (await isIpRateLimitedShared(request, "package-purchase", 6, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many checkout attempts. Please try again shortly." }, { status: 429 });
  }

  let body: unknown;
  try {
    const result = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!result.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = purchaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Check your details and privacy consent." }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true, url: `${siteBase()}/lessons` });

  const email = parsed.data.email.trim().toLowerCase();
  if (await isRateLimitedShared(`package-purchase:${email}`, 5, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many checkout attempts for this email. Please try again later." }, { status: 429 });
  }

  try {
    const store = getStore();
    const lesson = (await store.getLessons()).find((item) => item.id === parsed.data.lessonId && item.category === "package");
    if (!lesson) return NextResponse.json({ ok: false, error: "That package is no longer available. Refresh the catalogue and try again." }, { status: 409 });
    const stripe = getStripe();
    if (!await stripeTaxReady(stripe)) {
      return NextResponse.json({ ok: false, error: "Stripe Tax is not ready for Canadian checkout in this test environment." }, { status: 503 });
    }

    const reference = `WDA-P-${randomBytes(4).toString("hex").toUpperCase()}`;
    const purchase = await store.createPackagePurchase({
      reference,
      studentName: parsed.data.studentName.trim(),
      email,
      phone: parsed.data.phone.trim(),
      notes: parsed.data.notes?.trim() ?? "",
      lessonId: lesson.id,
      lessonName: lesson.name,
      durationMin: lesson.durationMin,
      creditsPurchased: lesson.sessionCount,
      amountCad: lesson.priceCad,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      submit_type: "pay",
      customer_email: email,
      customer_creation: "always",
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      payment_intent_data: { statement_descriptor: "WISDOM DRIVING" },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${lesson.name} package purchase · ${reference}`,
          metadata: { purchase_id: purchase.id, purchase_reference: reference },
        },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(lesson.priceCad * 100),
          tax_behavior: "exclusive",
          product_data: {
            name: lesson.name,
            description: `${lesson.sessionCount} lesson credit${lesson.sessionCount === 1 ? "" : "s"}. Schedule within six calendar months after successful payment. GST calculated by Stripe Tax.`,
            tax_code: stripeTaxCode(),
            metadata: { purchase_id: purchase.id, purchase_reference: reference, lesson_id: lesson.id },
          },
        },
      }],
      client_reference_id: reference,
      metadata: {
        checkout_kind: "package_purchase",
        purchase_id: purchase.id,
        purchase_reference: reference,
        lesson_id: lesson.id,
        lesson_name: lesson.name,
        credits_purchased: String(lesson.sessionCount),
      },
      success_url: `${siteBase()}/booking/purchase/return?payment=success`,
      cancel_url: `${siteBase()}/booking/purchase/return?payment=cancelled`,
      integration_identifier: `wisdom_purchase_${randomBytes(4).toString("hex")}`,
    }, { idempotencyKey: `wisdom-package-purchase-${purchase.id}` });

    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    try {
      await store.setStripePackagePurchaseCheckout(purchase.id, session.id, new Date(session.expires_at * 1000).toISOString());
    } catch (error) {
      try {
        const latest = await stripe.checkout.sessions.retrieve(session.id);
        if (latest.status === "open") await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        logSafeError("[package-purchases/checkout] orphan session expiry failed", expireError);
      }
      throw error;
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    logSafeError("[package-purchases/checkout] failed", error);
    return NextResponse.json({ ok: false, error: "Could not start secure checkout. No credits were granted; please try again or contact the school." }, { status: 500 });
  }
}
