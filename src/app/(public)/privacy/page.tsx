import { PageHeader } from "@/components/layout/page-header";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Privacy Policy",
  description:
    "Read how Wisdom Driving Academy handles personal information for driving lesson bookings and messages in British Columbia and Canada.",
  path: "/privacy",
});

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        Wisdom Driving Academy (“we”, “us”, “our”) is a driving school based in
        British Columbia, Canada. This policy explains what personal information
        we collect, why we collect it, and the choices you have. We follow
        British Columbia&rsquo;s <em>Personal Information Protection Act</em>{" "}
        (PIPA) and, where applicable, Canada&rsquo;s{" "}
        <em>Personal Information Protection and Electronic Documents Act</em>{" "}
        (PIPEDA).
      </p>
    ),
  },
  {
    heading: "What we collect",
    body: (
      <>
        <p>When you book a lesson or contact us, we collect only what we need:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Booking details:</strong> first name, last name, full legal
            name, email address, phone number, licence class, pickup street
            address, lesson notes you choose to share, and booking history
            (lesson type, date and time).
          </li>
          <li>
            <strong>Contact messages:</strong> anything you send through our
            contact form, including your name, email, and optionally your phone
            number.
          </li>
          <li>
            <strong>Technical data:</strong> basic server logs (IP address,
            browser type, and request times) used for security and abuse
            prevention.
          </li>
        </ul>
        <p>
          We do not collect driver&rsquo;s licence numbers, dates of birth,
          gender, payment card numbers (in this release), health information, or
          precise geolocation through the online booking form. Please bring
          your valid licence to your lesson.
        </p>
      </>
    ),
  },
  {
    heading: "Why we use it",
    body: (
      <>
        <p>We use your personal information to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Schedule, confirm and manage your driving lessons;</li>
          <li>
            Give you a private link or email-verified access to view and manage
            your own booking;
          </li>
          <li>Respond to questions you send us;</li>
          <li>
            Send booking-related emails (confirmations, verification codes,
            changes and cancellations);
          </li>
          <li>Keep basic business records as required by law; and</li>
          <li>Protect our website from spam and abuse.</li>
        </ul>
        <p>
          We rely on your consent — given when you submit a booking or message —
          and on legitimate business needs to provide the service you asked for.
          We do <strong>not</strong> sell, rent or trade your personal
          information.
        </p>
      </>
    ),
  },
  {
    heading: "Who we share it with",
    body: (
      <p>
        Your information is shared only where needed to run the school: the
        instructor delivering your lesson, and our service providers who host
        our website, database and email delivery systems. These providers may
        only process information on our instructions and are contractually
        expected to protect it. We disclose information to a third party when
        required by law.
      </p>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <p>
        Booking records are kept for up to <strong>two years</strong> after your
        last lesson, then deleted or made anonymous, unless the law requires a
        longer period. Contact-form messages are kept for up to{" "}
        <strong>twelve months</strong>. You can ask us to delete your information
        sooner (see your rights below).
      </p>
    ),
  },
  {
    heading: "How we protect it",
    body: (
      <p>
        We use industry-standard safeguards: encryption in transit (HTTPS),
        access restricted to the people who need it, password-protected
        accounts, and database rules that prevent public access to stored
        records. No system is perfectly secure, but we review our safeguards
        regularly.
      </p>
    ),
  },
  {
    heading: "Cookies",
    body: (
      <p>
        This release uses only cookies and storage that are strictly necessary
        for the site to work (for example, keeping you signed in on the admin
        area). If we add optional analytics later, we will update this policy
        and ask for consent where required.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <p>
        You may request access to the personal information we hold about you,
        ask us to correct inaccurate information, and withdraw your consent to
        processing at any time. Email us using the contact details on our{" "}
        <a href="/contact" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
          contact page
        </a>
        . We will respond within a reasonable time, and no later than 30 days.
        If you are not satisfied, you may contact the Office of the Information
        and Privacy Commissioner for British Columbia, or the Office of the
        Privacy Commissioner of Canada (for PIPEDA matters).
      </p>
    ),
  },
  {
    heading: "Changes to this policy",
    body: (
      <p>
        We may update this policy as our practices change. The “last updated”
        date below always reflects the current version, and material changes
        will be highlighted on this page.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Your privacy,"
        accent="clearly explained."
        lead="What we collect, why we need it, and the control you keep over it."
      />

      <section className="bg-white py-12 sm:py-16">
        <article className="mx-auto max-w-3xl px-5 sm:px-6">
          <p className="text-[13px] font-bold uppercase tracking-wider text-soft">
            Last updated: October 25, 2026
          </p>

          <div className="mt-8 space-y-9">
            {sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-display text-[21px] font-extrabold text-ink sm:text-[24px]">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3 text-[15.5px] leading-[1.8] text-[#4b525e]">
                  {section.body}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-line bg-mist p-5 text-[14.5px] leading-relaxed text-[#4b525e]">
            <strong className="text-ink">Questions?</strong> Contact us through
            the{" "}
            <a href="/contact" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
              contact page
            </a>{" "}
            and we will be happy to explain how your information is handled.
          </div>
        </article>
      </section>
    </>
  );
}
