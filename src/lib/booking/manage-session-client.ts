"use client";

const STRIPE_RETURN_MARKER = "wda_manage_stripe_return";

/** Keep the verified manage cookie only for a Stripe round-trip from My Booking. */
export function preserveManageSessionForStripeReturn(): void {
  if (window.location.pathname === "/booking/manage") {
    window.sessionStorage.setItem(STRIPE_RETURN_MARKER, "1");
  }
}

/** Consume the one-use exception after returning from Stripe. */
export function consumeManageSessionStripeReturn(): boolean {
  const isStripeReturn = window.sessionStorage.getItem(STRIPE_RETURN_MARKER) === "1";
  window.sessionStorage.removeItem(STRIPE_RETURN_MARKER);
  return isStripeReturn;
}

export function hasPendingManageSessionStripeReturn(): boolean {
  return window.sessionStorage.getItem(STRIPE_RETURN_MARKER) === "1";
}
