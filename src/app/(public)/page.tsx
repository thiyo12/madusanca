import { Hero } from "@/components/sections/hero";
import { LessonsPreview } from "@/components/sections/lessons-preview";
import { HowItWorks } from "@/components/sections/how-it-works";
import { WhyUs } from "@/components/sections/why-us";
import { Faq } from "@/components/sections/faq";
import { CtaBanner } from "@/components/sections/cta-banner";
import { getStore } from "@/lib/booking/store";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { BusinessJsonLd } from "@/components/seo/business-json-ld";

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
      <LessonsPreview lessons={packages} />
      <HowItWorks />
      <WhyUs />
      <Faq />
      <CtaBanner />
    </>
  );
}
