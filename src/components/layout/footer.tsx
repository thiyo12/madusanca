import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const quickLinks = [
  { href: "/", label: "Home" },
  { href: "/lessons", label: "Lesson Packages" },
  { href: "/booking", label: "Book a Lesson" },
  { href: "/booking/manage", label: "My Booking" },
  { href: "/terms", label: "Lesson Terms" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/contact", label: "Contact" },
] as const;

const serviceAreas = ["Burnaby", "Vancouver", "Richmond"] as const;

const socialLinks = [
  { label: "Google", href: process.env.NEXT_PUBLIC_SOCIAL_GOOGLE_URL },
  { label: "Instagram", href: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL },
  { label: "Facebook", href: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK_URL },
  { label: "YouTube", href: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE_URL },
].filter((link): link is { label: string; href: string } => Boolean(link.href));

export function Footer() {
  return (
    <footer className="mt-auto bg-[#0b1b29] text-[#b9cbd0]">
      <div className="mx-auto max-w-7xl px-5 pb-7 pt-16 sm:px-6 md:pt-20">
        <div className="grid gap-10 sm:grid-cols-2 xl:grid-cols-[1.55fr_0.9fr_0.9fr_1.15fr] xl:gap-14">
          <div>
            <Logo />
            <p className="mt-3 max-w-[315px] text-[13px] leading-[1.85]">
              Beginner-focused driving instruction with personalized coaching
              to build confidence, safe driving skills and road-test readiness.
            </p>
            {socialLinks.length > 0 && (
              <nav aria-label="Social media" className="mt-5 flex flex-wrap gap-2.5">
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/30 px-3.5 py-1.5 text-[11px] font-bold transition-colors hover:border-[#c2ee84] hover:text-[#c2ee84]"
                  >
                    {social.label}
                  </a>
                ))}
              </nav>
            )}
          </div>

          <nav aria-label="Quick links">
            <h2 className="font-display text-[14px] font-extrabold text-white">Quick Links</h2>
            <ul className="mt-5 grid gap-2.5 text-[13px]">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition-colors hover:text-[#c2ee84]">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Service areas">
            <h2 className="font-display text-[14px] font-extrabold text-white">Service Areas</h2>
            <ul className="mt-5 grid gap-3 text-[13px]">
              {serviceAreas.map((area) => (
                <li key={area} className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="text-[#c2ee84]">⌖</span>
                  {area}
                </li>
              ))}
            </ul>
          </nav>

          <address className="not-italic">
            <h2 className="font-display text-[14px] font-extrabold text-white">Get in Touch</h2>
            <p className="mt-5 text-[13px] font-bold text-white">Madhushan Perumal</p>
            <a href="tel:+12362343229" className="mt-1 block text-[13px] transition-colors hover:text-[#c2ee84]">
              +1 236-234-3229
            </a>
            <a href="mailto:info@wisdomdrivingacademy.com" className="mt-3 block break-words text-[13px] transition-colors hover:text-[#c2ee84]">
              info@wisdomdrivingacademy.com
            </a>
          </address>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-white/15 pt-6 text-[11px] text-[#92a8b1] sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Wisdom Driving Academy. All rights reserved.</p>
          <p>Lesson package prices are in CAD; GST is added.</p>
          <p>
            Developed &amp; designed by{" "}
            <a
              href="https://maintainex.lk"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[#b9cbd0] underline-offset-4 transition-colors hover:text-[#c2ee84] hover:underline"
            >
              Maintainex
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
