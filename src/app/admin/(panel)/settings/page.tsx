import type { Metadata } from "next";
import { getStore } from "@/lib/booking/store";
import {
  addBlackoutAction,
  removeBlackoutAction,
  saveRulesAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Settings — Wisdom Driving Academy Admin",
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function toTimeInput(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const errorMessage = typeof params.error === "string" ? params.error : null;
  const successMessage = typeof params.success === "string" ? params.success : null;

  const store = getStore();
  const [rules, blackouts] = await Promise.all([store.getRules(), store.getBlackouts()]);

  const byWeekday = new Map(rules.map((rule) => [rule.weekday, rule]));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
        Admin
      </p>
      <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
        Settings
      </h1>

      {errorMessage && (
        <p role="alert" className="mt-5 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p role="status" className="mt-5 rounded-lg bg-[#e6f6ec] px-4 py-3 text-[13px] font-semibold text-[#1f7a45]">
          {successMessage}
        </p>
      )}

      <section className="mt-6 rounded-[18px] border border-line bg-white p-5 sm:p-6">
        <h2 className="text-[15px] font-extrabold text-ink">Weekly availability</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
          Hours when lessons may be booked (Pacific Time). Closed days never
          appear on the public booking calendar.
        </p>

        <form action={saveRulesAction} className="mt-5 grid gap-3">
          {order.map((weekday) => {
            const rule = byWeekday.get(weekday);
            const closed = !rule;
            return (
              <div
                key={weekday}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[12px] border border-line px-3.5 py-3 sm:grid-cols-[140px_1fr_auto]"
              >
                <span className="text-[13.5px] font-extrabold text-ink">{DAY_NAMES[weekday]}</span>

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name={`open_${weekday}`}
                    defaultValue={rule ? toTimeInput(rule.startMin) : "09:00"}
                    disabled={closed}
                    aria-label={`${DAY_NAMES[weekday]} opening time`}
                    className="h-9 rounded-[8px] border border-[#dce0e4] bg-white px-2 text-[13px] text-ink outline-none focus:border-gold disabled:bg-mist disabled:text-soft"
                  />
                  <span className="text-[12px] text-soft">to</span>
                  <input
                    type="time"
                    name={`close_${weekday}`}
                    defaultValue={rule ? toTimeInput(rule.endMin) : "18:00"}
                    disabled={closed}
                    aria-label={`${DAY_NAMES[weekday]} closing time`}
                    className="h-9 rounded-[8px] border border-[#dce0e4] bg-white px-2 text-[13px] text-ink outline-none focus:border-gold disabled:bg-mist disabled:text-soft"
                  />
                </div>

                <label className="flex items-center gap-2 text-[12.5px] font-bold text-[#4b525e]">
                  <input
                    type="checkbox"
                    name={`closed_${weekday}`}
                    defaultChecked={closed}
                    className="h-4 w-4 accent-[#e3a721]"
                  />
                  Closed
                </label>
              </div>
            );
          })}

          <div className="mt-2">
            <button
              type="submit"
              className="btn-gold inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-extrabold"
            >
              Save availability
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-[18px] border border-line bg-white p-5 sm:p-6">
        <h2 className="text-[15px] font-extrabold text-ink">Blackout dates</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
          Statutory holidays, vacation, vehicle service — any day you want fully
          blocked. Today is {todayKey}.
        </p>

        <form action={addBlackoutAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-[12px] font-bold text-[#282c33]">
            Date
            <input
              type="date"
              name="date"
              required
              min={todayKey}
              className="h-10 rounded-[10px] border border-[#dce0e4] bg-white px-3 text-sm text-ink outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/25"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-bold text-[#282c33]">
            Reason (optional)
            <input
              name="reason"
              maxLength={120}
              placeholder="e.g. Statutory holiday"
              className="h-10 w-[220px] rounded-[10px] border border-[#dce0e4] bg-white px-3 text-sm text-ink outline-none placeholder:text-[#9aa1a9] focus:border-gold focus:ring-[3px] focus:ring-gold/25"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[13px] font-extrabold text-ink transition-colors hover:border-gold hover:text-gold-deep"
          >
            Add blackout
          </button>
        </form>

        <div className="mt-5">
          {blackouts.length === 0 ? (
            <p className="text-[13px] text-soft">No blackout dates set.</p>
          ) : (
            <ul className="grid gap-2">
              {blackouts.map((blackout) => (
                <li
                  key={blackout.date}
                  className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3.5 py-2.5"
                >
                  <span className="text-[13px] font-bold text-ink">
                    {blackout.date}
                    {blackout.reason && (
                      <span className="ml-2 font-semibold text-soft">— {blackout.reason}</span>
                    )}
                  </span>
                  <form action={removeBlackoutAction.bind(null, blackout.date)}>
                    <button
                      type="submit"
                      className="rounded-[8px] border border-[#f3d1c9] px-3 py-1.5 text-[11.5px] font-extrabold text-[#bc4633] hover:bg-[#fff5f2]"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-4 text-[12.5px] leading-relaxed text-soft">
        Availability changes apply to new bookings instantly. Existing bookings
        are never auto-moved — reschedule them from the bookings table.
      </p>
    </div>
  );
}
