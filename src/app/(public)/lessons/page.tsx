import { PageHeader } from "@/components/layout/page-header";
import { LessonGrid } from "@/components/ui/lesson-grid";
import { Button } from "@/components/ui/button";
import { getStore } from "@/lib/booking/store";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lesson Packages in Metro Vancouver",
  description:
    "Compare private 90-minute driving lessons, multi-lesson packages and road-test preparation from Wisdom Driving Academy in British Columbia.",
  path: "/lessons",
});

export const dynamic = "force-dynamic";

export default async function LessonsPage() {
  const catalogue = await getStore().getLessons();
  const packageLessons = catalogue.filter((lesson) => lesson.category === "package");
  const moduleLessons = catalogue.filter((lesson) => lesson.category === "module");
  return (
    <>
      <PageHeader
        eyebrow="Driving lessons & packages"
        title="Find your perfect"
        accent="next step."
        lead="One instructor. One-on-one attention. Select your lesson and reserve a time that works for you."
      />

      <section className="bg-[#f7f7f3] py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <h2 className="mb-7 text-[12px] font-extrabold uppercase tracking-[0.16em] text-[#426a2c]">
            Lesson packages
          </h2>
          <LessonGrid lessons={packageLessons} ariaLabel="Lesson packages" />

          {moduleLessons.length > 0 && (
            <>
              <h2 className="mb-7 mt-16 text-[12px] font-extrabold uppercase tracking-[0.16em] text-[#426a2c]">
                Skill modules
              </h2>
              <LessonGrid lessons={moduleLessons} ariaLabel="Skill modules" />
            </>
          )}

          <div
            role="note"
            className="mt-11 rounded-[18px] border border-[#d7e8cc] bg-[#eaf5df] p-5 text-[13px] leading-[1.75] text-[#31543a]"
          >
            Prices are in CAD and GST is added. Bookings for the 5- and 8-lesson
            packs reserve the first 90-minute lesson; the school will coordinate
            the remaining sessions. A road-test package booking reserves the
            45-minute mock test; test-day pickup and car rental are confirmed
            with the school. Payment is arranged directly with the school.
          </div>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-5 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-display text-[26px] font-extrabold tracking-[-0.05em] text-ink sm:text-[34px]">
              Not sure which lesson fits?
            </h2>
            <p className="mt-1.5 text-[15px] text-soft">
              Tell us your experience level and we&rsquo;ll guide you to the
              right option.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/contact" variant="outline">
              Ask a question
            </Button>
            <Button href="/booking">
              Book a lesson <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
