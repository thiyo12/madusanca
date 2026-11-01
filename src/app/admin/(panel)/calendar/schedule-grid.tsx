"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AvailabilityRule, BlackoutDate, BookingRecord } from "@/lib/booking/types";
import { dayNumber, formatSlotTime, weekdayLabel } from "@/lib/booking/format";
import { LEAD_TIME_MIN, zonedToUtc } from "@/lib/booking/slots";
import type { Lesson } from "@/lib/data/lessons";
import { adminStudentHref } from "@/lib/admin/urls";
import { rescheduleBookingAction } from "../bookings/actions";
import { QuickBookDialog } from "./quick-book-dialog";
import { CHIP_TONES, href, type CalendarFilters } from "./month-grid";

/** Thirty-minute schedule rows keep the grid aligned with bookable slots. */
const ROW_H = 34;
const SLOT_STEP_MIN = 30;

interface ScheduleGridProps {
  dayKeys: string[];
  byDay: Record<string, BookingRecord[]>;
  rules: AvailabilityRule[];
  blackouts: BlackoutDate[];
  today: string;
  lessons: Lesson[];
  nowMs: number;
  filters?: CalendarFilters;
  /** Hour bounds of the grid (Vancouver wall clock). */
  startHour: number;
  endHour: number;
}

function vancouverMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isActive(booking: BookingRecord): boolean {
  return booking.status === "pending_payment" || booking.status === "confirmed" || booking.status === "rescheduled";
}

function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function startsAtFor(dayKey: string, startMin: number): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return zonedToUtc(year, month, day, startMin);
}

/** Greedy lane assignment so overlapping bookings split the column width. */
function assignLanes(bookings: BookingRecord[]): Array<{ booking: BookingRecord; lane: number }> {
  const sorted = [...bookings].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || Date.parse(a.endsAt) - Date.parse(b.endsAt),
  );
  const laneEnds: number[] = [];
  return sorted.map((booking) => {
    const start = Date.parse(booking.startsAt);
    const end = Date.parse(booking.endsAt);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    return { booking, lane };
  });
}

const CLOSED_CELL =
  "bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e9ebee_6px,#e9ebee_12px)]";

