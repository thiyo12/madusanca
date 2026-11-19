import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Burnaby, BC",
  description:
    "Private, one-on-one driving lessons and road-test preparation for learners in Burnaby, BC. Explore lesson packages and contact Wisdom Driving Academy.",
  path: "/areas/burnaby",
});

export default function BurnabyPage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
      <p className="text-sm font-bold uppercase tracking-widest text-emerald-800">Service area · British Columbia</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Driving lessons in Burnaby</h1>
      <p className="mt-6 text-lg leading-8 text-slate-700">
        Wisdom Driving Academy offers one-on-one driving instruction for learners in Burnaby. Lessons are beginner-focused and personalized to your experience, with practical coaching to help you build confidence and prepare for a road test.
      </p>
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ink">A lesson shaped around your goals</h2>
        <p className="mt-3 leading-7 text-slate-700">
          Whether you are starting out or want focused practice before a road test, instruction is tailored to the skills you want to develop. Ask about availability and arrangements for your preferred lesson location when booking.
        </p>
      </section>
      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold text-ink">Burnaby driving lesson FAQs</h2>
        <h3 className="mt-6 font-bold text-ink">Are lessons available for beginners?</h3>
        <p className="mt-2 leading-7 text-slate-700">Yes. The school offers beginner-focused, private instruction and adapts coaching to your current experience.</p>
        <h3 className="mt-6 font-bold text-ink">Can I prepare for a road test?</h3>
        <p className="mt-2 leading-7 text-slate-700">Yes. Road-test preparation is available. Contact the school to discuss your goals and scheduling.</p>
        <h3 className="mt-6 font-bold text-ink">How do I confirm availability in Burnaby?</h3>
        <p className="mt-2 leading-7 text-slate-700">Choose a package and contact the school to confirm lesson availability and location arrangements before booking.</p>
      </section>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link className="rounded-full bg-ink px-6 py-3 font-bold text-white" href="/lessons">View lesson packages</Link>
        <Link className="rounded-full border border-ink px-6 py-3 font-bold text-ink" href="/contact">Ask about Burnaby availability</Link>
      </div>
    </article>
  );
}
