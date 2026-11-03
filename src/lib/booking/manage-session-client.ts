"use client";

const STRIPE_RETURN_MARKER = "wda_manage_stripe_return";
const VERIFIED_NAVIGATION_MARKER = "wda_manage_verified_navigation";

/** Authorize the immediate navigation to My Booking after OTP verification. */
export function markManageSessionVerified(): void {
  window.sessionStorage.setItem(VERIFIED_NAVIGATION_MARKER, "1");
}

/** Consume the one-use navigation authorization; reloads must verify again. */
export function consumeManageSessionVerified(): boolean {
  const isVerifiedNavigation = window.sessionStorage.getItem(VERIFIED_NAVIGATION_MARKER) === "1";
  window.sessionStorage.removeItem(VERIFIED_NAVIGATION_MARKER);
  return isVerifiedNavigation;
}

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
