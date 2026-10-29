import { PageHeader } from "@/components/layout/page-header";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { getStore } from "@/lib/booking/store";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Book a Driving Lesson",
  description:
    "Book a private driving lesson in Burnaby, Vancouver or Richmond, BC. Choose an available time and manage changes online.",
  path: "/booking",
});

// searchParams (?lesson= deep links) + store-backed catalogue → per request.
export const dynamic = "force-dynamic";

interface BookingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BookingPage({ searchParams }: BookingPageProps) {
  const [params, lessons] = await Promise.all([
    searchParams,
    getStore().getLessons(),
  ]);
  const rawLessonId = typeof params.lesson === "string" ? params.lesson : undefined;
  const initialLesson = rawLessonId ? lessons.find((l) => l.id === rawLessonId) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Book a lesson"
        title="Pick your lesson,"
        accent="then your time."
          lead="One-on-one instruction, Pacific Time scheduling, and private self-service changes up to 48 hours before your lesson."
      />
      <section className="bg-[#f7f7f3] pb-20 sm:pb-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-6">
          <BookingWizard
            lessons={lessons}
            initialLessonId={initialLesson?.id}
          />
        </div>
      </section>
    </>
  );
}
