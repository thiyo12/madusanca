import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { formatPrice } from "@/lib/data/lessons";

export const metadata: Metadata = {
  title: "Dashboard — Wisdom Driving Academy Admin",
};

function vancouverDayBounds(now: Date): { from: string; to: string } {
  // Day boundaries derived from the booking grid: build from Vancouver date parts.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const y = get("year");
  const m = get("month");
  const d = get("day");
  // Noon anchors the day; subtract/add half a day for safe bounds.
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return {
    from: new Date(noonUtc - 12 * 60 * 60 * 1000).toISOString(),
    to: new Date(noonUtc + 12 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function AdminDashboardPage() {
  const store = getStore();
  const now = new Date();
  const today = vancouverDayBounds(now);
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const [upcoming, todays, thisMonth, catalogue] = await Promise.all([
    store.listBookings({ fromIso: now.toISOString() }),
    store.listBookings({ fromIso: today.from, toIso: today.to }),
    store.listBookings({ fromIso: monthStartIso }),
    store.getLessons(),
  ]);

  const active = (status: string) => status === "pending_payment" || status === "confirmed" || status === "rescheduled";
  const upcomingActive = upcoming.filter((b) => active(b.status));
  const todaysActive = todays.filter((b) => active(b.status));
  const monthActive = thisMonth.filter((b) => active(b.status));
  const monthCancelled = thisMonth.filter((b) => b.status === "cancelled");
  const revenue = monthActive.reduce((sum, b) => sum + b.priceCad, 0);

  const stats = [
    { label: "Upcoming lessons", value: String(upcomingActive.length), hint: "from now on" },
    { label: "Today", value: String(todaysActive.length), hint: "Pacific Time" },
    { label: "Booked this month", value: String(monthActive.length), hint: "active bookings" },
    { label: "Expected this month", value: formatPrice(revenue), hint: "paid at the school" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
            Admin
          </p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            Dashboard
          </h1>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/bookings"
            className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[13px] font-extrabold text-ink transition-colors hover:border-gold hover:text-gold-deep"
          >
            All bookings
          </Link>
          <Link
            href="/booking"
            className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-extrabold"
          >
            Open booking page
          </Link>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-[16px] border border-line bg-white p-4 sm:p-5"
          >
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-soft">
              {stat.label}
            </p>
            <p className="mt-2 font-display text-[24px] font-extrabold leading-none text-ink sm:text-[27px]">
              {stat.value}
            </p>
            <p className="mt-1.5 text-[11.5px] text-soft">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="rounded-[18px] border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-extrabold text-ink">Today&rsquo;s lessons</h2>
              <Link
                href="/admin/calendar"
                className="text-[12.5px] font-bold text-gold-deep underline-offset-4 hover:underline"
              >
                Calendar →
              </Link>
            </div>
            {todays.length === 0 ? (
              <p className="px-5 py-8 text-sm text-soft">
                Nothing scheduled today.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {todays.map((booking) => (
                  <li key={booking.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="w-[74px] shrink-0 text-[13px] font-extrabold text-ink">
                      {formatSlotTime(booking.startsAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold text-ink">
                        {booking.studentName}
                      </p>
                      <p className="truncate text-[12px] text-soft">
                        {booking.lessonName} · {booking.reference}
                      </p>
                    </div>
                    <StatusChip status={booking.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="rounded-[18px] border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-extrabold text-ink">Next up</h2>
              <span className="text-[12px] font-bold text-soft">
                {monthCancelled.length} cancelled this month
              </span>
            </div>
            {upcomingActive.length === 0 ? (
              <p className="px-5 py-8 text-sm text-soft">No upcoming lessons yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcomingActive.slice(0, 6).map((booking) => {
                  const lesson = catalogue.find((l) => l.id === booking.lessonId);
                  return (
                    <li key={booking.id} className="px-5 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-[13.5px] font-bold text-ink">
                          {booking.studentName}
                        </p>
                        <span className="shrink-0 text-[12.5px] font-extrabold text-gold-deep">
                          {lesson?.category === "module" ? "Module" : "Package"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-soft">
                        {formatSlotDay(booking.startsAt)} ·{" "}
                        {formatSlotTime(booking.startsAt)} · {booking.durationMin} min
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="mt-4 rounded-[14px] border border-[#f6e4b9] bg-gold-soft px-4 py-3 text-[12.5px] leading-relaxed text-[#604717]">
            Payments are arranged directly with students (e-transfer, card or in
            person) — mark nothing as paid online.
          </p>
        </section>
      </div>
    </div>
  );
}
