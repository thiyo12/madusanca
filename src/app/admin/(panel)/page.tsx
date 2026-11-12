import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import { formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { formatPrice } from "@/lib/data/lessons";
import { DashboardAddBooking } from "./dashboard-add-booking";
import { BookingTrendChart, type BookingTrendDay } from "./booking-trend-chart";

export const metadata: Metadata = {
  title: "Dashboard — Wisdom Driving Academy Admin",
};

function vancouverDayBounds(now: Date): { from: string; to: string; label: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "0";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  return {
    from: new Date(noonUtc - 12 * 60 * 60_000).toISOString(),
    to: new Date(noonUtc + 12 * 60 * 60_000).toISOString(),
    label: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver", weekday: "long", month: "long", day: "numeric",
    }).format(now),
  };
}

function vancouverDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function trendDetail(current: number, previous: number, previousLabel: string): string {
  if (previous === 0) return current === 0 ? `No bookings vs ${previousLabel}` : `New bookings · none ${previousLabel}`;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return `No change vs ${previousLabel}`;
  return `${change > 0 ? "↑" : "↓"} ${Math.abs(change)}% vs ${previousLabel}`;
}

const active = (status: string) => ["pending_payment", "confirmed", "rescheduled"].includes(status);

export default async function AdminDashboardPage() {
  const store = getStore();
  const now = new Date();
  const today = vancouverDayBounds(now);
  const [bookings, packages, catalogue] = await Promise.all([
    store.listBookings(),
    store.listPackagePurchases(200),
    store.getLessons(),
  ]);

  const todays = bookings.filter((booking) => booking.startsAt >= today.from && booking.startsAt < today.to && active(booking.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const todayKey = vancouverDateKey(now.toISOString());
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const weekday = new Date(`${todayKey}T12:00:00.000Z`).getUTCDay();
  const weekStartKey = addDaysToKey(todayKey, -((weekday + 6) % 7));
  const previousWeekStartKey = addDaysToKey(weekStartKey, -7);
  const previousWeekEndKey = addDaysToKey(todayKey, -7);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const [year, month, day] = todayKey.split("-").map(Number);
  const previousMonthStartKey = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const previousMonthComparableEndKey = new Date(Date.UTC(year, month - 2, Math.min(day, previousMonthLastDay))).toISOString().slice(0, 10);
  const trendBookings = bookings.filter((booking) => booking.status !== "cancelled");
  const createdKey = (booking: (typeof trendBookings)[number]) => vancouverDateKey(booking.createdAt);
  const countCreatedBetween = (from: string, to: string) => trendBookings.filter((booking) => {
    const key = createdKey(booking);
    return key >= from && key <= to;
  }).length;
  const todayBookingCount = countCreatedBetween(todayKey, todayKey);
  const yesterdayBookingCount = countCreatedBetween(yesterdayKey, yesterdayKey);
  const weekBookingCount = countCreatedBetween(weekStartKey, todayKey);
  const previousWeekBookingCount = countCreatedBetween(previousWeekStartKey, previousWeekEndKey);
  const monthBookingCount = countCreatedBetween(monthStartKey, todayKey);
  const previousMonthBookingCount = countCreatedBetween(previousMonthStartKey, previousMonthComparableEndKey);
  const monthLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStartKey}T12:00:00.000Z`));
  const bookingTrendDays: BookingTrendDay[] = [];
  for (let key = monthStartKey; key <= todayKey; key = addDaysToKey(key, 1)) {
    const dayBookings = trendBookings.filter((booking) => createdKey(booking) === key).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const date = new Date(`${key}T12:00:00.000Z`);
    bookingTrendDays.push({
      key,
      label: new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(date),
      count: dayBookings.length,
      bookings: dayBookings.map((booking) => ({ id: booking.id, reference: booking.reference, studentName: booking.studentName, lessonName: booking.lessonName, startsAt: booking.startsAt, createdAt: booking.createdAt, status: booking.status })),
    });
  }
  const needsPayment = bookings.filter((booking) => booking.paymentStatus === "due" && booking.status !== "cancelled");
  const duePackages = packages.filter((purchase) => purchase.paymentStatus === "pending");
  const outstanding = needsPayment.reduce((sum, booking) => sum + booking.priceCad, 0)
    + duePackages.reduce((sum, purchase) => sum + purchase.amountCad, 0);
  const pendingConfirmation = bookings.filter((booking) => booking.status === "pending_payment" && booking.startsAt >= now.toISOString()).length;
  const totalAppointments = bookings.length;
  const activeUpcomingAppointments = bookings.filter((booking) => active(booking.status) && booking.startsAt >= now.toISOString()).length;
  const paymentMix = [
    { label: "Paid", count: bookings.filter((booking) => booking.paymentStatus === "paid").length + packages.filter((purchase) => purchase.paymentStatus === "paid").length, color: "bg-[#31a879]" },
    { label: "Due", count: needsPayment.length + duePackages.length, color: "bg-[#e9b642]" },
    { label: "Refunded", count: bookings.filter((booking) => booking.paymentStatus === "refunded").length + packages.filter((purchase) => purchase.paymentStatus === "refunded").length, color: "bg-[#6588db]" },
    { label: "Waived", count: bookings.filter((booking) => booking.paymentStatus === "waived").length + packages.filter((purchase) => purchase.paymentStatus === "waived").length, color: "bg-[#a3aab4]" },
  ];
  const maxPaymentCount = Math.max(1, ...paymentMix.map((item) => item.count));

  const stats = [
    { label: "Total appointments", value: String(totalAppointments), detail: "All appointment records", tone: "blue", icon: "◎" },
    { label: "Active / upcoming", value: String(activeUpcomingAppointments), detail: "Scheduled and not cancelled", tone: "green", icon: "◷" },
    { label: "Payments to review", value: formatPrice(outstanding), detail: `${needsPayment.length + duePackages.length} records marked due`, tone: "red", icon: "$" },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Wisdom Driving Academy · Operations</p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">Your school, at a glance.</h1>
          <p className="mt-1 text-[13px] text-soft">A quick look at lessons, students, and payments · {today.label}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/calendar" className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[13px] font-extrabold text-ink hover:border-gold">Open calendar</Link>
          <DashboardAddBooking lessons={catalogue.filter((lesson) => lesson.category === "package")} />
        </div>
      </header>

      <section aria-label="School activity summary" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <article className="overflow-hidden rounded-[16px] border border-line bg-white p-3 shadow-[0_2px_8px_rgba(20,28,38,0.035)] sm:p-4" aria-label="Booking trends">
          <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#fff4d7] text-[13px] font-black text-[#aa7913]" aria-hidden="true">▥</span><p className="text-[10px] font-extrabold uppercase tracking-wide text-soft sm:text-[10.5px]">Booking trends</p></div>
          <div className="mt-2 divide-y divide-line">
            {[
              { label: "Today", value: todayBookingCount, previous: yesterdayBookingCount, period: "yesterday" },
              { label: "This week", value: weekBookingCount, previous: previousWeekBookingCount, period: "same days last week" },
              { label: "This month", value: monthBookingCount, previous: previousMonthBookingCount, period: "same dates last month" },
            ].map((item) => {
              const detail = trendDetail(item.value, item.previous, item.period);
              const color = detail.startsWith("↑") || detail.startsWith("New") ? "text-[#238855]" : detail.startsWith("↓") ? "text-[#bc4633]" : "text-soft";
              return <div key={item.label} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                <p className="text-[10px] font-bold text-soft">{item.label}</p>
                <div className="flex min-w-0 items-baseline justify-end gap-1.5"><p className="font-display text-[17px] font-extrabold leading-none text-ink">{item.value}</p><p className={`truncate text-[8px] font-extrabold sm:text-[9px] ${color}`} title={detail}>{detail.startsWith("↑") || detail.startsWith("↓") ? `${detail.split(" vs ")[0]} ${item.period === "yesterday" ? "vs yday" : item.period === "same days last week" ? "vs last wk" : "vs last mo"}` : detail.startsWith("New") ? "NEW" : "—"}</p></div>
              </div>;
            })}
          </div>
        </article>
        {stats.map((stat) => (
          <article key={stat.label} className="relative overflow-hidden rounded-[16px] border border-line bg-white p-4 shadow-[0_2px_8px_rgba(20,28,38,0.035)] sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className={`grid h-9 w-9 place-items-center rounded-[11px] text-[16px] font-black ${stat.tone === "gold" ? "bg-[#fff4d7] text-[#aa7913]" : stat.tone === "green" ? "bg-[#e6f6ed] text-[#238855]" : stat.tone === "red" ? "bg-[#fff0ec] text-[#c45d48]" : "bg-[#eaf0ff] text-[#4b75ce]"}`} aria-hidden="true">{stat.icon}</span>
              <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-soft">{stat.label}</p>
            </div>
            <p className="mt-3 font-display text-[24px] font-extrabold leading-none text-ink sm:text-[28px]">{stat.value}</p>
            <p className="mt-2 text-[11.5px] text-soft">{stat.detail}</p>
          </article>
        ))}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2" aria-label="Booking and payment charts">
        <div className="rounded-[17px] border border-line bg-white p-5 shadow-[0_2px_8px_rgba(20,28,38,0.035)]">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-[15px] font-extrabold text-ink">Booking trends</h2><p className="mt-0.5 text-[11.5px] text-soft">Bookings received by day · {monthLabel}</p></div><Link href="/admin/bookings" className="text-[11.5px] font-extrabold text-gold-deep hover:underline">Bookings →</Link></div>
          <BookingTrendChart days={bookingTrendDays} monthLabel={monthLabel} />
        </div>
        <div className="rounded-[17px] border border-line bg-white p-5 shadow-[0_2px_8px_rgba(20,28,38,0.035)]">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-[15px] font-extrabold text-ink">Payment status</h2><p className="mt-0.5 text-[11.5px] text-soft">Record counts · bookings + recent packages</p></div><Link href="/admin/payments" className="text-[11.5px] font-extrabold text-gold-deep hover:underline">View payments →</Link></div>
          <div className="mt-5 grid gap-3" role="img" aria-label={`Payment status record counts: ${paymentMix.map((item) => `${item.label} ${item.count}`).join(", ")}`}>
            {paymentMix.map((item) => <div key={item.label} className="grid grid-cols-[62px_1fr_28px] items-center gap-3"><span className="text-[11.5px] font-bold text-soft">{item.label}</span><div className="h-[11px] overflow-hidden rounded-full bg-[#f0f1f3]"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.count ? Math.max(4, (item.count / maxPaymentCount) * 100) : 0}%` }} /></div><span className="text-right text-[11.5px] font-extrabold text-ink">{item.count}</span></div>)}
          </div>
          <p className="mt-4 text-[10.5px] text-soft">Package purchase counts include up to 200 recent package records.</p>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[1.25fr_0.95fr]">
        <section className="overflow-hidden rounded-[17px] border border-line bg-white" aria-labelledby="today-title">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
            <div><h2 id="today-title" className="text-[15px] font-extrabold text-ink">Today&rsquo;s lesson schedule</h2><p className="mt-0.5 text-[11.5px] text-soft">A quick view of the day&rsquo;s active bookings</p></div>
            <Link href="/admin/calendar" className="text-[12px] font-extrabold text-gold-deep hover:underline">Full calendar →</Link>
          </div>
          {todays.length === 0 ? <p className="px-5 py-8 text-sm text-soft">No active lessons scheduled today.</p> : (
            <ul className="divide-y divide-line">
              {todays.slice(0, 8).map((booking) => (
                <li key={booking.id} className="flex items-center gap-3 px-5 py-3">
                  <time className="w-[72px] shrink-0 text-[13px] font-extrabold text-ink">{formatSlotTime(booking.startsAt)}</time>
                  <span className="h-8 w-1 shrink-0 rounded-full bg-gold" />
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold text-ink">{booking.studentName}</p><p className="truncate text-[11.5px] text-soft">{booking.lessonName} · {booking.durationMin} min · {booking.reference}</p></div>
                  <StatusChip status={booking.status} />
                </li>
              ))}
            </ul>
          )}
          {todays.length > 8 && <p className="border-t border-line px-5 py-3 text-[11.5px] text-soft">Showing 8 of {todays.length} lessons.</p>}
        </section>

        <section className="overflow-hidden rounded-[17px] border border-line bg-white" aria-labelledby="payment-title">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div><h2 id="payment-title" className="text-[15px] font-extrabold text-ink">Payment follow-up</h2><p className="mt-0.5 text-[11.5px] text-soft">Records currently marked as due</p></div>
            <Link href="/admin/payments" className="text-[12px] font-extrabold text-gold-deep hover:underline">Manage →</Link>
          </div>
          <div className="flex items-center justify-between bg-[#fff9e9] px-5 py-3"><span className="text-[12px] font-bold text-[#604717]">Outstanding recorded value</span><strong className="text-[16px] font-extrabold text-[#604717]">{formatPrice(outstanding)}</strong></div>
          {needsPayment.length + duePackages.length === 0 ? <p className="px-5 py-7 text-sm text-soft">No records are currently marked due.</p> : (
            <ul className="divide-y divide-line">
              {needsPayment.slice(0, 5).map((booking) => (
                <li key={booking.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-bold text-ink">{booking.studentName}</p><p className="truncate text-[11px] text-soft">{booking.reference} · {booking.lessonName}</p></div>
                  <span className="shrink-0 text-[12px] font-extrabold text-ink">{formatPrice(booking.priceCad)}</span>
                </li>
              ))}
              {duePackages.slice(0, Math.max(0, 5 - needsPayment.length)).map((purchase) => (
                <li key={purchase.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-bold text-ink">{purchase.studentName}</p><p className="truncate text-[11px] text-soft">{purchase.reference} · package purchase</p></div>
                  <span className="shrink-0 text-[12px] font-extrabold text-ink">{formatPrice(purchase.amountCad)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-5 py-3 text-[10.5px] leading-relaxed text-soft">This is the total of booking and recent package records marked due, not a bank balance. Card payments are recorded automatically; cash and cheque tracking is managed on Payments.</p>
        </section>
      </div>

      <section className="mt-5 grid gap-5">
        <div className="rounded-[17px] border border-line bg-white p-5">
          <div><h2 className="text-[15px] font-extrabold text-ink">Keep the school moving</h2><p className="mt-0.5 text-[11.5px] text-soft">Common tasks and records in one place</p></div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <QuickLink href="/admin/bookings" title="Bookings" detail={pendingConfirmation ? `${pendingConfirmation} awaiting confirmation` : "Review and manage bookings"} />
            <QuickLink href="/admin/students" title="Students" detail="Open student records and reports" />
            <QuickLink href="/admin/lessons" title="Lessons" detail={`${catalogue.length} lesson options in catalogue`} />
            <QuickLink href="/admin/payments" title="Payment reports" detail="Review payments and download CSVs" />
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link href={href} className="rounded-[11px] border border-line p-3 transition-colors hover:border-gold hover:bg-[#fffdf7]"><span className="block text-[12.5px] font-extrabold text-ink">{title} <span aria-hidden="true">→</span></span><span className="mt-1 block text-[10.5px] leading-relaxed text-soft">{detail}</span></Link>;
}
