import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
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
import { packagePurchaseSchema } from "@/lib/validation/booking";
import { occupiedDurationMin, validateSlot } from "@/lib/booking/slots";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";

export const dynamic = "force-dynamic";

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
  const parsed = packagePurchaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Choose a package, quantity, and a date and time for every lesson." }, { status: 400 });

  try {
    const store = getStore();
    const token = await getManageToken();
    if (!token) return NextResponse.json({ ok: false, error: "Verify your email in My Booking before adding a package." }, { status: 401 });
    const tokenHash = hashToken(token);
    if (await isRateLimitedShared(`stripe-package-token:${tokenHash}`, 5, 10 * 60_000)) {
      return NextResponse.json({ ok: false, error: "Too many package purchase attempts. Please try again shortly." }, { status: 429 });
    }

    const found = await store.getBookingByToken(tokenHash);
    const purchaseContext = found ? null : await store.getPackagePurchaseByToken(tokenHash);
    const purchaseSessions = purchaseContext ? await store.findBookingsByPurchaseId(purchaseContext.id) : [];
    const eligibleSessions = found?.sessions ?? purchaseSessions;
    const activePaidBooking = (Boolean(found) || purchaseContext?.paymentStatus === "paid") && eligibleSessions.some((session) =>
      ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid",
    );
    if (!activePaidBooking || (!found && !purchaseContext)) {
      return NextResponse.json({ ok: false, error: "You can add packages from My Booking when you have an active paid lesson." }, { status: 409 });
    }
    const anchorBooking = found?.booking ?? purchaseSessions.find((session) =>
      ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid",
    );
    if (!anchorBooking) return NextResponse.json({ ok: false, error: "You can add packages from My Booking when you have an active paid lesson." }, { status: 409 });

    const lessons = await store.getLessons();
    const scheduleItems = [] as Array<{ lesson: (typeof lessons)[number]; quantity: number; startsAt: string[] }>;
    let totalCredits = 0;
    for (const selection of parsed.data.packages) {
      const lesson = lessons.find((item) => item.id === selection.lessonId && item.category === "package");
      if (!lesson) return NextResponse.json({ ok: false, error: "One of those packages is no longer available." }, { status: 404 });
      const credits = lesson.sessionCount * selection.quantity;
      totalCredits += credits;
      if (selection.startsAt.length !== credits) return NextResponse.json({ ok: false, error: `Choose a date and time for each of the ${credits} ${lesson.name} lessons.` }, { status: 400 });
      scheduleItems.push({ lesson, quantity: selection.quantity, startsAt: selection.startsAt.map((value) => new Date(value).toISOString()) });
    }
    if (totalCredits > 20) return NextResponse.json({ ok: false, error: "A checkout can include up to 20 scheduled lessons. Reduce the package quantities and try again." }, { status: 400 });
    const startsAt = scheduleItems.flatMap((item) => item.startsAt).sort((a, b) => Date.parse(a) - Date.parse(b));
    if (new Set(startsAt).size !== startsAt.length) return NextResponse.json({ ok: false, error: "Choose a different time for every lesson." }, { status: 400 });
    const now = new Date();
    const firstDay = dayKeyOf(startsAt[0]);
    const latestFirstDay = addMonthsToKey(dayKeyOf(now.toISOString()), 6);
    const lastAllowedDay = addMonthsToKey(firstDay, 6);
    if (Date.parse(startsAt[0]) < now.getTime() + 120 * 60_000 || firstDay > latestFirstDay || startsAt.some((start) => dayKeyOf(start) > lastAllowedDay)) {
      return NextResponse.json({ ok: false, error: "Choose available lesson times starting at least two hours from now and within the six-month scheduling window." }, { status: 400 });
    }
    const [rules, blackouts, dateOverrides] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getDateOverrides(firstDay, lastAllowedDay),
    ]);
    const selectedBusy: Array<{ startsAt: string; endsAt: string }> = [];
    for (const item of scheduleItems) for (const start of item.startsAt) {
      const startMs = Date.parse(start);
      const busy = await store.getBusy(new Date(startMs - 24 * 60 * 60_000).toISOString(), new Date(startMs + 48 * 60 * 60_000).toISOString());
      const result = validateSlot(start, {
        lessonDurationMin: item.lesson.durationMin,
        busy: [...busy, ...selectedBusy],
        blackouts,
        rules,
        dateOverrides,
        now,
      });
      if (!result.valid) return NextResponse.json({ ok: false, error: result.reason === "occupied" ? "One of those times was just taken. Choose another time." : "One of those times is no longer available. Review your selections." }, { status: 409 });
      selectedBusy.push({ startsAt: start, endsAt: new Date(startMs + occupiedDurationMin(item.lesson.durationMin) * 60_000).toISOString() });
    }
    const amountCad = Math.round(scheduleItems.reduce((sum, item) => sum + item.lesson.priceCad * item.quantity, 0) * 100) / 100;
    if (!Number.isFinite(amountCad) || amountCad <= 0 || amountCad > 999_999.99) {
      return NextResponse.json({ ok: false, error: "The selected package total is outside the checkout limit." }, { status: 400 });
    }

    const stripe = getStripe();
    if (!await stripeTaxReady(stripe)) {
      return NextResponse.json({ ok: false, error: "Stripe Tax is not ready for checkout. Please try again later." }, { status: 503 });
    }

    const purchaseItems = scheduleItems.map((item) => ({
      lesson: item.lesson,
      quantity: item.quantity,
      startsAt: item.startsAt,
      id: randomUUID(),
      reference: `WDA-A-${Array.from(randomBytes(6), (byte) => (byte % 36).toString(36)).join("").toUpperCase()}`,
      creditsPurchased: item.lesson.sessionCount * item.quantity,
      amountCad: Math.round(item.lesson.priceCad * item.quantity * 100) / 100,
    }));
    const purchaseId = purchaseItems[0]!.id;
    const reference = purchaseItems[0]!.reference;
    const expiresAt = new Date(Date.now() + 31 * 60_000).toISOString();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: Math.floor(Date.parse(expiresAt) / 1000),
      submit_type: "book",
      customer_email: anchorBooking.email,
      customer_creation: "always",
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      payment_intent_data: { statement_descriptor: "WISDOM DRIVING" },
      invoice_creation: {
        enabled: true,
        invoice_data: {
        description: `Add-on packages × ${purchaseItems.length} · ${reference}`,
        metadata: { checkout_kind: "package_purchase_bundle", purchase_id: purchaseId, purchase_reference: reference },
        },
      },
      line_items: purchaseItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "cad",
          unit_amount: Math.round(item.lesson.priceCad * 100),
          tax_behavior: "exclusive",
          product_data: {
            name: item.lesson.name,
            description: `${item.creditsPurchased} scheduled lessons; times selected in My Booking. GST calculated by Stripe Tax.`,
            tax_code: stripeTaxCode(),
            metadata: { lesson_id: item.lesson.id, purchase_reference: item.reference },
          },
        },
      })),
      client_reference_id: reference,
      metadata: {
        checkout_kind: "package_purchase_bundle",
        purchase_id: purchaseId,
        purchase_reference: reference,
        purchase_ids: purchaseItems.map((item) => item.id).join(","),
      },
      success_url: `${siteBase()}/booking/manage?payment=success&purchase=added`,
      cancel_url: `${siteBase()}/booking/manage?payment=cancelled&purchase=added`,
      integration_identifier: `wisdom_web_${Array.from(randomBytes(8), (byte) => String.fromCharCode(97 + byte % 26)).join("")}`,
    }, { idempotencyKey: `wda-package-purchase-${purchaseId}` });

    if (!session.url) {
      await stripe.checkout.sessions.expire(session.id).catch((error: unknown) => logSafeError("[stripe/package-purchase] checkout URL missing", error));
      return NextResponse.json({ ok: false, error: "Stripe did not return a Checkout URL. Please try again." }, { status: 502 });
    }
    let created: Awaited<ReturnType<typeof store.createScheduledPackagePurchaseBundle>>;
    try {
      created = await store.createScheduledPackagePurchaseBundle(purchaseItems.map((item) => ({
        input: {
          id: item.id,
          reference: item.reference,
          studentName: anchorBooking.studentName,
          email: anchorBooking.email,
          phone: anchorBooking.phone,
          notes: `Added from My Booking ${anchorBooking.reference}`,
          lessonId: item.lesson.id,
          lessonName: item.lesson.name,
          durationMin: item.lesson.durationMin,
          creditsPurchased: item.creditsPurchased,
          amountCad: item.amountCad,
        },
        packageQuantity: item.quantity,
        startsAt: item.startsAt,
      })), tokenHash, session.id, new Date(session.expires_at * 1000).toISOString());
    } catch (error) {
      await stripe.checkout.sessions.expire(session.id).catch((expireError: unknown) => logSafeError("[stripe/package-purchase] orphan checkout expiry failed", expireError));
      throw error;
    }
    if (!created.ok) {
      await stripe.checkout.sessions.expire(session.id).catch((error: unknown) => logSafeError("[stripe/package-purchase] expired checkout after unavailable schedule", error));
      const conflict = created.error === "conflict";
      const notModifiable = created.error === "not_modifiable";
      return NextResponse.json({ ok: false, error: conflict ? "One of those times was just taken. Choose another time." : notModifiable ? "Add-on packages are available when you have an active paid lesson." : "We couldn’t reserve those lesson times. Refresh My Booking and choose available times again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    logSafeError("[stripe/package-purchase] failed", error);
    return NextResponse.json({ ok: false, error: "Could not start secure package checkout. Your current booking is unchanged; please try again." }, { status: 500 });
  }
}
