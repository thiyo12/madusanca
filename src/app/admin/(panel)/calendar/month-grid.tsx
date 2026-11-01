import Link from "next/link";
import type { BookingRecord } from "@/lib/booking/types";
import { dayNumber, formatSlotTime } from "@/lib/booking/format";
import { adminStudentHref } from "@/lib/admin/urls";

export interface CalendarFilters {
  q?: string;
  status?: string;
}

export function href(
  params: { view: "month" | "week" | "day"; date: string } & CalendarFilters,
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
};

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
              href={href({ view: "day", date: cell, ...filters })}
              className={`inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[11.5px] font-extrabold ${
                isToday ? "bg-gold text-ink" : "text-ink hover:text-gold-deep"
              }`}
            >
              {dayNumber(cell)}
            </Link>
            <div className="mt-1 grid gap-1">
              {list.slice(0, 2).map((booking) => (
                <Link
                  key={booking.id}
                  href={adminStudentHref(booking.id)}
                  className={`hidden rounded-[6px] border-l-[3px] bg-mist px-1.5 py-1 text-[10px] leading-tight hover:bg-gold-soft sm:block ${CHIP_TONES[booking.status]}`}
                >
                  <span className="block font-extrabold text-ink">
                    {formatSlotTime(booking.startsAt)}
                  </span>
                  <span className="block truncate text-soft">{booking.studentName}</span>
                </Link>
              ))}
              {/* Mobile: compact count pill */}
              <span className="rounded-full bg-gold-soft px-1.5 py-0.5 text-center text-[9.5px] font-extrabold text-gold-deep sm:hidden">
                {list.length > 0 ? `${list.length} booked` : ""}
              </span>
              {list.length > 2 && (
                <span className="hidden text-[10px] font-bold text-gold-deep sm:block">
                  +{list.length - 2} more
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
