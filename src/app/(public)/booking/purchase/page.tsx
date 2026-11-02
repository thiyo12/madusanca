import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PackagePurchaseForm } from "@/components/booking/package-purchase-form";
import { getStore } from "@/lib/booking/store";
import { noIndexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexPageMetadata("Purchase lesson credits", "Purchase lesson credits and schedule sessions later.");
export const dynamic = "force-dynamic";

interface PurchasePageProps {
  searchParams: Promise<{ lesson?: string | string[] }>;
}

export default async function PackagePurchasePage({ searchParams }: PurchasePageProps) {
  const params = await searchParams;
  const lessonId = typeof params.lesson === "string" ? params.lesson : "";
  const lesson = (await getStore().getLessons()).find((item) => item.id === lessonId && item.category === "package");
  if (!lesson) notFound();
  return (
    <>
      <PageHeader eyebrow="Purchase lesson credits" title="Buy now, schedule" accent="when ready." lead="Your payment is for this package only. After payment is confirmed, schedule each lesson credit from My Booking." />
      <section className="bg-[#f7f7f3] px-5 pb-20 sm:px-6 sm:pb-24">
        <div className="mx-auto max-w-2xl"><PackagePurchaseForm lesson={lesson} /></div>
      </section>
    </>
  );
}
