import { Hero } from "@/components/sections/hero";
import { LessonsPreview } from "@/components/sections/lessons-preview";
import { HowItWorks } from "@/components/sections/how-it-works";
import { WhyUs } from "@/components/sections/why-us";
import { Faq } from "@/components/sections/faq";
import { CtaBanner } from "@/components/sections/cta-banner";
import { getStore } from "@/lib/booking/store";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { BusinessJsonLd } from "@/components/seo/business-json-ld";
import Link from "next/link";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Metro Vancouver, BC",
  description:
    "One-on-one driving lessons, beginner coaching and road-test preparation in Burnaby, Vancouver and Richmond, British Columbia.",
  path: "/",
});

// The catalogue comes from the store (editable in the admin) — render per request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const catalogue = await getStore().getLessons();
  const packages = catalogue.filter((lesson) => lesson.category === "package");

  return (
    <>
      <BusinessJsonLd />
      <Hero />
      <section aria-labelledby="service-areas-title" className="bg-[#f7f8f5] py-14 sm:py-18">
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <h2 id="service-areas-title" className="font-display text-3xl font-extrabold text-ink">
            Driving lessons across Metro Vancouver
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-slate-700">
            Explore information about one-on-one lessons and road-test preparation in each of our confirmed service areas.
          </p>
          <ul className="mt-6 flex flex-wrap gap-3">
            {[
              { name: "Driving lessons in Burnaby", href: "/areas/burnaby" },
              { name: "Driving lessons in Vancouver", href: "/areas/vancouver" },
              { name: "Driving lessons in Richmond", href: "/areas/richmond" },
            ].map((area) => (
              <li key={area.href}>
                <Link className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-5 font-bold text-ink hover:border-emerald-800" href={area.href}>
                  {area.name} <span aria-hidden="true" className="ml-2">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <LessonsPreview lessons={packages} />
      <HowItWorks />
      <WhyUs />
      <Faq />
      <CtaBanner />
    </>
  );
}
