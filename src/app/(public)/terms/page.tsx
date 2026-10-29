import { PageHeader } from "@/components/layout/page-header";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Lesson Booking Terms",
  description:
    "Review lesson booking, payment, rescheduling, cancellation and refund terms for Wisdom Driving Academy in British Columbia.",
  path: "/terms",
});

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Acceptance of these terms",
    body: (
      <p>
        These terms apply when you book a lesson with Wisdom Driving Academy
        (“we”, “us”, “our”) through our website. By completing a booking you
        agree to these terms and to our{" "}
        <a href="/privacy" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
          Privacy Policy
        </a>
        . If you do not agree, please do not complete a booking.
      </p>
    ),
  },
  {
    heading: "Our services",
    body: (
      <p>
        We provide private (one-on-one) driving instruction in British Columbia.
        Lesson content, duration and price are shown on the{" "}
        <a href="/lessons" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
          lessons page
        </a>{" "}
        at the time of booking. We may update lesson options, prices and
        availability from time to time; the details shown during your booking
        are the ones that apply to that booking.
      </p>
    ),
  },
  {
    heading: "Booking and confirmation",
    body: (
      <>
        <p>
          Bookings are made without creating an account. A booking is held for
          you once you receive a booking reference and confirmation. Use the
          private management link in your email, or choose My Booking on the
          website and verify your email with a one-time code to view or change
          your booking. Do not share a management link or verification code.
        </p>
        <p>
          Availability shown online is checked when you book, but exceptional
          circumstances may occasionally require us to move or cancel a lesson.
          If that happens, we will contact you as soon as possible and
          reschedule the lesson.
        </p>
      </>
    ),
  },
  {
    heading: "Your responsibilities as a student",
    body: (
      <>
        <p>To take in-car lessons you must:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Bring your valid driver&rsquo;s licence (for example, Class 7L, 7N or 5)
            to every lesson;
          </li>
          <li>
            Follow all traffic laws and your instructor&rsquo;s directions at
            all times;
          </li>
          <li>
            Be fit to drive — free from alcohol, drugs or any condition that
            would make driving unsafe;
          </li>
          <li>
            Arrive ready for your lesson, at the agreed pickup area and time;
          </li>
          <li>Wear suitable footwear; heels and flip-flops are not permitted;</li>
          <li>
            For a road test, bring your driving licence and two pieces of valid
            government-issued identification (for example, a passport, birth
            certificate, PR card or work/study permit);
          </li>
          <li>
            Disclose any medical condition, disability or accessibility need
            that may affect driving, so we can discuss reasonable arrangements.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "Fees, payment and taxes",
    body: (
      <p>
        Prices are listed in Canadian dollars (CAD). Payment is arranged
        directly with the school (for example e-transfer, card or in person) —
        this website does not take online payment in this release. Applicable
        taxes are added where required by law. A lesson is only confirmed once
        its payment/arrangement terms with the school are satisfied.
      </p>
    ),
  },
  {
    heading: "Rescheduling and cancellation",
    body: (
      <>
        <p>
          Please cancel or reschedule at least <strong>48 hours</strong> before
          the agreed lesson time to avoid a cancellation fee. Use the private
          management link in your confirmation email or choose{" "}
          <a href="/booking/manage" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
            My Booking
          </a>{" "}
          and verify your booking email. Requests made within 48 hours, and
          missed lessons, may incur a cancellation fee.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Online self-service changes are available until 48 hours before the
            lesson; contact the school about a later change or emergency.
          </li>
          <li>
            If we cancel or move your lesson, you always receive a new time or a
            rescheduled appointment.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "Refunds",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Refunds for unused lessons in a package may be requested if the school
          receives notice at least 48 hours before the next scheduled lesson.
          A cancellation fee may apply to requests made within 48 hours.
        </li>
        <li>
          A completed lesson is final sale; a road-test result does not qualify
          for a refund. Purchased lessons are non-transferable.
        </li>
      </ul>
    ),
  },
  {
    heading: "Safety",
    body: (
      <p>
        Your instructor may pause, re-route or end a lesson if driving would be
        unsafe (for example severe weather, mechanical concern, or unsafe
        behaviour). In that case we will contact you to arrange another time.
        Road conditions across BC change quickly — winter lessons may be
        adjusted for safety.
      </p>
    ),
  },
  {
    heading: "General policies",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Students must be registered and payment arrangements made no later
          than the first lesson.
        </li>
        <li>
          The school may cancel or reschedule for unforeseen circumstances,
          including instructor illness, vehicle problems or unsafe road
          conditions. We will notify you as soon as possible and arrange a new
          lesson time.
        </li>
        <li>
          The instructor may end a lesson without refund if a student is
          suspected of being under the influence of alcohol or drugs, or uses
          abusive or aggressive language.
        </li>
        <li>
          Lessons where the student does not bring a valid licence or suitable
          footwear may be treated as a late cancellation and may incur a fee.
        </li>
      </ul>
    ),
  },
  {
    heading: "No guarantee of licensing",
    body: (
      <p>
        We teach driving skills and prepare you for your road test, but we
        cannot guarantee that you will pass any ICBC knowledge or road test, or
        obtain a licence within a particular time frame. Test outcomes depend on
        factors outside our control.
      </p>
    ),
  },
  {
    heading: "Independent school — no ICBC affiliation",
    body: (
      <p>
        Wisdom Driving Academy is an independent driving school. Unless we
        state otherwise in writing, we are not affiliated with, sponsored by, or
        endorsed by ICBC or the Government of British Columbia, and references
        to licences or road tests are for general information only.
      </p>
    ),
  },
  {
    heading: "Liability",
    body: (
      <p>
        Lessons are conducted in vehicles maintained for instruction and,
        where the vehicle is so equipped, with dual controls. To the fullest
        extent permitted by British Columbia law, our liability for any claim
        related to a lesson is limited to the amount you paid for that lesson.
        Nothing in these terms excludes liability that cannot be excluded under
        BC law, including liability for gross negligence. You remain responsible
        for your own driving actions outside of instructed lessons.
      </p>
    ),
  },
  {
    heading: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of British Columbia, Canada. Any
        dispute will first be addressed in good faith between the parties; if it
        cannot be resolved, the courts of British Columbia will have
        jurisdiction.
      </p>
    ),
  },
  {
    heading: "Changes to these terms",
    body: (
      <p>
        We may update these terms as our services change. The version published
        on this page at the time of your booking applies to that booking.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Clear terms,"
        accent="fair rules."
        lead="Everything you need to know about booking, rescheduling and your rights as a student."
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
            <strong className="text-ink">Questions about these terms?</strong>{" "}
            Reach us through the{" "}
            <a href="/contact" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
              contact page
            </a>
            .
          </div>
        </article>
      </section>
    </>
  );
}
