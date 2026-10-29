import "server-only";

import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Set STRIPE_SECRET_KEY in the server environment.");
  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

export async function stripeTaxReady(stripe: Stripe): Promise<boolean> {
  const [settings, registrations] = await Promise.all([
    stripe.tax.settings.retrieve(),
    stripe.tax.registrations.list({ limit: 100 }),
  ]);
  return settings.status === "active" && registrations.data.some(
    (registration) => registration.country === "CA" && registration.status === "active",
  );
}

export function stripeTaxCode(): string {
  const taxCode = process.env.STRIPE_DRIVING_LESSON_TAX_CODE;
  if (!taxCode) throw new Error("Set STRIPE_DRIVING_LESSON_TAX_CODE after confirming the correct Stripe Tax category.");
  return taxCode;
}
