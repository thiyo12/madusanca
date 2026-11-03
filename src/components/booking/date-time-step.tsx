"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDaysToKey,
  dayKeyOf,
  dayNumber,
  formatSlotTime,
  monthLabel,
  todayKey,
  weekdayLabel,
} from "@/lib/booking/format";
import { occupiedDurationMin } from "@/lib/booking/slots";

export interface DateTimeStepProps {
  lessonId: string;
  selectedStart: string | null;
  onSelect: (startsAt: string) => void;
  maxDate?: string;
  minDate?: string;
  horizonDays?: number;
  blockedStartsAt?: Array<{ startsAt: string; durationMin: number }>;
  onUnavailableSelection?: () => void;
}

interface AvailabilityResponse {
  ok: boolean;
  error?: string;
  slots?: string[];
  durationMin?: number;
}

export function DateTimeStep({ lessonId, selectedStart, onSelect, maxDate, minDate, horizonDays = 90, blockedStartsAt = [], onUnavailableSelection }: DateTimeStepProps) {
  const [slots, setSlots] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(90);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<string>(() => todayKey());
  const [visibleMonth, setVisibleMonth] = useState<string>(() => todayKey().slice(0, 7));

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let requestInFlight = false;
    const from = todayKey();
    const to = addDaysToKey(from, horizonDays);
    const url = `/api/availability?lessonId=${encodeURIComponent(lessonId)}&from=${from}&to=${to}`;

    async function refreshAvailability() {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      const isInitialLoad = !loaded;
      try {
        const response = await fetch(url, { cache: "no-store" });
        const data = (await response.json()) as AvailabilityResponse;
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.slots) {
          if (isInitialLoad) {
            setStatus("error");
            setErrorMessage(data.error ?? "Could not load available times.");
          }
          return;
        }
        const visibleSlots = data.slots.filter((slot) =>
          (!maxDate || dayKeyOf(slot) <= maxDate) && (!minDate || dayKeyOf(slot) >= minDate),
        );
        setSlots(visibleSlots);
        setDurationMin(data.durationMin ?? 90);
        setStatus("ready");
        loaded = true;
        if (isInitialLoad) {
          const firstDay = visibleSlots[0] ? dayKeyOf(visibleSlots[0]) : null;
          if (firstDay) {
            setVisibleMonth(firstDay.slice(0, 7));
            setActiveDay(firstDay);
          }
        }
      } catch {
        if (cancelled) return;
        if (isInitialLoad) {
          setStatus("error");
          setErrorMessage("Could not load available times. Please try again.");
        }
      } finally {
        requestInFlight = false;
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAvailability();
    };

    void refreshAvailability();
    const refreshInterval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [lessonId, maxDate, minDate, horizonDays]);

  const availableSlots = useMemo(
    () => slots.filter((slot) => !blockedStartsAt.some((blocked) => {
      const slotStart = Date.parse(slot);
      const blockedStart = Date.parse(blocked.startsAt);
      const candidateEnd = slotStart + occupiedDurationMin(durationMin) * 60_000;
      const blockedEnd = blockedStart + occupiedDurationMin(blocked.durationMin) * 60_000;
      return slotStart < blockedEnd && blockedStart < candidateEnd;
    })),
    [slots, blockedStartsAt, durationMin],
  );

  useEffect(() => {
    if (status !== "ready" || !selectedStart) return;
    const normalizedSelection = new Date(selectedStart).toISOString();
    if (!availableSlots.includes(normalizedSelection)) onUnavailableSelection?.();
  }, [status, selectedStart, availableSlots, onUnavailableSelection]);

  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of availableSlots) {
      const key = dayKeyOf(slot);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const start = todayKey();
    const list: Array<{ key: string; count: number }> = [];
    for (let i = 0; i < horizonDays + 1; i += 1) {
      const key = addDaysToKey(start, i);
      if ((!maxDate || key <= maxDate) && (!minDate || key >= minDate)) list.push({ key, count: counts.get(key) ?? 0 });
    }
    return list;
  }, [availableSlots, maxDate, minDate, horizonDays]);

  const monthKeys = useMemo(() => Array.from(new Set(days.map((day) => day.key.slice(0, 7)))), [days]);
  const displayedMonth = monthKeys.includes(visibleMonth) ? visibleMonth : monthKeys[0] ?? visibleMonth;
  const visibleMonthIndex = monthKeys.indexOf(displayedMonth);
  const monthDays = days.filter((day) => day.key.startsWith(`${displayedMonth}-`));
  const daySlots = useMemo(() => availableSlots.filter((slot) => dayKeyOf(slot) === activeDay), [availableSlots, activeDay]);

  function changeMonth(offset: number) {
    const nextMonth = monthKeys[visibleMonthIndex + offset];
    if (!nextMonth) return;
    setVisibleMonth(nextMonth);
    const nextMonthDays = days.filter((day) => day.key.startsWith(`${nextMonth}-`));
    setActiveDay(nextMonthDays.find((day) => day.count > 0)?.key ?? nextMonthDays[0]?.key ?? activeDay);
  }

  if (status === "loading") {
    return (
      <div
        role="status"
        className="grid min-h-[220px] place-items-center rounded-[16px] border border-line bg-mist text-sm font-bold text-soft"
      >
        Loading available times…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className="rounded-[16px] border border-[#f3d1c9] bg-[#fff5f2] p-5 text-sm font-semibold text-[#bc4633]"
      >
        {errorMessage}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[12.5px] font-semibold text-soft">
        Times shown in Pacific Time (America/Vancouver). {durationMin}-minute lesson.
      </p>

      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous month"
          disabled={visibleMonthIndex <= 0}
          onClick={() => changeMonth(-1)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-white text-lg font-bold text-ink transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">←</span>
        </button>
        <h3 className="text-center text-sm font-extrabold text-ink" aria-live="polite">
          {monthLabel(`${displayedMonth}-01`)}
        </h3>
        <button
          type="button"
          aria-label="Next month"
          disabled={visibleMonthIndex < 0 || visibleMonthIndex >= monthKeys.length - 1}
          onClick={() => changeMonth(1)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-white text-lg font-bold text-ink transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={`Choose a date in ${monthLabel(`${displayedMonth}-01`)}`}>
        {monthDays.map((day) => {
          const available = day.count > 0;
          const active = day.key === activeDay;
          return (
            <button
              key={day.key}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={!available}
              onClick={() => setActiveDay(day.key)}
              className={`w-[67px] shrink-0 rounded-[13px] border px-2 py-2.5 text-center transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                 active
                   ? "border-[#102a28] bg-[#102a28] text-white"
                  : available
                    ? "border-line bg-white text-ink hover:border-gold"
                    : "border-transparent bg-mist text-[#a5abb3]"
              }`}
            >
              <span className="block text-[10px] font-extrabold uppercase tracking-wider">
                {weekdayLabel(day.key)}
              </span>
              <span className="mt-0.5 block text-[17px] font-extrabold leading-none">
                {dayNumber(day.key)}
              </span>
              <span className={`mt-1 block text-[9.5px] font-bold ${active ? "text-[#c2ee84]" : "text-soft"}`}>
                {available ? `${day.count} slots` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {daySlots.length === 0 ? (
        <p className="rounded-[14px] border border-line bg-mist p-5 text-sm text-soft">
          No times left on this day. Pick another date above.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
          {daySlots.map((slot) => {
            const active = slot === selectedStart;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onSelect(slot)}
                aria-pressed={active}
                className={`rounded-[13px] border px-2 py-3 text-[13.5px] font-extrabold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                   active
                     ? "border-[#8dbd62] bg-[#c2ee84] text-[#102a28]"
                    : "border-line bg-white text-ink hover:border-gold hover:bg-gold-soft"
                }`}
              >
                {formatSlotTime(slot)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
