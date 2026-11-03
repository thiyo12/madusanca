/** Client-safe formatting helpers — no server-only imports. */

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

const PCT_EFFECTIVE_UTC = Date.UTC(2026, 10, 1, 9);
const PCT_OFFSET_MS = -7 * 60 * 60_000;

function formatPacific(instant: Date, options: Intl.DateTimeFormatOptions): string {
  const permanentPacific = instant.getTime() >= PCT_EFFECTIVE_UTC;
  const adjusted = permanentPacific ? new Date(instant.getTime() + PCT_OFFSET_MS) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    ...options,
    timeZone: permanentPacific ? "UTC" : "America/Vancouver",
  }).format(adjusted);
}

export function formatSlotTime(iso: string): string {
  return formatPacific(new Date(iso), { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, " ");
}

export function formatSlotDay(iso: string): string {
  return formatPacific(new Date(iso), { weekday: "short", month: "short", day: "numeric" });
}

export function formatSlotFull(iso: string): string {
  return formatPacific(new Date(iso), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).replace(/\s/g, " ");
}

/** YYYY-MM-DD in Vancouver — used as the grouping key for the day picker. */
export function dayKeyOf(iso: string): string {
  return formatPacific(new Date(iso), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Add calendar months while clamping end-of-month dates (e.g. Jan 31 → Mar 31). */
export function addMonthsToKey(dayKey: string, months: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
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
