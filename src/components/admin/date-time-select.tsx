"use client";

import { useState } from "react";

const selectClass =
  "h-10 min-w-0 rounded-[9px] border border-[#dce0e4] bg-white px-2 text-[13px] text-ink outline-none focus:border-gold focus:ring-2 focus:ring-gold/25";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Explicit selects avoid depending on a browser/OS native date-picker popup. */
export function DateSelect({
  name,
  value,
  min,
  max,
  label,
  onChange,
}: {
  name: string;
  value: string;
  min?: string;
  max?: string;
  label: string;
  onChange?: (value: string) => void;
}) {
  const [date, setDate] = useState(value);
  const [year, month, day] = date.split("-").map(Number);
  const [minYear] = (min ?? `${year}-01-01`).split("-").map(Number);
  const [maxYear] = (max ?? `${year + 5}-12-31`).split("-").map(Number);
  const firstYear = Math.min(minYear, year);
  const lastYear = Math.max(maxYear, year);

  function update(nextYear: number, nextMonth: number, nextDay: number) {
    const clampedDay = Math.min(nextDay, daysInMonth(nextYear, nextMonth));
    const next = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
    setDate(next);
    onChange?.(next);
  }

  const months = MONTHS.map((name, index) => ({ name, value: index + 1 })).filter(({ value: monthValue }) => {
    const firstDay = `${String(year).padStart(4, "0")}-${String(monthValue).padStart(2, "0")}-01`;
    const lastDay = `${String(year).padStart(4, "0")}-${String(monthValue).padStart(2, "0")}-${daysInMonth(year, monthValue)}`;
    return (!min || lastDay >= min) && (!max || firstDay <= max);
  });
  const count = daysInMonth(year, month);
  const days = Array.from({ length: count }, (_, index) => index + 1).filter((dayValue) => {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dayValue).padStart(2, "0")}`;
    return (!min || key >= min) && (!max || key <= max);
  });

  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-bold text-[#282c33]">{label}</span>
      <input type="hidden" name={name} value={date} />
      <div className="grid grid-cols-[1fr_1.2fr_.8fr] gap-1.5" role="group" aria-label={label}>
        <select aria-label={`${label} year`} className={selectClass} value={year} onChange={(event) => update(Number(event.target.value), month, day)}>
          {Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select aria-label={`${label} month`} className={selectClass} value={month} onChange={(event) => update(year, Number(event.target.value), day)}>
          {months.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
        </select>
        <select aria-label={`${label} day`} className={selectClass} value={day} onChange={(event) => update(year, month, Number(event.target.value))}>
          {days.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
    </div>
  );
}

/** 12-hour selects serialize a stable HH:mm value for the existing actions. */
export function TimeSelect({
  name,
  value,
  label,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  onChange?: (value: string) => void;
}) {
  const [hourText, minuteText] = value.split(":");
  const initialHour = Number(hourText);
  const [hour, setHour] = useState(initialHour % 12 || 12);
  const [minute, setMinute] = useState(Number(minuteText));
  const [period, setPeriod] = useState(initialHour >= 12 ? "PM" : "AM");
  const value24 = `${String((hour % 12) + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  function setTime(nextHour: number, nextMinute: number, nextPeriod: string) {
    onChange?.(`${String((nextHour % 12) + (nextPeriod === "PM" ? 12 : 0)).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`);
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-bold text-[#282c33]">{label}</span>
      <input type="hidden" name={name} value={value24} />
      <div className="grid grid-cols-[1fr_1fr_.9fr] gap-1.5" role="group" aria-label={label}>
        <select aria-label={`${label} hour`} className={selectClass} value={hour} onChange={(event) => { const next = Number(event.target.value); setHour(next); setTime(next, minute, period); }}>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{String(item).padStart(2, "0")}</option>)}
        </select>
        <select aria-label={`${label} minute`} className={selectClass} value={minute} onChange={(event) => { const next = Number(event.target.value); setMinute(next); setTime(hour, next, period); }}>
          {Array.from({ length: 60 }, (_, index) => index).map((item) => <option key={item} value={item}>{String(item).padStart(2, "0")}</option>)}
        </select>
        <select aria-label={`${label} AM or PM`} className={selectClass} value={period} onChange={(event) => { setPeriod(event.target.value); setTime(hour, minute, event.target.value); }}>
          <option>AM</option>
          <option>PM</option>
        </select>
      </div>
    </div>
  );
}
