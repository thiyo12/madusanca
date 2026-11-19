import Link from "next/link";
import { headers } from "next/headers";

type LocalAreaPageProps = {
  city: "Burnaby" | "Vancouver" | "Richmond";
  intro: string;
  focusTitle: string;
  focusText: string;
  faqs: { question: string; answer: string }[];
};

export async function LocalAreaPage({
  city,
  intro,
  focusTitle,
  focusText,
  faqs,
}: LocalAreaPageProps) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = process.env.NEXT_PUBLIC_CANONICAL_ORIGIN?.replace(/\/+$/, "");
  const businessId = origin ? `${origin}/#business` : undefined;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Driving lessons in ${city}, BC`,
    serviceType: ["One-on-one driving lessons", "Road-test preparation"],
    areaServed: { "@type": "City", name: city },
    provider: businessId ? { "@id": businessId } : { "@type": "Organization", name: "Wisdom Driving Academy" },
    url: origin ? `${origin}/areas/${city.toLowerCase()}` : undefined,
    description: `Private, personalized driving lessons and road-test preparation for learners in ${city}, British Columbia.`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <article>
        <header className="relative isolate overflow-hidden bg-[#0b1b29] text-white">
          <div aria-hidden="true" className="absolute -right-20 -top-28 -z-10 h-[430px] w-[430px] rounded-full border border-white/10 sm:right-8 sm:top-[-210px] sm:h-[620px] sm:w-[620px]" />
          <div aria-hidden="true" className="absolute bottom-[-160px] right-[18%] -z-10 h-[330px] w-[330px] rounded-full bg-[#c7f08d]/10 blur-3xl" />
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:py-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#c7f08d]">
                <span aria-hidden="true">⌖</span> Serving {city}, British Columbia
              </p>
              <h1 className="mt-6 max-w-3xl font-display text-[clamp(42px,7vw,76px)] font-extrabold leading-[0.99] tracking-[-0.06em]">
                Driving lessons in <span className="text-[#c7f08d]">{city}</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/75 sm:text-xl">
                {intro}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/lessons"
                  className="inline-flex min-h-13 items-center justify-center rounded-xl bg-[#c7f08d] px-7 py-3.5 font-extrabold text-[#0b1b29] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c7f08d]"
                >
                  Explore lesson packages <span aria-hidden="true" className="ml-2">↗</span>
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex min-h-13 items-center justify-center rounded-xl border border-white/35 px-7 py-3.5 font-bold text-white transition-colors hover:border-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c7f08d]"
                >
                  Ask about {city} lessons
                </Link>
              </div>
              <p className="mt-5 text-sm text-white/60">
                Confirm current lesson availability and location arrangements with the academy.
              </p>
            </div>

            <aside className="rounded-[28px] border border-white/15 bg-white/[0.07] p-6 backdrop-blur sm:p-8" aria-label="Lesson highlights">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#c7f08d]">A clear next step</p>
              <h2 className="mt-3 font-display text-2xl font-extrabold sm:text-3xl">Learn with a plan built around you.</h2>
              <ul className="mt-7 grid gap-4">
                {[
                  ["01", "Private, one-on-one instruction"],
                  ["02", "Beginner-focused coaching"],
                  ["03", "Road-test preparation"],
                  ["04", "Feedback on what to practise next"],
                ].map(([number, label]) => (
                  <li key={number} className="flex items-center gap-4 border-t border-white/15 pt-4">
                    <span className="font-display text-sm font-extrabold text-[#c7f08d]">{number}</span>
                    <span className="font-semibold text-white/90">{label}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </header>

        <section className="bg-[#f7f8f5] py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">Personalized coaching</p>
              <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{focusTitle}</h2>
            </div>
            <div>
              <p className="text-base leading-8 text-slate-700 sm:text-lg">{focusText}</p>
              <p className="mt-5 leading-7 text-slate-600">
                Start by sharing your experience and what you want help with. The academy can discuss a suitable lesson option and confirm scheduling for your preferred location.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">Good to know</p>
              <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                {city} driving lesson FAQs
              </h2>
              <p className="mt-4 leading-7 text-slate-600">
                Have a question not covered here? Contact the academy and get details for your situation.
              </p>
              <Link href="/contact" className="mt-6 inline-flex min-h-11 items-center font-bold text-emerald-900 underline decoration-emerald-700 underline-offset-4 hover:text-ink">
                Contact Wisdom Driving Academy <span aria-hidden="true" className="ml-2">↗</span>
              </Link>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map(({ question, answer }) => (
                <details key={question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-display text-lg font-bold text-ink marker:hidden [&::-webkit-details-marker]:hidden">
                    {question}
                    <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf3e8] text-xl transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="max-w-3xl pt-4 leading-7 text-slate-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#c7f08d] px-5 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-950">Ready when you are</p>
              <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-[#0b1b29] sm:text-4xl">
                Take your next step in {city}.
              </h2>
            </div>
            <Link href="/booking" className="inline-flex min-h-13 items-center justify-center rounded-xl bg-[#0b1b29] px-7 py-3.5 font-extrabold text-white transition-colors hover:bg-[#18394a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b1b29]">
              Start booking <span aria-hidden="true" className="ml-2">↗</span>
            </Link>
          </div>
        </section>
      </article>
    </>
  );
}
