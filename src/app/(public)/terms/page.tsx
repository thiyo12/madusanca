import { PageHeader } from "@/components/layout/page-header";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Lesson Policy and Booking Terms",
  description:
    "Review cancellation, rescheduling, refund, road-test and student policies for Wisdom Driving Academy in British Columbia.",
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
    heading: "Student responsibilities",
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
            certificate or PR card). Temporary residents must also bring their
            work or study permit;
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
        All students must be registered and payment must be arranged in advance,
        no later than the first lesson. Prices are listed in Canadian dollars
        (CAD); applicable taxes are added where required by law. Any payment
        options available for a booking are shown during checkout.
      </p>
    ),
  },
  {
    heading: "Cancellations and rescheduling",
    body: (
      <>
        <p>
          Cancellations must be requested at least <strong>48 hours</strong>
          before the scheduled lesson to avoid a cancellation fee. Contact the
          school by email, phone or text. Online rescheduling is available for
          each individual session until 48 hours before that session. Use the
          private management link in your confirmation email or choose{" "}
          <a href="/booking/manage" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
            My Booking
          </a>{" "}
          and verify your booking email. Requests made within 48 hours may incur
          a cancellation fee. A no-show is charged for that lesson.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Changes requested within 48 hours must be arranged with the
            instructor by phone, email or text.
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
          A refund for unused lessons may be requested if the school receives
          notice at least 48 hours before the next scheduled lesson. A
          cancellation fee may apply to a refund request made within 48 hours.
        </li>
        <li>
          Completed lessons are final sale and non-refundable. A road-test
          result does not qualify for a refund. Lessons are non-transferable.
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
    heading: "General and road-test policies",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Students must bring their valid licence (Class 7L, 7N, 5 or
          equivalent) to every lesson. Lessons where a licence is not brought
          may be charged and are not refundable.
        </li>
        <li>Wear proper footwear. Heels and flip-flops are not permitted.</li>
        <li>
          Each regular driving lesson is 90 minutes, including pickup, drop-off,
          manoeuvre explanations and questions and answers.
        </li>
        <li>
          The school may cancel or reschedule for unforeseen circumstances,
          including instructor illness, vehicle problems or unsafe road
          conditions. We will notify you as soon as possible and arrange a new
          lesson time.
        </li>
        <li>
          The school may cancel a lesson without refund if a student is
          suspected of being under the influence of alcohol or drugs, or uses
          foul, abusive or aggressive language.
        </li>
        <li>
          A road-test package includes a 45-minute mock test and car rental. If
          a person who is not a Wisdom Driving Academy student requests a rental,
          a driving-skills assessment of at least 90 minutes is required and is
          charged at the regular 90-minute lesson rate.
        </li>
        <li>All package lessons must be booked within six months.</li>
        <li>
          One parent may attend the first lesson at no charge. An additional
          passenger on later lessons is subject to a $20 fee per lesson. With
          the student&rsquo;s prior consent, the school may also have a passenger
          in the vehicle for training purposes.
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
        eyebrow="Customer policy"
        title="Lesson policies,"
        accent="clearly explained."
        lead="Cancellation, refund, lesson and road-test rules for Wisdom Driving Academy students."
      />

      <section className="bg-white py-12 sm:py-16">
        <article className="mx-auto max-w-3xl px-5 sm:px-6">
          <p className="text-[13px] font-bold uppercase tracking-wider text-soft">
            Last updated: November 4, 2026
          </p>

          <div className="mt-8 space-y-9">
            {sections.map((section) => (
              <section key={section.heading} id={section.heading === "Cancellations and rescheduling" ? "cancellations" : undefined}>
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
