import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Vancouver, BC",
  description:
    "Personalized, one-on-one driving lessons and road-test preparation for learners in Vancouver, BC. See packages and ask about availability.",
  path: "/areas/vancouver",
});

export default function VancouverPage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
      <p className="text-sm font-bold uppercase tracking-widest text-emerald-800">Service area · British Columbia</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Driving lessons in Vancouver</h1>
      <p className="mt-6 text-lg leading-8 text-slate-700">
        Learners in Vancouver can book private driving instruction with Wisdom Driving Academy. Sessions focus on your learning goals, from developing foundational skills to building confidence for a road test.
      </p>
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ink">Personal instruction, practical progress</h2>
        <p className="mt-3 leading-7 text-slate-700">
          One-on-one coaching gives you dedicated time with your instructor and feedback on what to practise next. Tell us about your experience and priorities so we can help identify a suitable lesson or package.
        </p>
      </section>
      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold text-ink">Vancouver driving lesson FAQs</h2>
        <h3 className="mt-6 font-bold text-ink">What can I work on during a lesson?</h3>
        <p className="mt-2 leading-7 text-slate-700">Lessons can support beginner learning, skill development, and road-test preparation. Your instruction is tailored to your needs.</p>
        <h3 className="mt-6 font-bold text-ink">Are lessons private?</h3>
        <p className="mt-2 leading-7 text-slate-700">Yes. The academy describes its instruction as private, one-on-one coaching.</p>
        <h3 className="mt-6 font-bold text-ink">How can I check Vancouver scheduling?</h3>
        <p className="mt-2 leading-7 text-slate-700">Contact the academy before booking to confirm current availability and arrangements for your preferred location.</p>
      </section>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link className="rounded-full bg-ink px-6 py-3 font-bold text-white" href="/lessons">Compare lesson packages</Link>
        <Link className="rounded-full border border-ink px-6 py-3 font-bold text-ink" href="/contact">Ask about Vancouver availability</Link>
      </div>
    </article>
  );
}
