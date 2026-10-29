/** Client-safe formatting helpers — no server-only imports. */

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

const SLOT_TIME_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const SLOT_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const SLOT_FULL_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatSlotTime(iso: string): string {
  return SLOT_TIME_FORMAT.format(new Date(iso)).replace(/\s/g, " ");
}

export function formatSlotDay(iso: string): string {
  return SLOT_DAY_FORMAT.format(new Date(iso));
}

export function formatSlotFull(iso: string): string {
  return SLOT_FULL_FORMAT.format(new Date(iso));
}

/** YYYY-MM-DD in Vancouver — used as the grouping key for the day picker. */
export function dayKeyOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayKey(): string {
  return dayKeyOf(new Date().toISOString());
}

export function weekdayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function dayNumber(dayKey: string): string {
  return dayKey.slice(8, 10).replace(/^0/, "");
}

export function monthLabel(dayKey: string): string {
  const [y, m] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}
