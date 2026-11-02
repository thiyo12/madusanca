import Link from "next/link";
import { noIndexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexPageMetadata("Package purchase status", "Private package purchase status.");

interface PurchaseReturnPageProps {
  searchParams: Promise<{ payment?: string | string[] }>;
}

export default async function PurchaseReturnPage({ searchParams }: PurchaseReturnPageProps) {
  const params = await searchParams;
  const successfulReturn = params.payment === "success";
  return (
    <section className="bg-[#f7f7f3] px-5 py-16 sm:py-24">
      <div className="mx-auto max-w-2xl rounded-[25px] border border-line bg-white p-6 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-9">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#102a28] text-lg font-extrabold text-[#c2ee84]" aria-hidden="true">
          {successfulReturn ? "✓" : "↩"}
        </span>
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.04em] text-ink">
          {successfulReturn ? "Thanks — payment is being confirmed." : "Checkout was cancelled."}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-soft">
          {successfulReturn
            ? "Your lesson credits become available after Stripe confirms payment. Use My Booking with your email and verification code to view your purchases and schedule sessions."
            : "No credits were used. You can return to the lesson packages and try again whenever you’re ready."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={successfulReturn ? "/booking/manage" : "/lessons"} className="btn-gold inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[13px] font-extrabold">
            {successfulReturn ? "Open My Booking" : "Back to packages"}
          </Link>
          <Link href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5 text-[13px] font-extrabold text-ink hover:border-[#7baa54]">
            Contact the school
          </Link>
        </div>
      </div>
    </section>
  );
}
