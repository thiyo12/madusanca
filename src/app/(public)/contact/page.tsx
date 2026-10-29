import { PageHeader } from "@/components/layout/page-header";
import { ContactForm } from "@/components/forms/contact-form";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Contact & Lesson Enquiries",
  description:
    "Contact Wisdom Driving Academy about lesson availability, booking questions and service in Burnaby, Vancouver and Richmond, British Columbia.",
  path: "/contact",
});

const channels = [
  {
    label: "Phone",
    value: "+1 236-234-3229",
    note: "Shan — call or text",
    href: "tel:+12362343229",
  },
  {
    label: "Email",
    value: "info@wisdomdrivingacademy.com",
    note: "We aim to reply within 1–2 business days",
    href: "mailto:info@wisdomdrivingacademy.com",
  },
  {
    label: "Service area",
    value: "Burnaby · Vancouver · Richmond",
    note: "British Columbia",
  },
  {
    label: "Hours",
    value: "Mon – Sat",
    note: "Exact hours confirmed at launch",
  },
] as const;

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Wisdom Driving Academy"
        title="Let’s talk about"
        accent="your next lesson."
        lead="Questions about lessons, availability or which package fits? Send us a message and we’ll reply within one to two business days."
      />

      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 md:grid-cols-[1fr_1.3fr] md:gap-14">
          <div>
            <h2 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
              Reach us
            </h2>
            <div className="mt-5 grid gap-3.5">
              {channels.map((channel) => (
                <div
                  key={channel.label}
                  className="rounded-[20px] border border-line bg-[#f7f7f3] p-5 sm:p-6"
                >
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-soft">
                    {channel.label}
                  </p>
                  {"href" in channel ? (
                    <a href={channel.href} className="mt-1.5 block break-words font-display text-[17px] font-extrabold text-ink hover:text-[#426a2c]">
                      {channel.value}
                    </a>
                  ) : (
                    <p className="mt-1.5 font-display text-[17px] font-extrabold text-ink">
                      {channel.value}
                    </p>
                  )}
                  <p className="mt-0.5 text-[12.5px] text-soft">
                    {channel.note}
                  </p>
                </div>
              ))}
            </div>

          </div>

          <div className="rounded-[25px] border border-line bg-white p-6 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
            <h2 className="font-display text-[22px] font-extrabold text-ink sm:text-[26px]">
              Send a message
            </h2>
            <p className="mt-1.5 text-sm text-soft">
              Fields marked * are required.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
