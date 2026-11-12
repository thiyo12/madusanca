import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import type { BookingRecord, BookingStatus } from "@/lib/booking/types";
import {
  addDaysToKey,
  dayKeyOf,
  monthLabel,
} from "@/lib/booking/format";
import { CHIP_TONES, MonthGrid, href, type CalendarFilters } from "./month-grid";
import { ScheduleGrid } from "./schedule-grid";
import { DayBookingsAccordion, type DayBookingAccordionEntry } from "./day-bookings-accordion";
import { searchStudentByLicenseAction } from "./actions";
import { assessmentForBooking, studentForBooking } from "@/lib/admin/student-profiles";

export const metadata: Metadata = {
  title: "Calendar — Wisdom Driving Academy Admin",
};

type View = "month" | "week";

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function todayAndTimestamp(): { dayKey: string; nowMs: number } {
  const now = new Date();
  return {
    dayKey: dayKeyOf(now.toISOString()),
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
  { tone: CHIP_TONES.confirmed, label: "Booked", title: "Lesson is scheduled" },
  { tone: CHIP_TONES.rescheduled, label: "Moved", title: "Lesson time was changed" },
  { tone: CHIP_TONES.no_show, label: "Student missed", title: "Records that the student did not attend" },
  { tone: CHIP_TONES.completed, label: "Completed", title: "Lesson took place" },
  { tone: CHIP_TONES.cancelled, label: "Cancelled", title: "Booking was cancelled" },
];

export default async function AdminCalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams;

  const { dayKey: today, nowMs } = todayAndTimestamp();
  const viewParam = typeof params.view === "string" ? params.view : "week";
  const view: View = viewParam === "month" ? "month" : "week";
  const dateParam = typeof params.date === "string" ? params.date : "";
  const anchor = isValidKey(dateParam) ? dateParam : today;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const statusParam = typeof params.status === "string" ? params.status : "";
  const selectedBookingId = typeof params.booking === "string" ? params.booking : "";
  const licenseSearchState = typeof params.licenseSearch === "string" ? params.licenseSearch : "";
  const pageError = typeof params.error === "string" ? params.error : "";
  const validStatuses: BookingStatus[] = ["pending_payment", "confirmed", "rescheduled", "completed", "cancelled", "no_show"];
  const status = validStatuses.includes(statusParam as BookingStatus)
    ? (statusParam as BookingStatus)
    : undefined;
  const filters: CalendarFilters = { q: query || undefined, status };

  const bounds = view === "month"
    ? monthBounds(anchor)
    : (() => {
        const from = startOfWeek(anchor);
        return { from, to: addDaysToKey(from, 6) };
      })();

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

  // Extend beyond normal hours so custom admin start times are visible.
  const startHour = rules.length > 0 ? Math.max(0, Math.floor(Math.min(...rules.map((r) => r.startMin)) / 60) - 2) : 7;
  const endHour = rules.length > 0 ? Math.min(24, Math.ceil((Math.max(...rules.map((r) => r.endMin)) + 120) / 60)) : 20;

  const shift = view === "month" ? addMonths(anchor, -1) : addDaysToKey(anchor, -7);
  const next = view === "month" ? addMonths(anchor, 1) : addDaysToKey(anchor, 7);

  const title = view === "month" ? monthLabel(`${anchor.slice(0, 7)}-01`) : `Schedule · week of ${monthLabel(bounds.from)}`;

  const weekKeys = Array.from({ length: 7 }, (_, index) => addDaysToKey(bounds.from, index));
  const dayBookingEntries: DayBookingAccordionEntry[] = [];
  const selectedBooking = selectedBookingId ? bookings.find((booking) => booking.id === selectedBookingId) : undefined;
  if (selectedBooking) {
    const email = selectedBooking.email.trim().toLowerCase();
    const studentBookings = (await store.listBookings({ search: email }))
      .filter((item) => item.email.trim().toLowerCase() === email);
    const booking = selectedBooking;
    const packageId = booking.packageId ?? booking.id;
    const packageSessions = studentBookings
      .filter((item) => (item.packageId ?? item.id) === packageId && item.lessonId === booking.lessonId);
    const packageAnchor = packageSessions.find((item) => item.sessionIndex === 1) ?? booking;
    const nextLesson = packageSessions
      .filter((item) => item.startsAt > booking.startsAt && ["confirmed", "rescheduled", "pending_payment"].includes(item.status))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
    const profile = await studentForBooking(booking.id);
    dayBookingEntries.push({
      booking: {
          id: booking.id,
          reference: booking.reference,
          lessonName: booking.lessonName,
          durationMin: booking.durationMin,
          priceCad: booking.priceCad,
          startsAt: booking.startsAt,
          studentName: booking.studentName,
          email: booking.email,
          phone: booking.phone,
          notes: booking.notes,
          status: booking.status,
          paymentStatus: booking.paymentStatus ?? "due",
          sessionIndex: booking.sessionIndex ?? 1,
          sessionCount: booking.sessionCount ?? packageSessions.length,
          packagePriceCad: booking.packagePriceCad ?? booking.priceCad,
          report: await assessmentForBooking(booking.id),
      },
      packagePlan: {
        lessonName: packageAnchor.lessonName,
        totalClasses: Math.max(packageAnchor.sessionCount ?? 1, packageSessions.length),
        completedClasses: packageSessions.filter((item) => item.status === "completed").length,
        remainingClasses: packageSessions.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
        nextLessonAt: nextLesson?.startsAt ?? null,
      },
      studentDetails: profile ? {
        dateOfBirth: profile.date_of_birth,
        gender: profile.gender,
        licenseNumber: profile.license_number,
        licenseClass: profile.license_class,
        street: profile.street,
        city: profile.city,
        province: profile.province,
        postalCode: profile.postal_code,
      } : null,
    });
  }

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
            {(["week", "month"] as const).map((item) => (
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

      {pageError && <p role="alert" className="mt-3 rounded-lg border border-[#f3d1c9] bg-[#fff5f2] px-4 py-3 text-sm font-semibold text-[#bc4633]">{pageError === "report" ? "Please rate each skill in the lesson report, then save it." : pageError === "student" ? "This student record needs to be linked before a report can be saved." : pageError}</p>}

      <form action={searchStudentByLicenseAction} className="mt-4 flex flex-wrap items-end gap-2.5 rounded-[12px] border border-line bg-white p-3">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={anchor} />
        <label className="grid gap-1 text-[11px] font-bold text-soft">
          Search for
          <select name="mode" defaultValue="booking" className="h-9 rounded-[8px] border border-[#dce0e4] bg-white px-3 text-[13px] text-ink outline-none focus:border-gold">
            <option value="booking">Bookings</option>
            <option value="license">Student by licence</option>
          </select>
        </label>
        <label className="grid min-w-[220px] flex-1 gap-1 text-[11px] font-bold text-soft">
          Search
          <input
            name="query"
            defaultValue={query}
            placeholder="Student, email, phone, reference or licence"
            maxLength={160}
            required
            autoComplete="off"
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
            <option value="rescheduled">Moved</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">Student missed</option>
          </select>
        </label>
        <button type="submit" className="btn-gold inline-flex h-9 items-center rounded-[8px] px-4 text-[12px] font-extrabold">
          Search
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
      {licenseSearchState === "none" && <p role="status" className="mt-2 text-sm text-soft">No student matched that driver’s licence number.</p>}
      {licenseSearchState === "invalid" && <p role="alert" className="mt-2 text-sm text-[#bc4633]">Enter a valid driver’s licence number.</p>}

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
            selectedBookingId={selectedBookingId}
          />
        </div>
      )}

      {selectedBooking && (
        <div id="agenda" className="mt-5 rounded-[18px] border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-[14px] font-extrabold text-ink">Lesson details</h2>
            <Link href={href({ view, date: anchor, ...filters })} className="text-[11px] font-bold text-soft hover:text-ink">Close ×</Link>
          </div>
          <DayBookingsAccordion entries={dayBookingEntries} nowMs={nowMs} initialOpenId={selectedBooking.id} day={dayKeyOf(selectedBooking.startsAt)} view={view} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          {LEGEND.map((item) => (
            <span key={item.label} title={item.title} className="flex items-center gap-1.5 text-[11.5px] font-bold text-soft">
              <span className={`h-2.5 w-2.5 rounded-[3px] border-l-[3px] ${item.tone}`} />
              {item.label}
            </span>
          ))}
          <span title="Usually unavailable to students. Admins can add a lesson here if it does not overlap." className="flex items-center gap-1.5 text-[11.5px] font-bold text-soft">
            <span className={CLOSED_SWATCH} />
            Outside usual hours
          </span>
        </div>
        <p className="text-[12px] text-soft">
          Lessons block the tutor for their reserved time. Admins can choose a custom time; the calendar prevents overlaps.
        </p>
      </div>
    </div>
  );
}

const CLOSED_SWATCH =
  "h-2.5 w-2.5 rounded-[3px] bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_3px,#e9ebee_3px,#e9ebee_6px)]";
