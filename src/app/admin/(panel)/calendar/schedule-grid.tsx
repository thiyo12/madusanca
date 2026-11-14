"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AvailabilityRule, BlackoutDate, BookingRecord } from "@/lib/booking/types";
import { dayKeyOf, dayNumber, formatSlotDay, formatSlotFull, formatSlotTime, weekdayLabel } from "@/lib/booking/format";
import { calendarDropStartMin, occupiedDurationMin, toVancouverParts, zonedToUtc } from "@/lib/booking/slots";
import type { Lesson } from "@/lib/data/lessons";
import { rescheduleBookingAction } from "../bookings/actions";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { bookingAgendaHref, CHIP_TONES, href, isBookingOverdue, type CalendarFilters } from "./month-grid";

/** Ten-minute rows let admins place lessons at custom start times. */
const ROW_H = 12;
const SLOT_STEP_MIN = 10;

interface ScheduleGridProps {
  dayKeys: string[];
  byDay: Record<string, BookingRecord[]>;
  rules: AvailabilityRule[];
  blackouts: BlackoutDate[];
  today: string;
  lessons: Lesson[];
  nowMs: number;
  filters?: CalendarFilters;
  selectedBookingId?: string;
  /** Hour bounds of the grid (Vancouver wall clock). */
  startHour: number;
  endHour: number;
}

