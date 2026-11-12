"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import type { BookingStatus } from "@/lib/booking/types";

export interface BookingTrendItem {
  id: string;
  reference: string;
  studentName: string;
  lessonName: string;
  startsAt: string;
  createdAt: string;
  status: BookingStatus;
}

export interface BookingTrendDay {
  key: string;
  label: string;
  count: number;
  bookings: BookingTrendItem[];
}

export function BookingTrendChart({ days, monthLabel }: { days: BookingTrendDay[]; monthLabel: string }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const maxCount = Math.max(1, ...days.map((day) => day.count));
  const selected = days.find((day) => day.key === selectedDay) ?? null;

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="mt-5 flex h-[160px] min-w-max items-end gap-1.5 border-b border-line px-1 sm:gap-2" role="group" aria-label={`Bookings received by day in ${monthLabel}`}>
          {days.map((day) => {
            const active = day.key === selectedDay;
            const height = day.count ? Math.max(10, Math.round((day.count / maxCount) * 100)) : 4;
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={active}
                aria-label={`${day.label}: ${day.count} non-cancelled booking records. Click to view bookings.`}
                title={`${day.label}: ${day.count} bookings · click to view`}
                onClick={() => setSelectedDay(active ? null : day.key)}
                className="group flex h-full w-[29px] shrink-0 flex-col items-center justify-end gap-1 rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-gold sm:w-[34px]"
              >
                <span className={`text-[9px] font-extrabold ${active ? "text-gold-deep" : "text-soft"}`}>{day.count || ""}</span>
                <span className="flex h-[112px] w-full items-end justify-center">
                  <span className={`w-full max-w-[25px] rounded-t-[5px] transition-colors ${active ? "bg-[#aa7913]" : day.count ? "bg-[#e5b63e] group-hover:bg-[#c99b2c]" : "bg-[#f0f1f3]"}`} style={{ height: `${height}%` }} />
                </span>
                <span className={`pb-2 text-[9px] font-bold ${active ? "text-ink" : "text-soft"}`}>{day.key.slice(-2).replace(/^0/, "")}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-soft">Daily bookings created in {monthLabel}; cancelled records are excluded. Select a bar to see its bookings.</p>

      {selected && (
        <section aria-live="polite" aria-labelledby="booking-trend-detail-title" className="mt-4 overflow-hidden rounded-[13px] border border-line bg-[#fbfcf9]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
            <div><h3 id="booking-trend-detail-title" className="text-[12.5px] font-extrabold text-ink">{selected.label}</h3><p className="text-[10.5px] text-soft">{selected.count} booking record{selected.count === 1 ? "" : "s"} received</p></div>
            <Link href={`/admin/bookings?range=all`} className="text-[10.5px] font-extrabold text-gold-deep hover:underline">All bookings →</Link>
          </div>
          {selected.bookings.length === 0 ? <p className="px-3.5 py-4 text-[11.5px] text-soft">No non-cancelled booking records on this date.</p> : (
            <ul className="max-h-[240px] divide-y divide-line overflow-y-auto">
              {selected.bookings.map((booking) => (
                <li key={booking.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <span className="w-[58px] shrink-0 text-[10.5px] font-extrabold text-ink">{formatSlotTime(booking.createdAt)}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-[11.5px] font-bold text-ink">{booking.studentName}</p><p className="truncate text-[10px] text-soft">{booking.lessonName} · {formatSlotDay(booking.startsAt)} · {booking.reference}</p></div>
                  <StatusChip status={booking.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
