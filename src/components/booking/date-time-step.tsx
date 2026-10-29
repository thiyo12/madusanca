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

export interface DateTimeStepProps {
  lessonId: string;
  selectedStart: string | null;
  onSelect: (startsAt: string) => void;
}

const DAY_WINDOW = 21;

interface AvailabilityResponse {
  ok: boolean;
  error?: string;
  slots?: string[];
}

export function DateTimeStep({ lessonId, selectedStart, onSelect }: DateTimeStepProps) {
  const [slots, setSlots] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<string>(() => todayKey());

  useEffect(() => {
    let cancelled = false;
    const from = todayKey();
    const to = addDaysToKey(from, DAY_WINDOW);

    fetch(`/api/availability?lessonId=${encodeURIComponent(lessonId)}&from=${from}&to=${to}`)
      .then(async (response) => {
        const data = (await response.json()) as AvailabilityResponse;
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.slots) {
          setStatus("error");
          setErrorMessage(data.error ?? "Could not load available times.");
          return;
        }
        setSlots(data.slots);
        setStatus("ready");
        const firstDay = data.slots[0] ? dayKeyOf(data.slots[0]) : null;
        setActiveDay((current) => {
          const currentHasSlots = data.slots!.some((slot) => dayKeyOf(slot) === current);
          if (currentHasSlots) return current;
          return firstDay ?? current;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage("Could not load available times. Please try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const key = dayKeyOf(slot);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const start = todayKey();
    const list: Array<{ key: string; count: number }> = [];
    for (let i = 0; i < DAY_WINDOW + 1; i += 1) {
      const key = addDaysToKey(start, i);
      list.push({ key, count: counts.get(key) ?? 0 });
    }
    return list;
  }, [slots]);

  const daySlots = useMemo(
    () => slots.filter((slot) => dayKeyOf(slot) === activeDay),
    [slots, activeDay],
  );

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
        Times shown in Pacific Time (America/Vancouver)
      </p>

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Choose a date">
        {days.map((day) => {
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

      <p className="mt-5 mb-3 text-[13px] font-extrabold uppercase tracking-[0.14em] text-soft">
        {monthLabel(activeDay)}
      </p>

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