function vancouverMinutes(iso: string): number {
  return toVancouverParts(new Date(iso)).minutesOfDay;
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
    const end = start + occupiedDurationMin(booking.durationMin) * 60_000;
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
  selectedBookingId,
  startHour,
  endHour,
}: ScheduleGridProps) {
  const router = useRouter();
  const [wizardSlot, setWizardSlot] = useState<{ dayKey: string; startMin: number; selectedMinutes: number } | null>(null);
  const [rangeSelection, setRangeSelection] = useState<{ dayKey: string; anchor: number; current: number } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ booking: BookingRecord; dayKey: string; startMin: number; startsAt: string } | null>(null);
  const draggedBooking = useRef(false);
  const dragOrigin = useRef<{ bookingId: string; grabOffsetMin: number } | null>(null);
  const [moving, startTransition] = useTransition();
  const [currentNowMs, setCurrentNowMs] = useState(nowMs);
  const rows = Math.max(1, (endHour - startHour) * 60 / SLOT_STEP_MIN);
  const gridHeight = rows * ROW_H;
  const gridStartMin = startHour * 60;
  const currentDay = dayKeyOf(new Date(currentNowMs).toISOString());
  const intervalStarts = Array.from({ length: rows }, (_, index) => gridStartMin + index * SLOT_STEP_MIN);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const blackoutByDate = new Map(blackouts.map((b) => [b.date, b]));
  const template = `56px repeat(${dayKeys.length}, minmax(0, 1fr))`;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!rangeSelection) return;
    const finish = () => {
      const startMin = Math.min(rangeSelection.anchor, rangeSelection.current);
      if (startsAtFor(rangeSelection.dayKey, startMin).getTime() <= currentNowMs) {
        setDropError("Choose a future date and time. Past times are not available.");
        setRangeSelection(null);
        return;
      }
      setWizardSlot({
        dayKey: rangeSelection.dayKey,
        startMin,
        selectedMinutes: Math.abs(rangeSelection.current - rangeSelection.anchor) + SLOT_STEP_MIN,
      });
      setRangeSelection(null);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [rangeSelection, currentNowMs]);

  function dayBookings(dayKey: string): BookingRecord[] {
    return byDay[dayKey] ?? [];
  }

  function slotIsBusy(bookings: BookingRecord[], startMin: number): boolean {
    return bookings.some(
      (booking) =>
        isActive(booking) &&
        vancouverMinutes(booking.startsAt) < startMin + SLOT_STEP_MIN &&
        vancouverMinutes(booking.startsAt) + occupiedDurationMin(booking.durationMin) > startMin,
    );
  }

  function lessonsForSlot(startMin: number, bookings: BookingRecord[]): Lesson[] {
    return lessons.filter((lesson) => {
      const endMin = startMin + occupiedDurationMin(lesson.durationMin);
      return !bookings.some((booking) => isActive(booking) &&
        vancouverMinutes(booking.startsAt) < endMin &&
        vancouverMinutes(booking.startsAt) + occupiedDurationMin(booking.durationMin) > startMin);
    });
  }

  function moveBooking(event: React.DragEvent<HTMLDivElement>, dayKey: string, startMin: number) {
    event.preventDefault();
    const bookingId = event.dataTransfer.getData("text/booking-id") || event.dataTransfer.getData("text/plain");
    if (!bookingId) return;
    const booking = Object.values(byDay).flat().find((item) => item.id === bookingId);
    if (!booking) return;
    const grabOffsetMin = dragOrigin.current?.bookingId === bookingId ? dragOrigin.current.grabOffsetMin : 0;
    const targetStartMin = calendarDropStartMin(startMin, grabOffsetMin, SLOT_STEP_MIN);
    if (targetStartMin < 0 || targetStartMin + occupiedDurationMin(booking.durationMin) > 24 * 60) {
      setDropError("Drop the lesson where its full time block fits on the calendar.");
      return;
    }
    const [year, month, day] = dayKey.split("-").map(Number);
    const startsAt = zonedToUtc(year, month, day, targetStartMin).toISOString();
    if (Date.parse(startsAt) <= currentNowMs) {
      setDropError("Choose a future date and time. Past times are not available.");
      return;
    }
    setPendingMove({ booking, dayKey, startMin: targetStartMin, startsAt });
  }

  function confirmMove() {
    if (!pendingMove) return;
    const formData = new FormData();
    formData.set("bookingId", pendingMove.booking.id);
    formData.set("startsAt", pendingMove.startsAt);
    setDropError(null);
    startTransition(async () => {
      try {
        const result = await rescheduleBookingAction({ error: null }, formData);
        if (result.error) setDropError(result.error);
        else {
          setPendingMove(null);
          router.refresh();
        }
      } catch {
        setDropError("The lesson could not be moved. Check that the calendar migration is applied, then try again.");
      }
    });
  }

  return (
    <div>
      {/* ---- Desktop: time-grid schedule (BookingTimes model) ---- */}
      <div className="block overflow-x-auto">
        <div
          className="grid border-b border-line bg-mist"
          style={{ gridTemplateColumns: template, minWidth: dayKeys.length > 1 ? 900 : undefined }}
        >
          <div />
          {dayKeys.map((dayKey) => {
            const isToday = dayKey === today;
            const count = dayBookings(dayKey).filter(isActive).length;
            return (
              <Link
                key={dayKey}
                href={href({ view: "week", date: dayKey, ...filters })}
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
          style={{ gridTemplateColumns: template, minWidth: dayKeys.length > 1 ? 900 : undefined }}
        >
          {/* Time gutter */}
          <div className="relative border-r border-line" style={{ height: gridHeight }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] font-bold text-soft"
                style={{ top: index * 6 * ROW_H }}
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
            const selectedRange = rangeSelection?.dayKey === dayKey ? {
              startMin: Math.min(rangeSelection.anchor, rangeSelection.current),
              durationMin: Math.abs(rangeSelection.current - rangeSelection.anchor) + SLOT_STEP_MIN,
            } : null;
            const selectedRangeTop = selectedRange
              ? ((selectedRange.startMin - gridStartMin) / SLOT_STEP_MIN) * ROW_H
                + ((selectedRange.durationMin / SLOT_STEP_MIN) * ROW_H) / 2
              : 0;

            return (
              <div
                key={dayKey}
                className="relative border-l border-line bg-white"
                style={{ height: gridHeight }}
              >
                {/* Ten-minute cells: custom admin starts and drag targets. */}
                <div className="absolute inset-0 grid" style={{ gridTemplateRows: `repeat(${rows}, ${ROW_H}px)` }}>
                  {intervalStarts.map((cellStart) => {
                    const open =
                      rule !== undefined && cellStart >= rule.startMin && cellStart + SLOT_STEP_MIN <= rule.endMin;
                    const busyHere = slotIsBusy(bookings, cellStart);
                    const fittingLessons = !busyHere
                      ? lessonsForSlot(cellStart, bookings)
                      : [];
                    const bookable = fittingLessons.length > 0 && startsAtFor(dayKey, cellStart).getTime() > currentNowMs;
                    const futureAtRender = startsAtFor(dayKey, cellStart).getTime() > currentNowMs;
                    return (
                      <div
                        key={cellStart}
                        className={`group pointer-events-auto relative border-t border-line ${open && !blackout ? "" : CLOSED_CELL} ${rangeSelection?.dayKey === dayKey && cellStart >= Math.min(rangeSelection.anchor, rangeSelection.current) && cellStart <= Math.max(rangeSelection.anchor, rangeSelection.current) ? "bg-gold/30" : ""}`}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || busyHere || startsAtFor(dayKey, cellStart).getTime() <= currentNowMs) return;
                          setRangeSelection({ dayKey, anchor: cellStart, current: cellStart });
                        }}
                        onPointerEnter={() => {
                          if (rangeSelection?.dayKey === dayKey && !slotIsBusy(bookings, cellStart) && startsAtFor(dayKey, cellStart).getTime() > currentNowMs) {
                            setRangeSelection((current) => current ? { ...current, current: cellStart } : current);
                          }
                        }}
                        onDragOver={!busyHere && futureAtRender ? (event) => event.preventDefault() : undefined}
                        onDrop={!busyHere && futureAtRender ? (event) => moveBooking(event, dayKey, cellStart) : undefined}
                      >
                        {bookable && (
                          <button
                            type="button"
                            onClick={() => {
                              if (startsAtFor(dayKey, cellStart).getTime() <= currentNowMs) {
                                setDropError("Choose a future date and time. Past times are not available.");
                                return;
                              }
                              setWizardSlot({ dayKey, startMin: cellStart, selectedMinutes: SLOT_STEP_MIN });
                            }}
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

                {selectedRange && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute right-1 z-30 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] font-extrabold text-white shadow"
                    style={{ top: selectedRangeTop }}
                  >
                    {String(Math.floor(selectedRange.startMin / 60)).padStart(2, "0")}:{String(selectedRange.startMin % 60).padStart(2, "0")} · {selectedRange.durationMin} min
                  </div>
                )}

                {/* Blackout overlay */}
                {blackout && (
                  <div
                    title={blackout.reason ?? "Closed"}
                    className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-[repeating-linear-gradient(45deg,#fdeceb,#fdeceb_6px,#f8dcda_6px,#f8dcda_12px)] pt-3"
                  >
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#a43232]">
                      {blackout.reason || "Blackout"}
                    </span>
                  </div>
                )}

                {/* Booking chips */}
                <div className="pointer-events-none absolute inset-0">
                  {laidOut.map(({ booking, lane }) => {
                    const startMin = vancouverMinutes(booking.startsAt);
                    const endMin = startMin + occupiedDurationMin(booking.durationMin);
                    const topPx =
                      ((Math.max(startMin, gridStartMin) - gridStartMin) / SLOT_STEP_MIN) * ROW_H;
                    const bottomPx =
                      ((Math.min(endMin, endHour * 60) - gridStartMin) / SLOT_STEP_MIN) * ROW_H;
                    const heightPx = Math.max(22, bottomPx - topPx);
                    const width = 100 / laneCount;
                    const dim =
                      booking.status === "cancelled" || booking.status === "completed";
                    const overdue = isBookingOverdue(booking, currentDay);
                    return (
                      <Link
                        key={booking.id}
                        href={bookingAgendaHref(dayKey, booking.id, filters)}
                        draggable={isActive(booking)}
                        style={{
                          top: `${Math.max(0, topPx)}px`,
                          height: `${Math.min(heightPx, gridHeight)}px`,
                          left: `${lane * width}%`,
                          width: `calc(${width}% - 4px)`,
                          pointerEvents: "auto",
                        }}
                        onDragStart={(event) => {
                          draggedBooking.current = true;
                          event.dataTransfer.setData("text/booking-id", booking.id);
                          event.dataTransfer.setData("text/plain", booking.id);
                          event.dataTransfer.effectAllowed = "move";
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const offsetY = Math.max(0, event.clientY - bounds.top);
                          dragOrigin.current = {
                            bookingId: booking.id,
                            grabOffsetMin: Math.floor(offsetY / ROW_H) * SLOT_STEP_MIN,
                          };
                        }}
                        onDragEnd={() => window.setTimeout(() => { draggedBooking.current = false; dragOrigin.current = null; }, 500)}
                        onClick={(event) => {
                          if (!draggedBooking.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          draggedBooking.current = false;
                        }}
                        title={overdue ? "Warning: past lesson is not marked complete or missed." : "Drag the lesson’s top edge to its new start time, or click to view booking actions"}
                          className={`absolute z-20 overflow-hidden rounded-[7px] border-l-[3px] px-2 py-1 shadow-sm transition-shadow hover:shadow-md ${overdue ? "border-l-[#dc2626] bg-[#fff0ed]" : `bg-mist ${CHIP_TONES[booking.status]}`} ${booking.id === selectedBookingId ? "calendar-focus-blink" : ""} ${
                          dim ? "opacity-60" : ""
                        }`}
                      >
                        <span className={`block truncate text-[10.5px] font-extrabold ${overdue ? "text-[#bc2323]" : "text-ink"}`}>
                          {formatSlotTime(booking.startsAt)} · {booking.studentName}
                        </span>
                        <span className="block truncate text-[10px] text-soft">
                          {booking.lessonName}
                        </span>
                        {overdue && <span className="block truncate text-[9px] font-extrabold text-[#bc2323]">⚠ Past — mark complete or no-show</span>}
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

      {/* Retained hidden legacy layout; week dates always stay in the side-by-side grid above. */}
      <div className="hidden">
        {dayKeys.map((dayKey) => {
          const bookings = dayBookings(dayKey);
          const isToday = dayKey === today;
          const blackout = blackoutByDate.get(dayKey);
          const mobileBookableSlots = intervalStarts.filter((startMin) =>
            startsAtFor(dayKey, startMin).getTime() > currentNowMs &&
            lessonsForSlot(startMin, bookings).length > 0,
          );
          return (
            <div
              key={dayKey}
              className={`rounded-[14px] border bg-white p-3 ${
                isToday ? "border-gold ring-2 ring-gold/25" : "border-line"
              }`}
            >
              <Link
                href={href({ view: "week", date: dayKey, ...filters })}
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
                          onClick={() => setWizardSlot({ dayKey, startMin, selectedMinutes: SLOT_STEP_MIN })}
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
                          href={bookingAgendaHref(dayKey, booking.id, filters)}
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
                      href={bookingAgendaHref(dayKey, booking.id, filters)}
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

      {wizardSlot && (
        <div role="presentation" className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/55 px-3 py-4 sm:px-6 sm:py-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setWizardSlot(null); }}>
          <section role="dialog" aria-modal="true" aria-label="Admin booking form" className="w-full max-w-6xl rounded-[20px] bg-[#f7f7f3] p-3 shadow-2xl sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold-deep">Admin booking</p><h2 className="text-[15px] font-extrabold text-ink">Complete the booking steps</h2><p className="mt-1 text-[11px] text-soft">Selected: {weekdayLabel(wizardSlot.dayKey)} {dayNumber(wizardSlot.dayKey)} · {String(Math.floor(wizardSlot.startMin / 60)).padStart(2, "0")}:{String(wizardSlot.startMin % 60).padStart(2, "0")} Pacific · {wizardSlot.selectedMinutes} minutes dragged</p><p className="mt-1 text-[10px] text-soft">The lesson/package you choose determines the booked duration; the selected range sets its start time.</p></div>
              <button type="button" onClick={() => setWizardSlot(null)} aria-label="Close booking form" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-lg font-bold text-soft hover:bg-line hover:text-ink">×</button>
            </div>
            <BookingWizard lessons={lessons} adminMode initialStartAt={startsAtFor(wizardSlot.dayKey, wizardSlot.startMin).toISOString()} onAdminDone={() => { setWizardSlot(null); router.refresh(); }} />
          </section>
        </div>
      )}

      {pendingMove && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !moving) setPendingMove(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-move-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-gold-deep">Review change</p>
            <h2 id="calendar-move-title" className="mt-1 text-lg font-extrabold text-ink">Move this lesson?</h2>
            <p className="mt-3 text-sm font-bold text-ink">{pendingMove.booking.studentName} · {pendingMove.booking.lessonName}</p>
            <div className="mt-3 grid gap-2 rounded-xl bg-mist p-3 text-[12px]">
              <p className="text-soft">From <span className="font-bold text-ink">{formatSlotDay(pendingMove.booking.startsAt)} · {formatSlotTime(pendingMove.booking.startsAt)}</span></p>
              <p className="border-t border-line pt-2 text-soft">Moving to</p>
              <p className="text-base font-extrabold text-ink">{formatSlotFull(pendingMove.startsAt)} <span className="text-xs font-bold text-soft">Pacific Time</span></p>
            </div>
            <p className="mt-3 text-[11px] text-soft">Drop only on an empty time row. Occupied times cannot be selected. We’ll confirm availability before saving and email the student after the move.</p>
            {dropError && <p role="alert" className="mt-3 rounded-lg bg-[#fff0ed] px-3 py-2 text-xs font-semibold text-[#bc4633]">{dropError}</p>}
            <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={moving} onClick={() => setPendingMove(null)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink">Keep current time</button><button type="button" disabled={moving} onClick={confirmMove} className="btn-gold rounded-lg px-4 py-2 text-xs font-extrabold">{moving ? "Moving…" : "Confirm move"}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
