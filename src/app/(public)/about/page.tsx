import { PageHeader } from "@/components/layout/page-header";
import { CtaBanner } from "@/components/sections/cta-banner";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "About the Driving School",
  description:
    "Learn about Wisdom Driving Academy’s one-on-one approach to beginner instruction and practical driving skills in Burnaby, Vancouver and Richmond, BC.",
  path: "/about",
});

const expectations = [
  {
    title: "A plan built for you",
    text: "Your first lesson starts with an honest skills check, so every session focuses on what you actually need next.",
  },
  {
    title: "One instructor, full attention",
    text: "No sharing the wheel. Every lesson is private, so you progress at your own pace without pressure.",
  },
  {
    title: "Feedback after every lesson",
    text: "You finish each session knowing exactly what improved and what to practise before the next one.",
  },
  {
    title: "Learn on real roads",
    text: "Routes are matched to your level — quiet streets at first, then busy intersections, highways and test-area roads.",
  },
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="Wisdom Driving Academy"
        title="Learn with clarity."
        accent="Drive with confidence."
        lead="An approachable, one-on-one driving school built around the student — patient instruction, flexible scheduling and practical skills for BC roads."
      />

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 md:grid-cols-2 md:gap-14">
          <div>
            <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
              <span aria-hidden="true" className="h-0.5 w-5 bg-[#8ac155]" />
              The Wisdom approach
            </p>
            <h2 className="mt-4 font-display text-[clamp(32px,4vw,50px)] font-extrabold leading-[1.13] tracking-[-0.055em] text-ink">
              Driving is a life skill. We teach it properly.
            </h2>
            <div className="mt-6 space-y-4 text-[15px] leading-[1.85] text-soft">
              <p>
                Wisdom Driving Academy specializes in training beginners.
                Learning to drive can feel overwhelming, so our personalized
                coaching uses clear explanations, a calm instructor and a plan
                that adapts to how you learn best.
              </p>
              <p>
                From your very first session behind the wheel to the days before
                your road test, you build real-world skills — observation,
                judgement and confidence — not just test tricks.
              </p>
              <p>
                Every lesson is one-on-one, so there is never a queue for the
                wheel and never a rushed finish. You progress when you are
                ready, and you always know where you stand.
              </p>
            </div>

            <div
              role="note"
              className="mt-8 rounded-[16px] border border-[#d7e8cc] bg-[#eaf5df] p-5 text-[13px] leading-relaxed text-[#31543a]"
            >
              We provide lessons in Burnaby, Vancouver and Richmond, British
              Columbia.
            </div>
          </div>

          <div className="grid content-start gap-4">
            <h2 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
              What to expect
            </h2>
            {expectations.map((item, index) => (
              <article
                key={item.title}
                className="rounded-[23px] border border-line bg-[#f7f7f3] p-6 transition-colors duration-300 hover:border-[#bbd7ad]"
              >
                <span className="mb-3.5 block text-[12px] font-extrabold tracking-wide text-[#426a2c]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-[18px] font-extrabold tracking-[-0.04em] text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-[1.7] text-soft">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CtaBanner />
    </>
  );
}
