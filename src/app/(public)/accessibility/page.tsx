import { PageHeader } from "@/components/layout/page-header";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Website Accessibility",
  description:
    "Learn about the accessibility features and support available on Wisdom Driving Academy’s website and lesson booking service.",
  path: "/accessibility",
});

const commitments = [
  {
    title: "Keyboard first",
    text: "Every action — navigation, booking steps, forms and the FAQ — can be completed using only a keyboard, with a visible focus indicator.",
  },
  {
    title: "Respects reduced motion",
    text: "If your device requests reduced motion, animations are switched off automatically and content appears without movement.",
  },
  {
    title: "Readable contrast and type",
    text: "Text and controls are built to meet WCAG 2.1 AA contrast, with resizable type that works up to 200% browser zoom.",
  },
  {
    title: "Clear structure",
    text: "Semantic headings, labelled forms, descriptive alt text and ARIA states (such as open/closed accordions) help screen-reader users navigate.",
  },
] as const;

export default function AccessibilityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Built for"
        accent="everyone."
        lead="Our target is WCAG 2.1 Level AA — so any student can learn, book and manage lessons with confidence."
      />

      <section className="bg-white py-12 sm:py-16">
        <article className="mx-auto max-w-3xl px-5 sm:px-6">
          <p className="text-[13px] font-bold uppercase tracking-wider text-soft">
            Last updated: October 23, 2026
          </p>

          <div className="mt-8 space-y-9 text-[15.5px] leading-[1.8] text-[#4b525e]">
            <section>
              <h2 className="font-display text-[21px] font-extrabold text-ink sm:text-[24px]">
                Our commitment
              </h2>
              <div className="mt-3 space-y-3">
                <p>
                  Wisdom Driving Academy is committed to providing a website
                  that is accessible to the widest possible audience, regardless
                  of technology or ability. We aim to meet the Web Content
                  Accessibility Guidelines (WCAG) 2.1 Level AA, in line with
                  British Columbia&rsquo;s “Access by Design 2030” direction for
                  digital accessibility.
                </p>
                <p>
                  Accessibility is an ongoing effort: we review this site as we
                  add features, and we welcome reports of anything that gets in
                  your way.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-display text-[21px] font-extrabold text-ink sm:text-[24px]">
                What we build in
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {commitments.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[16px] border border-line bg-mist p-5"
                  >
                    <h3 className="font-display text-[15.5px] font-extrabold text-ink">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[14px] leading-[1.7] text-soft">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-display text-[21px] font-extrabold text-ink sm:text-[24px]">
                Known limitations
              </h2>
              <div className="mt-3 space-y-3">
                <p>
                  We are not yet aware of any accessibility barriers on this
                  site. If you find one — for example a colour contrast issue,
                  a control that is hard to reach by keyboard, or content that
                  is difficult to read with a screen reader — please tell us
                  using the{" "}
                  <a
                    href="/contact"
                    className="font-semibold text-gold-deep underline-offset-2 hover:underline"
                  >
                    contact page
                  </a>
                  .
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-display text-[21px] font-extrabold text-ink sm:text-[24px]">
                Alternative formats and support
              </h2>
              <div className="mt-3 space-y-3">
                <p>
                  If you need lesson information, booking confirmations or these
                  legal pages in another format (for example plain text or a
                  larger print), or if you need help completing a booking
                  another way, contact us and we will accommodate your request
                  at no extra cost.
                </p>
                <p>
                  We aim to acknowledge accessibility feedback within{" "}
                  <strong>5 business days</strong> and to resolve issues within{" "}
                  <strong>15 business days</strong>, or to agree on an
                  alternative timeline with you.
                </p>
              </div>
            </section>
          </div>

          <div className="mt-10 rounded-xl border border-line bg-mist p-5 text-[14.5px] leading-relaxed text-[#4b525e]">
            <strong className="text-ink">Report a barrier:</strong> use the{" "}
            <a href="/contact" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
              contact form
            </a>{" "}
            and mention “Accessibility” in your subject line.
          </div>
        </article>
      </section>
    </>
  );
}
