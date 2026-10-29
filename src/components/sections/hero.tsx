import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const highlights = [
  { icon: "↗", title: "Personalized instruction", detail: "Learn at your pace" },
  { icon: "◷", title: "Flexible scheduling", detail: "Designed for real life" },
  { icon: "✓", title: "Real-world skills", detail: "Build lasting confidence" },
] as const;

export function Hero() {
  return (
    <>
      <section className="relative flex min-h-[760px] items-center overflow-hidden bg-[#0b1b29] text-white sm:min-h-[780px] lg:min-h-[790px]">
        <Image
          src="/hero-landscape.webp"
          alt=""
          fill
          preload
          sizes="100vw"
          className="object-cover object-[62%_center] lg:object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,19,27,0.94)_0%,rgba(6,22,31,0.68)_52%,rgba(7,22,30,0.33)_100%),linear-gradient(0deg,rgba(4,17,24,0.78),transparent_56%)]"
        />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-14 pt-44 sm:px-6 sm:pb-20 sm:pt-48 lg:pb-24 lg:pt-52">
          <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#d8efd3] sm:text-[11px]">
            <span className="h-0.5 w-5 bg-[#c2ee84]" aria-hidden="true" />
            Learn with purpose. Drive with confidence.
          </p>
          <h1 className="mt-5 max-w-[940px] font-display text-[clamp(44px,8.5vw,94px)] font-extrabold leading-[1.04] tracking-[-0.055em]">
            The road to<br />
            <span className="text-[#c2ee84]">confidence</span><br />
            starts here.
          </h1>
          <p className="mt-6 max-w-[585px] text-[15px] leading-[1.8] text-[#dce7e8] sm:text-[17px]">
            A calmer, smarter way to learn to drive. One-on-one coaching and
            lessons built around your goals across Burnaby, Vancouver and
            Richmond, BC.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href="/booking" size="lg" className="w-full sm:w-auto">
              Book a driving lesson <span aria-hidden="true">↗</span>
            </Button>
            <Link
              href="/#how"
              className="inline-flex h-13 w-full items-center justify-center gap-3 rounded-full border border-white/55 bg-white/10 px-7 text-[14px] font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:w-auto"
            >
              How it works <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <ul className="mt-14 flex flex-wrap gap-x-9 gap-y-5 sm:mt-20">
            {highlights.map((item) => (
              <li key={item.title} className="flex items-center gap-3.5">
                <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full border border-white/40 text-lg text-[#c2ee84]">
                  {item.icon}
                </span>
                <span className="text-[12px] font-bold leading-tight">
                  {item.title}
                  <small className="mt-1 block text-[10px] font-medium text-[#bdccce]">{item.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="border-b border-[#d9e9d0] bg-[#e9f4df]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#31543a] sm:text-[12px]">
            The next chapter starts behind the wheel.
          </p>
          <Link href="/#lessons" className="text-[12px] font-extrabold text-[#31543a] underline underline-offset-4 hover:text-[#173c23]">
            Find your learning path ↗
          </Link>
        </div>
      </div>
    </>
  );
}
