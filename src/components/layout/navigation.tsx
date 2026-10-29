"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/lessons", label: "Lessons" },
  { href: "/#how", label: "How It Works" },
  { href: "/about", label: "About" },
  { href: "/#faq", label: "FAQ" },
  { href: "/booking/manage", label: "My Booking" },
  { href: "/contact", label: "Contact" },
] as const;

export function Navigation() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function isActive(href: string) {
    return href === "/" ? isHome : !href.includes("#") && pathname.startsWith(href);
  }

  return (
    <header className={`z-50 w-full text-white ${isHome ? "absolute left-0 top-0" : "relative bg-[#0b1b29]"}`}>
      <div className="border-b border-white/10 bg-[#101f2b] text-[#dce9e8]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] sm:px-6">
          <span>Wisdom Driving Academy · British Columbia</span>
          <span className="hidden sm:inline">Your journey. Your pace. Your confidence.</span>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-2 sm:px-6 xl:gap-8">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-4 xl:flex 2xl:gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`whitespace-nowrap py-2 text-[12px] font-bold transition-colors hover:text-[#c2ee84] ${isActive(link.href) ? "text-[#c2ee84]" : "text-white/90"}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden xl:block">
          <Button href="/booking" size="sm" className="whitespace-nowrap px-5">
            Book a Lesson <span aria-hidden="true">↗</span>
          </Button>
        </div>
        <button
          type="button"
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-nav"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-white/35 px-3.5 text-[12px] font-bold xl:hidden"
        >
          <span aria-hidden="true" className="text-lg leading-none">{isMenuOpen ? "×" : "☰"}</span>
          Menu
        </button>
      </div>
      {isMenuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="absolute left-5 right-5 top-full rounded-[18px] border border-white/15 bg-[#132c39] p-4 shadow-[0_22px_60px_rgba(0,0,0,0.35)] sm:left-6 sm:right-6 xl:hidden"
        >
          <div className="grid gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`rounded-[10px] px-3 py-2.5 text-[14px] font-bold transition-colors hover:bg-white/10 ${isActive(link.href) ? "text-[#c2ee84]" : "text-white"}`}
              >
                {link.label}
              </Link>
            ))}
            <Button href="/booking" onClick={() => setIsMenuOpen(false)} className="mt-3 w-full">
              Book a Lesson <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
