import Link from "next/link";
import type { BookingRecord } from "@/lib/booking/types";
import { dayKeyOf, dayNumber, formatSlotTime } from "@/lib/booking/format";

export interface CalendarFilters {
  q?: string;
  status?: string;
}

export function href(
  params: { view: "month" | "week"; date: string } & CalendarFilters,
): string {
  const search = new URLSearchParams({ view: params.view, date: params.date });
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  return `/admin/calendar?${search.toString()}`;
}

export const CHIP_TONES: Record<string, string> = {
  confirmed: "border-l-[#1f9d55]",
  rescheduled: "border-l-[#e3a721]",
  cancelled: "border-l-[#d46a5b]",
  completed: "border-l-[#4a76c5]",
  no_show: "border-l-[#8d4b91]",
};

export function isBookingOverdue(booking: BookingRecord, today: string): boolean {
  return dayKeyOf(booking.startsAt) < today
    && (booking.status === "confirmed" || booking.status === "rescheduled" || booking.status === "pending_payment");
}

export function bookingAgendaHref(dayKey: string, bookingId: string, filters?: CalendarFilters, view: "week" | "month" = "week"): string {
  const search = new URLSearchParams({ view, date: view === "month" ? `${dayKey.slice(0, 7)}-01` : dayKey, booking: bookingId });
  if (filters?.q) search.set("q", filters.q);
  if (filters?.status) search.set("status", filters.status);
  return `/admin/calendar?${search.toString()}#booking-${encodeURIComponent(bookingId)}`;
}

export function MonthGrid({
  from,
  days,
  byDay,
  anchor,
  today,
  filters,
}: {
  from: string;
  days: number;
  byDay: Map<string, BookingRecord[]>;
  anchor: string;
  today: string;
  filters?: CalendarFilters;
}) {
  const [y, m] = from.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const leadingBlanks = (firstWeekday + 6) % 7; // Monday-first grid

  const cells: Array<string | null> = [
    ...Array<string | null>(leadingBlanks).fill(null),
    ...Array.from({ length: days }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return `${from.slice(0, 7)}-${day}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="grid grid-cols-7">
      {cells.map((cell, index) => {
        if (!cell) {
          return (
            <div
              key={`blank-${index}`}
              className="min-h-[84px] border-b border-r border-line bg-[#fafbfc] last:border-r-0 sm:min-h-[110px]"
            />
          );
        }
        const list = byDay.get(cell) ?? [];
        const isToday = cell === today;
        const isAnchor = cell === anchor;
        return (
          <div
            key={cell}
            className={`min-h-[84px] border-b border-r border-line p-1.5 last:border-r-0 sm:min-h-[110px] sm:p-2 ${
              isAnchor ? "bg-[#fffdf6]" : "bg-white"
            }`}
          >
            <Link
              href={href({ view: "week", date: cell, ...filters })}
              className={`inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[11.5px] font-extrabold ${
                isToday ? "bg-gold text-ink" : "text-ink hover:text-gold-deep"
              }`}
            >
              {dayNumber(cell)}
            </Link>
            <div className="mt-1 grid gap-1">
              {list.slice(0, 2).map((booking) => {
                const overdue = isBookingOverdue(booking, today);
                return (
                  <Link
                    key={booking.id}
                    href={bookingAgendaHref(cell, booking.id, filters, "month")}
                    title={overdue ? "Warning: past lesson is not marked complete or missed." : undefined}
                    className={`hidden rounded-[6px] border-l-[3px] px-1.5 py-1 text-[10px] leading-tight hover:bg-gold-soft sm:block ${overdue ? "border-l-[#dc2626] bg-[#fff0ed]" : `bg-mist ${CHIP_TONES[booking.status]}`}`}
                  >
                    <span className={`block font-extrabold ${overdue ? "text-[#bc2323]" : "text-ink"}`}>
                      {formatSlotTime(booking.startsAt)}
                    </span>
                    <span className={`block truncate ${overdue ? "font-bold text-[#bc2323]" : "text-soft"}`}>{booking.studentName}</span>
                    {overdue && <span className="block truncate text-[9px] font-extrabold text-[#bc2323]">⚠ Needs update</span>}
                  </Link>
                );
              })}
              {/* Mobile: compact count pill */}
              <span className={`rounded-full px-1.5 py-0.5 text-center text-[9.5px] font-extrabold sm:hidden ${list.some((booking) => isBookingOverdue(booking, today)) ? "bg-[#fff0ed] text-[#bc2323]" : "bg-gold-soft text-gold-deep"}`}>
                {list.some((booking) => isBookingOverdue(booking, today)) ? "⚠ Lesson overdue" : list.length > 0 ? `${list.length} booked` : ""}
              </span>
              {list.length > 2 && (
                <Link href={href({ view: "week", date: cell, ...filters })} aria-label={`View all ${list.length} bookings for ${cell}`} className="hidden text-[10px] font-bold text-gold-deep hover:underline sm:block">
                  +{list.length - 2} more
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
