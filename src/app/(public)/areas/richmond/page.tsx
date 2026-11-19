import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Richmond, BC",
  description:
    "One-on-one driving lessons and road-test preparation for learners in Richmond, BC. Find personalized instruction and contact Wisdom Driving Academy.",
  path: "/areas/richmond",
});

export default function RichmondPage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
      <p className="text-sm font-bold uppercase tracking-widest text-emerald-800">Service area · British Columbia</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Driving lessons in Richmond</h1>
      <p className="mt-6 text-lg leading-8 text-slate-700">
        Wisdom Driving Academy provides personalized, one-on-one driving lessons for learners in Richmond. Whether you are new to driving or preparing for a road test, lessons are focused on your experience and the skills you want to strengthen.
      </p>
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ink">Build skills at your own pace</h2>
        <p className="mt-3 leading-7 text-slate-700">
          Start with an honest assessment of what you already know, then use each session to work toward clear next steps. You can review available lesson formats and discuss the right option for your goals with the academy.
        </p>
      </section>
      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold text-ink">Richmond driving lesson FAQs</h2>
        <h3 className="mt-6 font-bold text-ink">Can lessons help me get ready for a road test?</h3>
        <p className="mt-2 leading-7 text-slate-700">Yes. The academy offers road-test preparation as part of its driving instruction.</p>
        <h3 className="mt-6 font-bold text-ink">Do I need driving experience before my first lesson?</h3>
        <p className="mt-2 leading-7 text-slate-700">No prior lesson experience is required. Instruction is beginner-focused and personalized.</p>
        <h3 className="mt-6 font-bold text-ink">How do I confirm lesson location and times?</h3>
        <p className="mt-2 leading-7 text-slate-700">Contact the academy to confirm current scheduling and arrangements for your preferred Richmond location.</p>
      </section>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link className="rounded-full bg-ink px-6 py-3 font-bold text-white" href="/lessons">Explore lesson packages</Link>
        <Link className="rounded-full border border-ink px-6 py-3 font-bold text-ink" href="/contact">Ask about Richmond availability</Link>
      </div>
    </article>
  );
}
