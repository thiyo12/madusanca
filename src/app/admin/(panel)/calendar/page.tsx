import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import type { BookingRecord, BookingStatus } from "@/lib/booking/types";
import {
  addDaysToKey,
  dayKeyOf,
  formatSlotTime,
  monthLabel,
  weekdayLabel,
} from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { BookingActions } from "../bookings/booking-actions";
import { CHIP_TONES, MonthGrid, href, type CalendarFilters } from "./month-grid";
import { ScheduleGrid } from "./schedule-grid";

export const metadata: Metadata = {
  title: "Calendar — Wisdom Driving Academy Admin",
};

type View = "month" | "week" | "day";

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function todayAndTimestamp(): { dayKey: string; nowMs: number } {
  const now = new Date();
  return {
    dayKey: new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    }).format(now),
    nowMs: now.getTime(),
  };
}

function isValidKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addMonths(dateKey: string, delta: number): string {
  const [y, m] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  return target.toISOString().slice(0, 10);
}

function monthBounds(dateKey: string): { from: string; to: string; days: number } {
  const [y, m] = dateKey.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${y}-${String(m).padStart(2, "0")}-${String(days).padStart(2, "0")}`,
    days,
  };
}

function startOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const offsetToMonday = (weekday + 6) % 7;
  return addDaysToKey(dateKey, -offsetToMonday);
}

function isoSpan(fromDay: string, toDay: string): { fromIso: string; toIso: string } {
  // Pad a day either side so Vancouver-day grouping never clips at the edges.
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  return {
    fromIso: new Date(from - 24 * 60 * 60 * 1000).toISOString(),
    toIso: new Date(to + 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

const LEGEND = [
  { tone: CHIP_TONES.confirmed, label: "Confirmed" },
  { tone: CHIP_TONES.rescheduled, label: "Rescheduled" },
  { tone: CHIP_TONES.completed, label: "Completed" },
  { tone: CHIP_TONES.cancelled, label: "Cancelled" },
];

export default async function AdminCalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams;

  const { dayKey: today, nowMs } = todayAndTimestamp();
  const viewParam = typeof params.view === "string" ? params.view : "week";
  const view: View = viewParam === "month" || viewParam === "day" ? viewParam : "week";
  const dateParam = typeof params.date === "string" ? params.date : "";
  const anchor = isValidKey(dateParam) ? dateParam : today;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const statusParam = typeof params.status === "string" ? params.status : "";
  const validStatuses: BookingStatus[] = ["pending_payment", "confirmed", "rescheduled", "completed", "cancelled"];
  const status = validStatuses.includes(statusParam as BookingStatus)
    ? (statusParam as BookingStatus)
    : undefined;
  const filters: CalendarFilters = { q: query || undefined, status };

  const bounds =
    view === "month"
      ? monthBounds(anchor)
      : view === "week"
        ? (() => {
            const from = startOfWeek(anchor);
            return { from, to: addDaysToKey(from, 6) };
          })()
        : { from: anchor, to: anchor };

  const { fromIso, toIso } = isoSpan(bounds.from, bounds.to);
  const store = getStore();
  const [bookings, rules, blackouts, lessons] = await Promise.all([
    store.listBookings({ fromIso, toIso, search: query || undefined, status }),
    store.getRules(),
    store.getBlackouts(),
    store.getLessons(),
  ]);

  const byDay = new Map<string, BookingRecord[]>();
  for (const booking of bookings) {
    const key = dayKeyOf(booking.startsAt);
    const list = byDay.get(key);
    if (list) list.push(booking);
    else byDay.set(key, [booking]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
  const bookingsByDay = Object.fromEntries(byDay.entries());

  // Grid hours follow the configured opening hours (Vancouver wall clock).
  const startHour = rules.length > 0 ? Math.floor(Math.min(...rules.map((r) => r.startMin)) / 60) : 9;
  const endHour = rules.length > 0 ? Math.ceil(Math.max(...rules.map((r) => r.endMin)) / 60) : 18;

  const shift =
    view === "month"
      ? addMonths(anchor, -1)
      : view === "week"
        ? addDaysToKey(anchor, -7)
        : addDaysToKey(anchor, -1);
  const next =
    view === "month"
      ? addMonths(anchor, 1)
      : view === "week"
        ? addDaysToKey(anchor, 7)
        : addDaysToKey(anchor, 1);

  const title =
    view === "month"
      ? monthLabel(`${anchor.slice(0, 7)}-01`)
      : view === "week"
        ? `Schedule · week of ${monthLabel(bounds.from)}`
        : monthLabel(anchor);

  const dayBookings = byDay.get(anchor) ?? [];
  const weekKeys = Array.from({ length: 7 }, (_, index) => addDaysToKey(bounds.from, index));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
            Admin
          </p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            {title}
          </h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-[10px] border border-line bg-white p-1" role="group" aria-label="Calendar view">
            {(["week", "day", "month"] as const).map((item) => (
              <Link
                key={item}
                href={href({ view: item, date: anchor, ...filters })}
                aria-pressed={view === item}
                className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-extrabold capitalize transition-colors ${
                  view === item ? "bg-ink text-white" : "text-soft hover:text-gold-deep"
                }`}
              >
                {item}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={href({ view, date: shift, ...filters })}
              aria-label="Previous"
              className="grid h-9 w-9 place-items-center rounded-[9px] border border-line bg-white text-ink hover:border-gold hover:text-gold-deep"
            >
              ←
            </Link>
            <Link
              href={href({ view, date: today, ...filters })}
              className="inline-flex h-9 items-center rounded-[9px] border border-line bg-white px-3 text-[12.5px] font-extrabold text-ink hover:border-gold hover:text-gold-deep"
            >
              Today
            </Link>
            <Link
              href={href({ view, date: next, ...filters })}
              aria-label="Next"
              className="grid h-9 w-9 place-items-center rounded-[9px] border border-line bg-white text-ink hover:border-gold hover:text-gold-deep"
            >
              →
            </Link>
          </div>
        </div>
      </div>

      <form method="get" action="/admin/calendar" className="mt-4 flex flex-wrap items-end gap-2.5 rounded-[12px] border border-line bg-white p-3">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={anchor} />
        <label className="grid min-w-[220px] flex-1 gap-1 text-[11px] font-bold text-soft">
          Search bookings
          <input
            name="q"
            defaultValue={query}
            placeholder="Student, email, phone or reference"
            className="h-9 rounded-[8px] border border-[#dce0e4] px-3 text-[13px] text-ink outline-none focus:border-gold"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-soft">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-9 rounded-[8px] border border-[#dce0e4] bg-white px-3 text-[13px] text-ink outline-none focus:border-gold"
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending_payment">Awaiting payment</option>
            <option value="rescheduled">Rescheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <button type="submit" className="btn-gold inline-flex h-9 items-center rounded-[8px] px-4 text-[12px] font-extrabold">
          Filter
        </button>
        {(query || status) && (
          <Link
            href={href({ view, date: anchor })}
            className="inline-flex h-9 items-center px-2 text-[12px] font-bold text-soft hover:text-ink"
          >
            Clear
          </Link>
        )}
      </form>

      {view === "month" && (
        <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-white">
          <div className="grid grid-cols-7 border-b border-line bg-mist">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <div
                key={label}
                className="px-1.5 py-2.5 text-center text-[10.5px] font-extrabold uppercase tracking-wide text-soft sm:px-3 sm:text-left"
              >
                {label}
              </div>
            ))}
          </div>
          <MonthGrid
            from={bounds.from}
            days={monthBounds(anchor).days}
            byDay={byDay}
            anchor={anchor}
            today={today}
            filters={filters}
          />
        </div>
      )}

      {view === "week" && (
        <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-white">
          <ScheduleGrid
            dayKeys={weekKeys}
            byDay={bookingsByDay}
            rules={rules}
            blackouts={blackouts}
            today={today}
            lessons={lessons}
            nowMs={nowMs}
            filters={filters}
            startHour={startHour}
            endHour={endHour}
          />
        </div>
      )}

      {view === "day" && (
        <>
          <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-white">
            <ScheduleGrid
              dayKeys={[anchor]}
              byDay={bookingsByDay}
              rules={rules}
              blackouts={blackouts}
              today={today}
              lessons={lessons}
              nowMs={nowMs}
              filters={filters}
              startHour={startHour}
              endHour={endHour}
            />
          </div>

          <div id="agenda" className="mt-6 rounded-[18px] border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-extrabold text-ink">
                {weekdayLabel(anchor)}, {monthLabel(anchor)}
              </h2>
              <span className="text-[12.5px] font-bold text-soft">
                {dayBookings.length} {dayBookings.length === 1 ? "lesson" : "lessons"}
              </span>
            </div>

            {dayBookings.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-soft">
                Nothing booked on this day.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {dayBookings.map((booking) => (
                  <li key={booking.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="text-[14px] font-extrabold text-ink">
                            {formatSlotTime(booking.startsAt)}
                          </span>
                          <span className="text-[14px] font-bold text-ink">
                            {booking.studentName}
                          </span>
                          <StatusChip status={booking.status} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-soft">
                          {booking.lessonName} · {booking.durationMin} min · $
                          {booking.priceCad} CAD · {booking.reference}
                        </p>
                        <p className="text-[12.5px] text-soft">
                          {booking.email} · {booking.phone}
                        </p>
                      </div>
                      <BookingActions
                        bookingId={booking.id}
                        lessonId={booking.lessonId}
                        status={booking.status}
                        startsAt={booking.startsAt}
                        paymentStatus={booking.paymentStatus ?? "due"}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          {LEGEND.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5 text-[11.5px] font-bold text-soft">
              <span className={`h-2.5 w-2.5 rounded-[3px] border-l-[3px] ${item.tone}`} />
              {item.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-soft">
            <span className={CLOSED_SWATCH} />
            Closed hours
          </span>
        </div>
        <p className="text-[12px] text-soft">
          Use <strong className="text-ink">+ Book</strong> on an open 30-minute slot, or drag an active booking to move it. The server checks hours, conflicts and lead time.
        </p>
      </div>
    </div>
  );
}

const CLOSED_SWATCH =
  "h-2.5 w-2.5 rounded-[3px] bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_3px,#e9ebee_3px,#e9ebee_6px)]";
