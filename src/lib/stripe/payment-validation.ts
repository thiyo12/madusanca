import type Stripe from "stripe";

type PaymentTotals = Pick<Stripe.Checkout.Session, "amount_subtotal" | "amount_total" | "total_details">;

/** Recognize a correctly shaped Stripe test-mode secret without exposing its value. */
export function isTestModeStripeSecretKey(key: string | undefined): boolean {
  return typeof key === "string" && /^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(key);
}

function isLiveModeStripeSecretKey(key: string | undefined): boolean {
  return typeof key === "string" && /^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(key);
}

/**
 * Fail-closed production payment gate. Live mode requires an explicit opt-in,
 * live credentials, and a webhook secret. Test mode is restricted to an
 * explicitly marked staging deployment on a separate HTTPS origin.
 */
export function isStripePaymentsEnabled(config: {
  nodeEnv: string | undefined;
  secretKey: string | undefined;
  livePaymentsEnabled: string | undefined;
  testPaymentsEnabled?: string | undefined;
  deploymentEnvironment?: string | undefined;
  siteUrl?: string | undefined;
  webhookSecret: string | undefined;
}): boolean {
  if (config.nodeEnv !== "production") return isTestModeStripeSecretKey(config.secretKey);
  if (isLiveModeStripeSecretKey(config.secretKey)) {
    return config.deploymentEnvironment !== "staging" &&
      config.livePaymentsEnabled === "true" &&
      typeof config.webhookSecret === "string" &&
      /^whsec_[A-Za-z0-9]+$/.test(config.webhookSecret);
  }
  if (
    !isTestModeStripeSecretKey(config.secretKey) ||
    config.livePaymentsEnabled === "true" ||
    config.deploymentEnvironment !== "staging" ||
    config.testPaymentsEnabled !== "true" ||
    typeof config.webhookSecret !== "string" ||
    !/^whsec_[A-Za-z0-9]+$/.test(config.webhookSecret)
  ) return false;

  return isNonProductionHttpsOrigin(config.siteUrl);
}

function isNonProductionHttpsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      host !== "wisdomdrivingacademy.com" &&
      !host.endsWith(".wisdomdrivingacademy.com") &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "[::1]";
  } catch {
    return false;
  }
}

/** A valid Stripe signature must also come from the configured key's mode. */
export function stripeEventModeMatchesKey(
  eventIsLive: boolean,
  secretKey: string | undefined,
): boolean {
  if (isLiveModeStripeSecretKey(secretKey)) return eventIsLive;
  if (isTestModeStripeSecretKey(secretKey)) return !eventIsLive;
  return false;
}

/** Checkout has one pre-tax line item and Stripe Tax is additive. */
export function hasConsistentCadTotal(session: PaymentTotals): boolean {
  const subtotal = session.amount_subtotal;
  const total = session.amount_total;
  const tax = session.total_details?.amount_tax;
  return typeof subtotal === "number" && typeof total === "number" && typeof tax === "number" &&
    Number.isSafeInteger(subtotal) && Number.isSafeInteger(total) && Number.isSafeInteger(tax) &&
    subtotal >= 0 && tax >= 0 && total === subtotal + tax;
}

/** Pure guard for a paid initial-payment event before it mutates a booking. */
export function matchesInitialBookingPayment(
  session: Pick<Stripe.Checkout.Session,
    "id" | "mode" | "currency" | "client_reference_id" | "metadata" |
    "amount_subtotal" | "amount_total" | "total_details">,
  booking: { id: string; reference: string; priceCad: number; packagePriceCad?: number; stripeCheckoutSessionId?: string },
  addOnAmountCad = 0,
): boolean {
  return Boolean(
    booking.stripeCheckoutSessionId &&
    booking.id === session.metadata?.booking_id &&
    booking.stripeCheckoutSessionId === session.id &&
    session.mode === "payment" &&
    session.currency?.toLowerCase() === "cad" &&
    session.client_reference_id === booking.reference &&
    session.metadata?.booking_reference === booking.reference &&
    session.amount_subtotal === Math.round(((booking.packagePriceCad ?? booking.priceCad) + addOnAmountCad) * 100) &&
    hasConsistentCadTotal(session),
  );
}

/** Pure guard for a paid package-upgrade event before it mutates a booking. */
export function matchesUpgradeBookingPayment(
  session: Pick<Stripe.Checkout.Session,
    "id" | "mode" | "currency" | "client_reference_id" | "metadata" |
    "amount_subtotal" | "amount_total" | "total_details">,
  booking: {
    id: string;
    reference: string;
    stripeUpgradeCheckoutSessionId?: string;
    stripeUpgradeTargetLessonId?: string;
    stripeUpgradeTargetLessonName?: string;
    stripeUpgradeTargetDurationMin?: number;
    stripeUpgradeTargetPriceCad?: number;
    stripeUpgradeFromPriceCad?: number;
    stripeUpgradeAmountCad?: number;
  },
): boolean {
  const metadata = session.metadata;
  const durationMin = Number(metadata?.target_duration_min);
  const targetPriceCad = Number(metadata?.target_price_cad);
  const fromPriceCad = Number(metadata?.from_price_cad);
  const amountCad = booking.stripeUpgradeAmountCad;
  return Boolean(
    booking.stripeUpgradeCheckoutSessionId &&
    booking.stripeUpgradeTargetLessonId &&
    booking.stripeUpgradeTargetLessonName &&
    Number.isInteger(booking.stripeUpgradeTargetDurationMin) &&
    Number.isFinite(booking.stripeUpgradeTargetPriceCad) &&
    Number.isFinite(booking.stripeUpgradeFromPriceCad) &&
    typeof amountCad === "number" && Number.isFinite(amountCad) &&
    booking.id === metadata?.booking_id &&
    booking.stripeUpgradeCheckoutSessionId === session.id &&
    session.mode === "payment" &&
    session.currency?.toLowerCase() === "cad" &&
    session.client_reference_id === booking.reference &&
    metadata?.checkout_kind === "package_upgrade" &&
    metadata.booking_reference === booking.reference &&
    metadata.target_lesson_id === booking.stripeUpgradeTargetLessonId &&
    metadata.target_lesson_name === booking.stripeUpgradeTargetLessonName &&
    durationMin === booking.stripeUpgradeTargetDurationMin &&
    targetPriceCad === booking.stripeUpgradeTargetPriceCad &&
    fromPriceCad === booking.stripeUpgradeFromPriceCad &&
    session.amount_subtotal === Math.round(amountCad * 100) &&
    hasConsistentCadTotal(session),
  );
}

/** Validate a paid Checkout Session against one independent package purchase. */
export function matchesPackagePurchasePayment(
  session: Pick<Stripe.Checkout.Session,
    "id" | "mode" | "currency" | "client_reference_id" | "metadata" |
    "amount_subtotal" | "amount_total" | "total_details">,
  purchase: {
    id: string;
    reference: string;
    amountCad: number;
    stripeCheckoutSessionId?: string;
  },
): boolean {
  return Boolean(
    purchase.stripeCheckoutSessionId &&
    session.id === purchase.stripeCheckoutSessionId &&
    session.mode === "payment" &&
    session.currency?.toLowerCase() === "cad" &&
    session.client_reference_id === purchase.reference &&
    session.metadata?.checkout_kind === "package_purchase" &&
    session.metadata.purchase_id === purchase.id &&
    session.metadata.purchase_reference === purchase.reference &&
    session.amount_subtotal === Math.round(purchase.amountCad * 100) &&
    hasConsistentCadTotal(session),
  );
}
