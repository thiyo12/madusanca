"use client";

const STRIPE_RETURN_MARKER = "wda_manage_stripe_return";
const VERIFIED_NAVIGATION_MARKER = "wda_manage_verified_navigation";
const ADDON_SELECTION_MARKER = "wda_manage_addon_selection";

export interface ManageAddonSelection {
  lessonId: string;
  quantity: number;
  startsAt: string[];
}

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

/** Keep the in-progress add-on choice only for this browser tab's checkout return. */
export function saveManageAddonSelection(selection: ManageAddonSelection[]): void {
  window.sessionStorage.setItem(ADDON_SELECTION_MARKER, JSON.stringify(selection));
}

export function consumeManageAddonSelection(): ManageAddonSelection[] {
  const saved = window.sessionStorage.getItem(ADDON_SELECTION_MARKER);
  window.sessionStorage.removeItem(ADDON_SELECTION_MARKER);
  if (!saved) return [];
  try {
    const value: unknown = JSON.parse(saved);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ManageAddonSelection =>
      typeof item === "object" && item !== null &&
      typeof item.lessonId === "string" &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
      Array.isArray(item.startsAt) && item.startsAt.every((time: unknown) => typeof time === "string"),
    );
  } catch {
    return [];
  }
}

export function clearManageAddonSelection(): void {
  window.sessionStorage.removeItem(ADDON_SELECTION_MARKER);
}