export function ScheduleGrid({
  dayKeys,
  byDay,
  rules,
  blackouts,
  today,
  lessons,
  nowMs,
  filters,
  startHour,
  endHour,
}: ScheduleGridProps) {
  const router = useRouter();
  const [selectedSlot, setSelectedSlot] = useState<{
    dayKey: string;
    startMin: number;
    lessons: Lesson[];
  } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [moving, startTransition] = useTransition();
  const rows = Math.max(1, (endHour - startHour) * 60 / SLOT_STEP_MIN);
  const gridHeight = rows * ROW_H;
  const gridStartMin = startHour * 60;
  const intervalStarts = Array.from({ length: rows }, (_, index) => gridStartMin + index * SLOT_STEP_MIN);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const blackoutByDate = new Map(blackouts.map((b) => [b.date, b]));
  const template = `56px repeat(${dayKeys.length}, minmax(0, 1fr))`;

  function dayBookings(dayKey: string): BookingRecord[] {
    return byDay[dayKey] ?? [];
  }

  function slotIsBusy(bookings: BookingRecord[], startMin: number): boolean {
    return bookings.some(
      (booking) =>
        isActive(booking) &&
        vancouverMinutes(booking.startsAt) < startMin + SLOT_STEP_MIN &&
        vancouverMinutes(booking.endsAt) > startMin,
    );
  }

  function lessonsForSlot(
    startMin: number,
    rule: AvailabilityRule | undefined,
    blackout: BlackoutDate | undefined,
    bookings: BookingRecord[],
  ): Lesson[] {
    if (!rule || blackout) return [];
    return lessons.filter((lesson) => {
      const endMin = startMin + lesson.durationMin;
      if (endMin > rule.endMin) return false;
      return !bookings.some(
        (booking) =>
          isActive(booking) &&
          vancouverMinutes(booking.startsAt) < endMin &&
          vancouverMinutes(booking.endsAt) > startMin,
      );
    });
  }

  function moveBooking(event: React.DragEvent<HTMLDivElement>, dayKey: string, startMin: number) {
    event.preventDefault();
    const bookingId = event.dataTransfer.getData("text/booking-id");
    if (!bookingId) return;
    const [year, month, day] = dayKey.split("-").map(Number);
    const startsAt = zonedToUtc(year, month, day, startMin).toISOString();
    const formData = new FormData();
    formData.set("bookingId", bookingId);
    formData.set("startsAt", startsAt);
    setDropError(null);
    startTransition(async () => {
      const result = await rescheduleBookingAction({ error: null }, formData);
      if (result.error) setDropError(result.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {/* ---- Desktop: time-grid schedule (BookingTimes model) ---- */}
      <div className="hidden lg:block">
        <div
          className="grid border-b border-line bg-mist"
          style={{ gridTemplateColumns: template }}
        >
          <div />
          {dayKeys.map((dayKey) => {
            const isToday = dayKey === today;
            const count = dayBookings(dayKey).filter(isActive).length;
            return (
              <Link
                key={dayKey}
                href={href({ view: "day", date: dayKey, ...filters })}
                className={`border-l border-line px-3 py-2.5 transition-colors hover:bg-gold-soft ${
                  isToday ? "bg-[#fffdf6]" : ""
                }`}
              >
                <span className="block text-[11px] font-extrabold uppercase tracking-wide text-soft">
                  {weekdayLabel(dayKey)}
                </span>
                <span
                  className={`mt-0.5 inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] font-extrabold ${
                    isToday ? "bg-gold text-ink" : "text-ink"
                  }`}
                >
                  {dayNumber(dayKey)}
                </span>
                {count > 0 && (
                  <span className="ml-1.5 text-[11px] font-bold text-gold-deep">
                    {count} booked
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div
          className="grid"
          style={{ gridTemplateColumns: template }}
        >
          {/* Time gutter */}
          <div className="relative border-r border-line" style={{ height: gridHeight }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] font-bold text-soft"
                style={{ top: index * 2 * ROW_H }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {/* Day columns */}
          {dayKeys.map((dayKey) => {
            const rule = rules.find((r) => r.weekday === weekdayOf(dayKey));
            const blackout = blackoutByDate.get(dayKey);
            const bookings = dayBookings(dayKey);
            const laidOut = assignLanes(bookings);
            const laneCount = Math.max(1, ...laidOut.map((entry) => entry.lane + 1));

            return (
              <div
                key={dayKey}
                className="relative border-l border-line bg-white"
                style={{ height: gridHeight }}
              >
                {/* Thirty-minute cells: open slots can be booked or receive a dropped booking. */}
                <div className="absolute inset-0 grid" style={{ gridTemplateRows: `repeat(${rows}, ${ROW_H}px)` }}>
                  {intervalStarts.map((cellStart) => {
                    const open =
                      rule !== undefined && cellStart >= rule.startMin && cellStart + SLOT_STEP_MIN <= rule.endMin;
                    const busyHere = slotIsBusy(bookings, cellStart);
                    const fittingLessons = open && !busyHere
                      ? lessonsForSlot(cellStart, rule, blackout, bookings)
                      : [];
                    const bookable = fittingLessons.length > 0 &&
                      startsAtFor(dayKey, cellStart).getTime() >= nowMs + LEAD_TIME_MIN * 60_000;
                    return (
                      <div
                        key={cellStart}
                        className={`group relative border-t border-line ${open ? "" : CLOSED_CELL}`}
                        onDragOver={open && !busyHere && !blackout ? (event) => event.preventDefault() : undefined}
                        onDrop={open && !busyHere && !blackout ? (event) => moveBooking(event, dayKey, cellStart) : undefined}
                      >
                        {bookable && (
                          <button
                            type="button"
                            onClick={() => setSelectedSlot({ dayKey, startMin: cellStart, lessons: fittingLessons })}
                            className="absolute inset-0 z-10 flex items-center justify-center text-[10px] font-extrabold uppercase tracking-wide text-gold-deep opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Create booking on ${dayKey} at ${String(Math.floor(cellStart / 60)).padStart(2, "0")}:${String(cellStart % 60).padStart(2, "0")} Pacific time`}
                          >
                            + Book
                          </button>
                        )}
                        {cellStart % 60 === 0 && (
                          <span className="pointer-events-none absolute left-2 top-1 text-[8px] font-bold text-soft/50 md:hidden">
                            {String(Math.floor(cellStart / 60)).padStart(2, "0")}:00
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Blackout overlay */}
                {blackout && (
                  <div
                    title={blackout.reason ?? "Closed"}
                    className="absolute inset-0 z-10 flex items-start justify-center bg-[repeating-linear-gradient(45deg,#fdeceb,#fdeceb_6px,#f8dcda_6px,#f8dcda_12px)] pt-3"
                  >
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#a43232]">
                      {blackout.reason || "Blackout"}
                    </span>
                  </div>
                )}

                {/* Booking chips */}
                <div className="absolute inset-0">
                  {laidOut.map(({ booking, lane }) => {
                    const startMin = vancouverMinutes(booking.startsAt);
                    const endMin = vancouverMinutes(booking.endsAt);
                    const topPx =
                      ((Math.max(startMin, gridStartMin) - gridStartMin) / SLOT_STEP_MIN) * ROW_H;
                    const bottomPx =
                      ((Math.min(endMin, endHour * 60) - gridStartMin) / SLOT_STEP_MIN) * ROW_H;
                    const heightPx = Math.max(22, bottomPx - topPx);
                    const width = 100 / laneCount;
                    const dim =
                      booking.status === "cancelled" || booking.status === "completed";
                    return (
                      <Link
                        key={booking.id}
                        href={adminStudentHref(booking.id)}
                        draggable={isActive(booking)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/booking-id", booking.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        style={{
                          top: `${Math.max(0, topPx)}px`,
                          height: `${Math.min(heightPx, gridHeight)}px`,
                          left: `${lane * width}%`,
                          width: `calc(${width}% - 4px)`,
                        }}
                        title="Drag to another open time, or click to view booking actions"
                        className={`absolute z-20 overflow-hidden rounded-[7px] border-l-[3px] bg-mist px-2 py-1 shadow-sm transition-shadow hover:shadow-md ${CHIP_TONES[booking.status]} ${
                          dim ? "pointer-events-none opacity-60" : ""
                        }`}
                      >
                        <span className="block truncate text-[10.5px] font-extrabold text-ink">
                          {formatSlotTime(booking.startsAt)} · {booking.studentName}
                        </span>
                        <span className="block truncate text-[10px] text-soft">
                          {booking.lessonName}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dropError && (
        <p role="alert" className="mx-3 my-3 rounded-[10px] bg-[#fff0ed] px-3 py-2 text-[12.5px] font-semibold text-[#bc4633] md:mx-0">
          {dropError}
        </p>
      )}
      {moving && (
        <p role="status" className="mx-3 my-3 text-[12px] font-bold text-soft md:mx-0">
          Rechecking availability and moving booking…
        </p>
      )}

      {/* ---- Mobile: day-focused slots or a compact week overview ---- */}
      <div className="grid gap-3 lg:hidden">
        {dayKeys.map((dayKey) => {
          const bookings = dayBookings(dayKey);
          const isToday = dayKey === today;
          const blackout = blackoutByDate.get(dayKey);
          const rule = rules.find((item) => item.weekday === weekdayOf(dayKey));
          const mobileBookableSlots = intervalStarts.filter((startMin) =>
            !blackout &&
            rule !== undefined &&
            startMin >= rule.startMin &&
            startMin + SLOT_STEP_MIN <= rule.endMin &&
            startsAtFor(dayKey, startMin).getTime() >= nowMs + LEAD_TIME_MIN * 60_000 &&
            lessonsForSlot(startMin, rule, blackout, bookings).length > 0,
          );
          return (
            <div
              key={dayKey}
              className={`rounded-[14px] border bg-white p-3 ${
                isToday ? "border-gold ring-2 ring-gold/25" : "border-line"
              }`}
            >
              <Link
                href={href({ view: "day", date: dayKey, ...filters })}
                className="block text-[12.5px] font-extrabold text-ink hover:text-gold-deep"
              >
                {weekdayLabel(dayKey)} {dayNumber(dayKey)}
                {bookings.length > 0 && (
                  <span className="ml-2 text-[11px] font-bold text-gold-deep">
                    {bookings.length} booked
                  </span>
                )}
              </Link>
              {blackout ? (
                <p className="mt-2 rounded-[8px] bg-[#fdecec] px-2 py-1.5 text-[11.5px] font-bold text-[#a43232]">
                  {blackout.reason || "Blackout"} — closed
                </p>
              ) : dayKeys.length === 1 ? (
                <>
                  <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-soft">
                    Available starts · Pacific Time
                  </p>
                  {mobileBookableSlots.length > 0 ? (
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {mobileBookableSlots.map((startMin) => (
                        <button
                          key={startMin}
                          type="button"
                          onClick={() => setSelectedSlot({
                            dayKey,
                            startMin,
                            lessons: lessonsForSlot(startMin, rule, blackout, bookings),
                          })}
                          className="h-9 rounded-[8px] border border-line bg-white text-[12px] font-extrabold text-ink hover:border-gold hover:bg-gold-soft"
                        >
                          {String(Math.floor(startMin / 60)).padStart(2, "0")}:{String(startMin % 60).padStart(2, "0")}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-soft">
                      No open starts remain for this date.
                    </p>
                  )}
                  {bookings.length > 0 && (
                    <div className="mt-3 grid gap-1.5 border-t border-line pt-3">
                      {bookings.map((booking) => (
                        <Link
                          key={booking.id}
                          href={adminStudentHref(booking.id)}
                          className={`rounded-[8px] border-l-[3px] bg-mist px-2 py-1.5 text-[11px] leading-tight hover:bg-gold-soft ${CHIP_TONES[booking.status]}`}
                        >
                          <span className="block font-extrabold text-ink">
                            {formatSlotTime(booking.startsAt)} · {booking.studentName}
                          </span>
                          <span className="block truncate text-soft">{booking.lessonName}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : bookings.length === 0 ? (
                <p className="mt-2 text-[11.5px] text-soft">Open — nothing booked.</p>
              ) : (
                <div className="mt-2 grid gap-1.5">
                  {bookings.map((booking) => (
                    <Link
                      key={booking.id}
                      href={adminStudentHref(booking.id)}
                      className={`rounded-[8px] border-l-[3px] bg-mist px-2 py-1.5 text-[11px] leading-tight hover:bg-gold-soft ${CHIP_TONES[booking.status]}`}
                    >
                      <span className="block font-extrabold text-ink">
                        {formatSlotTime(booking.startsAt)} · {booking.studentName}
                      </span>
                      <span className="block truncate text-soft">{booking.lessonName}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedSlot && (
        <QuickBookDialog
          dayKey={selectedSlot.dayKey}
          startMin={selectedSlot.startMin}
          lessons={selectedSlot.lessons}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  );
}
