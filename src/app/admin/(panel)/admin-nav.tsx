"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { signOut } from "@/app/admin/login/actions";

export interface AdminNavProps {
  email: string;
}

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/lessons", label: "Lessons" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav({ email }: AdminNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#23262a] bg-ink px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo compact href="/admin" />
        </div>

        <nav className="mt-8 grid gap-1" aria-label="Admin">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-[10px] px-3 py-2.5 text-[13.5px] font-bold transition-colors duration-150 ${
                isActive(item.href)
                  ? "bg-gold text-ink"
                  : "text-[#b7bdc6] hover:bg-[#1e2226] hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto grid gap-3 border-t border-[#23262a] pt-5">
          <Link
            href="/"
            className="px-2 text-[12.5px] font-semibold text-[#8a919c] underline-offset-4 hover:text-white hover:underline"
          >
            ← View website
          </Link>
          <div className="px-2 text-[11.5px] leading-snug text-[#6b727c]">
            Signed in as
            <span className="block break-all text-[#b7bdc6]">{email}</span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-[10px] border border-[#2a2e33] px-3 py-2 text-[12.5px] font-extrabold text-[#c3c8cf] transition-colors hover:border-gold hover:text-gold"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden">
        <header className="sticky top-0 z-30 border-b border-[#23262a] bg-ink px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <Logo compact href="/admin" />
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-[9px] border border-[#2a2e33] px-3 py-1.5 text-[12px] font-extrabold text-[#c3c8cf]"
              >
                Sign out
              </button>
            </form>
          </div>
          <nav className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5" aria-label="Admin">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${
                  isActive(item.href)
                    ? "bg-gold text-ink"
                    : "bg-[#1e2226] text-[#b7bdc6] hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <div className="px-5 pt-4 text-[11.5px] text-soft">{email}</div>
      </div>
    </>
  );
}
