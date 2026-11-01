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
 * Fail-closed production payment gate. Test mode remains available for pre-launch
 * checks; live mode requires an explicit opt-in, a live key, and webhook signing
 * secret so paid sessions cannot be enabled without fulfillment notifications.
 */
export function isStripePaymentsEnabled(config: {
  nodeEnv: string | undefined;
  secretKey: string | undefined;
  livePaymentsEnabled: string | undefined;
  webhookSecret: string | undefined;
}): boolean {
  if (config.nodeEnv !== "production") return isTestModeStripeSecretKey(config.secretKey);
  if (isTestModeStripeSecretKey(config.secretKey)) return true;
  return config.livePaymentsEnabled === "true" &&
    isLiveModeStripeSecretKey(config.secretKey) &&
    typeof config.webhookSecret === "string" &&
    /^whsec_[A-Za-z0-9]+$/.test(config.webhookSecret);
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
): boolean {
  return Boolean(
    booking.stripeCheckoutSessionId &&
    booking.id === session.metadata?.booking_id &&
    booking.stripeCheckoutSessionId === session.id &&
    session.mode === "payment" &&
    session.currency?.toLowerCase() === "cad" &&
    session.client_reference_id === booking.reference &&
    session.metadata?.booking_reference === booking.reference &&
    session.amount_subtotal === Math.round((booking.packagePriceCad ?? booking.priceCad) * 100) &&
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
