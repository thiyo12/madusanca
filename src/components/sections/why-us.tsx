import Image from "next/image";
import { Button } from "@/components/ui/button";

const benefits = [
  "One-on-one instruction at your pace",
  "Practical skills for everyday BC driving",
  "Focused preparation for your road test",
] as const;

export function WhyUs() {
  return (
    <section id="about" className="scroll-mt-12 bg-white py-20 sm:py-24 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div className="relative min-h-[350px] overflow-hidden rounded-[25px] bg-ink sm:min-h-[450px] lg:min-h-[540px]">
          <Image
            src="/driving-lesson.jpg"
            alt="Driver practising on a city road with hands on the steering wheel"
            fill
            sizes="(max-width: 1023px) 100vw, 50vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b1b29]/45 via-transparent to-transparent" aria-hidden="true" />
          <div className="absolute bottom-5 left-5 right-5 rounded-[17px] bg-white/95 p-5 backdrop-blur-sm sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-[340px] sm:p-6">
            <p className="font-display text-[17px] font-extrabold leading-[1.35] text-ink sm:text-[19px]">
              Drive with clarity. Learn with confidence.
            </p>
            <p className="mt-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-soft">
              Personalized driving education
            </p>
          </div>
        </div>

        <div>
          <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
            <span aria-hidden="true" className="h-0.5 w-5 bg-[#8ac155]" />
            A better driving experience
          </p>
          <h2 className="mt-4 max-w-[600px] font-display text-[clamp(32px,4vw,53px)] font-extrabold leading-[1.11] tracking-[-0.055em] text-ink">
            Good driving starts with great guidance.
          </h2>
          <p className="mt-5 max-w-[520px] text-[15px] leading-[1.9] text-soft">
            Learning to drive is a milestone. Our patient, beginner-focused
            approach is built around meaningful progress — from your first
            lesson to more confident journeys on real BC roads.
          </p>
          <ul className="mt-8 grid gap-4">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-3 text-[13px] font-extrabold text-ink">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e5f6d6] text-[#406b29]">✓</span>
                {benefit}
              </li>
            ))}
          </ul>
          <Button href="/about" variant="dark" className="mt-9">
            About Wisdom <span aria-hidden="true">↗</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
