import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { BookingPortal } from "@/components/booking/booking-portal";
import { noIndexPageMetadata } from "@/lib/seo/metadata";
import { MANAGE_COOKIE_NAME } from "@/lib/booking/manage-cookie";

export const metadata = noIndexPageMetadata(
  "Manage Your Booking",
  "View and manage your private driving lesson booking.",
);

// The private manage cookie and Stripe return status are request-specific.
export const dynamic = "force-dynamic";

interface ManagePageProps { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function BookingManagePage({ searchParams }: ManagePageProps) {
  const params = await searchParams;
  const legacyToken = typeof params.token === "string" ? params.token : "";
  if (legacyToken) redirect(`/api/bookings/manage-link?token=${encodeURIComponent(legacyToken)}`);
  const hasManageCookie = Boolean((await cookies()).get(MANAGE_COOKIE_NAME)?.value);
  const paymentReturn = typeof params.payment === "string" ? params.payment : undefined;
  const packagePurchaseAdded = params.purchase === "added";
  const selectedReference = typeof params.selected === "string" ? params.selected : "";

  return (
    <>
      <PageHeader
        eyebrow="Your booking"
        title="My"
        accent="Booking."
        lead="View your lessons and payment status, reschedule an eligible lesson, or add lessons—all in one place."
      />
      <section className="bg-[#f7f7f3] pb-20 sm:pb-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-6">
          <Suspense
            fallback={
              <div
                role="status"
                className="grid min-h-[240px] place-items-center rounded-[20px] border border-line bg-white text-sm font-bold text-soft"
              >
                Loading…
              </div>
            }
          >
            <div className="rounded-[25px] border border-line bg-white p-6 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
              <BookingPortal
                hasManageCookie={hasManageCookie}
                paymentReturn={paymentReturn}
                packagePurchaseAdded={packagePurchaseAdded}
                selectedReference={selectedReference}
              />
              {!hasManageCookie && (
                <p className="mt-6 border-t border-line pt-5 text-[13px] leading-relaxed text-soft">
                  For your security, every My Booking visit requires email verification. Still stuck?{" "}
                  <a href="/contact" className="font-bold text-gold-deep underline-offset-4 hover:underline">Contact us</a> and we&rsquo;ll find your booking.
                </p>
              )}
            </div>
          </Suspense>
        </div>
      </section>
    </>
  );
}
