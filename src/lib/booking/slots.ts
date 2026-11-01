import type { AvailabilityRule, BlackoutDate, BusyInterval } from "@/lib/booking/types";

export const TZ = "America/Vancouver";
export const SLOT_STEP_MIN = 30;
export const LEAD_TIME_MIN = 120;
export const HORIZON_DAYS = 150;

/** Default school hours: Mon–Sat 09:00–18:00, Sunday closed. */
export const DEFAULT_RULES: AvailabilityRule[] = [
  { weekday: 1, startMin: 9 * 60, endMin: 18 * 60 },
  { weekday: 2, startMin: 9 * 60, endMin: 18 * 60 },
  { weekday: 3, startMin: 9 * 60, endMin: 18 * 60 },
  { weekday: 4, startMin: 9 * 60, endMin: 18 * 60 },
  { weekday: 5, startMin: 9 * 60, endMin: 18 * 60 },
  { weekday: 6, startMin: 9 * 60, endMin: 17 * 60 },
];

interface VancParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutesOfDay: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function toVancouverParts(date: Date): VancParts {
  const bag = new Map<string, string>();
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") bag.set(part.type, part.value);
  }
  return {
    year: Number(bag.get("year")),
    month: Number(bag.get("month")),
    day: Number(bag.get("day")),
    weekday: WEEKDAYS[bag.get("weekday") ?? "Sun"] ?? 0,
    minutesOfDay: Number(bag.get("hour")) * 60 + Number(bag.get("minute")),
  };
}

/** Minutes the Vancouver wall clock is ahead of UTC at a given instant. */
function tzOffsetMinutes(instant: Date): number {
  const p = toVancouverParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutesOfDay, 0);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Wall-clock time in Vancouver → exact UTC instant (DST-safe, two-pass). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
): Date {
  const wallUtc = Date.UTC(year, month - 1, day, 0, minutesOfDay, 0);
  let ts = wallUtc - tzOffsetMinutes(new Date(wallUtc)) * 60000;
  ts = wallUtc - tzOffsetMinutes(new Date(ts)) * 60000;
  return new Date(ts);
}

export function toVancouverDayKey(date: Date): string {
  const p = toVancouverParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function toBusyRanges(busy: BusyInterval[]): Array<[number, number]> {
  return busy.map((b) => [Date.parse(b.startsAt), Date.parse(b.endsAt)] as [number, number]);
}

export interface SlotQuery {
  lessonDurationMin: number;
  /** YYYY-MM-DD in Vancouver; defaults to today. */
  fromDayKey?: string;
  /** YYYY-MM-DD in Vancouver; clamped to the horizon. */
  toDayKey?: string;
  busy: BusyInterval[];
  blackouts: BlackoutDate[];
  rules: AvailabilityRule[];
  now?: Date;
}

/**
 * Generates bookable lesson start times (ISO UTC) for a date window.
 * Applies school hours, blackouts, lead time and existing bookings.
 */
export function generateSlots(query: SlotQuery): string[] {
  const now = query.now ?? new Date();
  const nowMs = now.getTime();
  const earliestMs = nowMs + LEAD_TIME_MIN * 60000;
  const horizonKey = addDaysToDayKey(toVancouverDayKey(now), HORIZON_DAYS);

  const fromKey = query.fromDayKey ?? toVancouverDayKey(now);
  const toKey =
    query.toDayKey && query.toDayKey < horizonKey ? query.toDayKey : horizonKey;
  if (toKey < fromKey) return [];

  const durationMs = query.lessonDurationMin * 60000;
  const busyRanges = toBusyRanges(query.busy);
  const blackoutSet = new Set(query.blackouts.map((b) => b.date));
  const rulesByWeekday = new Map<number, AvailabilityRule>();
  for (const rule of query.rules) rulesByWeekday.set(rule.weekday, rule);

  const slots: string[] = [];
  let cursorKey = fromKey;
  let guard = 0;

  while (cursorKey <= toKey && guard < HORIZON_DAYS + 1) {
    guard += 1;
    const [year, month, day] = cursorKey.split("-").map(Number);
    const probe = zonedToUtc(year, month, day, 12 * 60);
    const weekday = toVancouverParts(probe).weekday;
    const rule = rulesByWeekday.get(weekday);

    if (rule && !blackoutSet.has(cursorKey)) {
      const windowStart = zonedToUtc(year, month, day, rule.startMin);
      const windowEnd = zonedToUtc(year, month, day, rule.endMin);
      for (
        let start = windowStart.getTime();
        start + durationMs <= windowEnd.getTime();
        start += SLOT_STEP_MIN * 60000
      ) {
        if (start < earliestMs) continue;
        const end = start + durationMs;
        if (busyRanges.some(([bs, be]) => overlaps(start, end, bs, be))) continue;
        slots.push(new Date(start).toISOString());
      }
    }

    cursorKey = addDaysToDayKey(cursorKey, 1);
  }

  return slots;
}

export interface SlotValidation {
  valid: boolean;
  reason?: "not_offered" | "too_soon" | "beyond_horizon" | "occupied";
}

/** Server-side re-validation of a customer-chosen start time before persisting. */
export function validateSlot(
  startIso: string,
  query: Omit<SlotQuery, "fromDayKey" | "toDayKey">,
): SlotValidation {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return { valid: false, reason: "not_offered" };

  const now = query.now ?? new Date();
  if (startMs < now.getTime() + LEAD_TIME_MIN * 60000) {
    return { valid: false, reason: "too_soon" };
  }
  const horizonKey = addDaysToDayKey(toVancouverDayKey(now), HORIZON_DAYS);
  if (toVancouverDayKey(new Date(startMs)) > horizonKey) {
    return { valid: false, reason: "beyond_horizon" };
  }

  const endMs = startMs + query.lessonDurationMin * 60000;
  const busyRanges = toBusyRanges(query.busy);
  if (busyRanges.some(([bs, be]) => overlaps(startMs, endMs, bs, be))) {
    return { valid: false, reason: "occupied" };
  }

  const dayKey = toVancouverDayKey(new Date(startMs));
  if (query.blackouts.some((b) => b.date === dayKey)) {
    return { valid: false, reason: "not_offered" };
  }

  const daySlots = generateSlots({
    ...query,
    fromDayKey: dayKey,
    toDayKey: dayKey,
  });
  if (!daySlots.includes(new Date(startMs).toISOString())) {
    return { valid: false, reason: "not_offered" };
  }
  return { valid: true };
}
