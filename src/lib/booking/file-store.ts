import "server-only";

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { addVancouverCalendarMonths, DEFAULT_RULES, occupiedDurationMin, validateSlot } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { OTP_MAX_ATTEMPTS } from "@/lib/booking/otp";
import { customerCanAccessBooking } from "@/lib/booking/customer-access";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import { lessons as defaultLessons, type Lesson } from "@/lib/data/lessons";
import type {
  AdminRescheduleResult,
  AvailabilityDateOverride,
  AvailabilityRule,
  BlackoutDate,
  BookingFilter,
  BookingRecord,
  BookingStatus,
  BookingSlotHold,
  ChequeStatus,
  BookingStore,
  BusyInterval,
  CreateBookingInput,
  CreateBookingBundleInput,
  CreateBookingPackageInput,
  CreatePackagePurchaseInput,
  OtpSendPermit,
  PackagePurchaseRecord,
  PackageCreditEventRecord,
  PackageQuantitySelection,
  ScheduledPackageSelection,
  PaymentStatus,
  StripePackagePurchaseEvent,
  StripeCheckoutEvent,
  StripeUpgradeCheckoutEvent,
  StoreResult,
} from "@/lib/booking/types";

interface FileData {
  rules: AvailabilityRule[];
  dateOverrides: AvailabilityDateOverride[];
  blackouts: BlackoutDate[];
  bookings: BookingRecord[];
  packagePurchases: PackagePurchaseRecord[];
  packageCreditEvents: Array<{
    purchaseId: string;
    bookingId?: string;
    eventType: "grant" | "redeem" | "refund" | "expire" | "admin_adjustment";
    quantityDelta: number;
    sourceKey: string;
    note?: string;
    createdAt: string;
  }>;
  packagePurchaseTokens: Array<{ tokenHash: string; purchaseId: string; expiresAt: string }>;
  bookingCheckoutAddons: Array<{ bookingId: string; sessionId: string; purchaseId: string; lessonId: string; scheduledBookingIds?: string[] }>;
  bookingCheckoutAddonSchedules: Array<{ bookingId: string; lessonId: string; bookingIds: string[] }>;
  bookingStudentDetails: Array<{ bookingId: string; dateOfBirth: string; gender: string; licenseNumber: string }>;
  tokens: Array<{ tokenHash: string; bookingId: string; expiresAt: string }>;
  lessons: Lesson[];
  otps: Array<{
    email: string;
    codeHash: string;
    expiresAt: string;
    attempts: number;
  }>;
  otpSendLimits: Array<{
    email: string;
    windowStartedAt: string;
    lastSentAt: string;
    sends: number;
  }>;
  stripeWebhookEvents: string[];
  bookingSlotHolds: Array<{ holdTokenHash: string; startsAt: string; durationMin: number; expiresAt: string }>;
}

const DATA_DIR = join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "store.json");

function load(): FileData {
  if (!existsSync(DATA_FILE)) {
    return {
      rules: DEFAULT_RULES,
      dateOverrides: [],
      blackouts: [],
      bookings: [],
      packagePurchases: [],
      packageCreditEvents: [],
      packagePurchaseTokens: [],
      bookingCheckoutAddons: [],
      bookingCheckoutAddonSchedules: [],
      bookingStudentDetails: [],
      tokens: [],
      lessons: structuredClone(defaultLessons),
      otps: [],
      otpSendLimits: [],
      stripeWebhookEvents: [],
      bookingSlotHolds: [],
    };
  }
  const raw = readFileSync(DATA_FILE, "utf8");
  const data = JSON.parse(raw) as FileData;
  if (!Array.isArray(data.lessons) || data.lessons.length === 0) {
    data.lessons = structuredClone(defaultLessons);
  } else {
    data.lessons = data.lessons.map((lesson) => ({
      ...lesson,
      sessionCount: lesson.sessionCount ?? defaultLessons.find((item) => item.id === lesson.id)?.sessionCount ?? 1,
    }));
  }
  if (!Array.isArray(data.otps)) data.otps = [];
  if (!Array.isArray(data.otpSendLimits)) data.otpSendLimits = [];
  if (!Array.isArray(data.stripeWebhookEvents)) data.stripeWebhookEvents = [];
  if (!Array.isArray(data.packagePurchases)) data.packagePurchases = [];
  if (!Array.isArray(data.packageCreditEvents)) data.packageCreditEvents = [];
  if (!Array.isArray(data.packagePurchaseTokens)) data.packagePurchaseTokens = [];
  if (!Array.isArray(data.bookingCheckoutAddons)) data.bookingCheckoutAddons = [];
  if (!Array.isArray(data.bookingCheckoutAddonSchedules)) data.bookingCheckoutAddonSchedules = [];
  if (!Array.isArray(data.bookingStudentDetails)) data.bookingStudentDetails = [];
  if (!Array.isArray(data.bookingSlotHolds)) data.bookingSlotHolds = [];
  if (!Array.isArray(data.dateOverrides)) data.dateOverrides = [];
  return data;
}

function save(data: FileData): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Serialises writes within this process so conflict checks stay atomic. */
let writeQueue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function occupiedEnd(startsAt: string, durationMin: number): number {
  return Date.parse(startsAt) + occupiedDurationMin(durationMin) * 60_000;
}

function activeBookings(data: FileData): BookingRecord[] {
  const now = Date.now();
  return data.bookings.filter((b) =>
    b.status === "confirmed" || b.status === "rescheduled" ||
    (b.status === "pending_payment" &&
      Date.parse(b.stripeCheckoutExpiresAt ?? new Date(Date.parse(b.createdAt) + 30 * 60 * 1000).toISOString()) > now),
  );
}

function cancelPackage(data: FileData, booking: BookingRecord): boolean {
  const packageId = booking.packageId ?? booking.id;
  const sessions = data.bookings.filter((item) => (item.packageId ?? item.id) === packageId);
  if (sessions.every((item) => ["cancelled", "completed"].includes(item.status))) return false;
  const now = new Date().toISOString();
  sessions.forEach((session) => {
    if (session.status !== "completed") {
      session.status = "cancelled";
      session.updatedAt = now;
    }
  });
  return true;
}

function makeReference(): string {
  return `WDA-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}


export const fileStore: BookingStore = {
  async getRules(): Promise<AvailabilityRule[]> {
    const data = load();
    return data.rules.length > 0 ? data.rules : DEFAULT_RULES;
  },

  async getDateOverrides(fromDate?: string, toDate?: string): Promise<AvailabilityDateOverride[]> {
    return load().dateOverrides.filter((item) =>
      (!fromDate || item.date >= fromDate) && (!toDate || item.date <= toDate),
    );
  },

  async getBlackouts(): Promise<BlackoutDate[]> {
    return load().blackouts;
  },

  async getBusy(fromIso: string, toIso: string, excludeHoldTokenHash?: string): Promise<BusyInterval[]> {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    const data = load();
    const booked = activeBookings(data)
      .filter((b) => overlaps(Date.parse(b.startsAt), occupiedEnd(b.startsAt, b.durationMin), from, to))
      .map((b) => ({ startsAt: b.startsAt, endsAt: new Date(occupiedEnd(b.startsAt, b.durationMin)).toISOString() }));
    const reserved = data.bookings.flatMap((booking) => booking.stripeUpgradeCheckoutSessionId
      ? (booking.stripeUpgradeTargetSessions ?? []).map((item) => ({
          startsAt: item.startsAt,
          endsAt: new Date(occupiedEnd(item.startsAt, booking.stripeUpgradeTargetDurationMin ?? 600)).toISOString(),
        }))
      : [])
      .filter((item) => overlaps(Date.parse(item.startsAt), Date.parse(item.endsAt), from, to));
    const held = data.bookingSlotHolds.filter((hold) => Date.parse(hold.expiresAt) > Date.now() && hold.holdTokenHash !== excludeHoldTokenHash)
      .map((hold) => ({ startsAt: hold.startsAt, endsAt: new Date(occupiedEnd(hold.startsAt, hold.durationMin)).toISOString() }))
      .filter((item) => overlaps(Date.parse(item.startsAt), Date.parse(item.endsAt), from, to));
    return [...booked, ...reserved, ...held];
  },

  createBookingHold(slots: BookingSlotHold[], holdTokenHash: string, expiresAt: string) {
    return withLock((): Promise<StoreResult<{ expiresAt: string }>> => {
      const data = load();
      const now = Date.now();
      data.bookingSlotHolds = data.bookingSlotHolds.filter((hold) => Date.parse(hold.expiresAt) > now);
      if (!/^[a-f0-9]{64}$/.test(holdTokenHash) || !Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 8 * 60_000 + 30_000 ||
          slots.length < 1 || slots.length > 200 || new Set(slots.map((slot) => slot.startsAt)).size !== slots.length) {
        save(data);
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const otherBusy = [
        ...activeBookings(data).map((booking) => ({ startsAt: booking.startsAt, endsAt: new Date(occupiedEnd(booking.startsAt, booking.durationMin)).toISOString() })),
        ...data.bookingSlotHolds.filter((hold) => hold.holdTokenHash !== holdTokenHash).map((hold) => ({ startsAt: hold.startsAt, endsAt: new Date(occupiedEnd(hold.startsAt, hold.durationMin)).toISOString() })),
      ];
      const chosen: BusyInterval[] = [];
      for (const slot of slots) {
        const validation = validateSlot(slot.startsAt, {
          lessonDurationMin: slot.durationMin,
          busy: [...otherBusy, ...chosen],
          rules: data.rules,
          dateOverrides: data.dateOverrides,
          blackouts: data.blackouts,
          now: new Date(),
        });
        if (!validation.valid) {
          save(data);
          return Promise.resolve({ ok: false, error: validation.reason === "occupied" ? "conflict" as const : "not_found" as const });
        }
        chosen.push({ startsAt: slot.startsAt, endsAt: new Date(occupiedEnd(slot.startsAt, slot.durationMin)).toISOString() });
      }
      data.bookingSlotHolds = data.bookingSlotHolds.filter((hold) => hold.holdTokenHash !== holdTokenHash);
      data.bookingSlotHolds.push(...slots.map((slot) => ({ ...slot, holdTokenHash, expiresAt })));
      save(data);
      return Promise.resolve({ ok: true as const, value: { expiresAt } });
    });
  },

  releaseBookingHold(holdTokenHash: string) {
    return withLock(async () => {
      const data = load();
      data.bookingSlotHolds = data.bookingSlotHolds.filter((hold) => hold.holdTokenHash !== holdTokenHash);
      save(data);
    });
  },

  createBooking(
    input: CreateBookingInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const start = Date.parse(input.startsAt);
      const end = occupiedEnd(input.startsAt, input.durationMin);
      const conflict = activeBookings(data).some((b) =>
        overlaps(start, end, Date.parse(b.startsAt), occupiedEnd(b.startsAt, b.durationMin)),
      );
      if (conflict) return Promise.resolve({ ok: false, error: "conflict" as const });

      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: randomUUID(),
        reference: makeReference(),
        packageId: randomUUID(),
        sessionIndex: 1,
        sessionCount: 1,
        packagePriceCad: input.priceCad,
        packageWindowStart: dayKeyOf(input.startsAt),
        ...input,
        status: "pending_payment",
        paymentStatus: "due",
        stripeCheckoutAttempt: 0,
        stripeCheckoutExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      data.bookings.push(booking);
      data.tokens = data.tokens.filter((t) => t.bookingId !== booking.id);
      data.tokens.push({ tokenHash: token.hash, bookingId: booking.id, expiresAt: token.expiresAt });
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
    });
  },

  createBookingPackage(
    input: CreateBookingPackageInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord[]>> {
    return withLock((): Promise<StoreResult<BookingRecord[]>> => {
      const data = load();
      const sessions = [...input.sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      if (!sessions.length || sessions.length > 20 || input.packagePriceCad < 0) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const parsed = sessions.map((session) => ({ start: Date.parse(session.startsAt), end: occupiedEnd(session.startsAt, input.durationMin) }));
      if (parsed.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start)) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      if (parsed[0].start < Date.now() + 120 * 60 * 1000 || parsed[0].start > Date.now() + 90 * 24 * 60 * 60 * 1000) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const maxDate = addMonthsToKey(dayKeyOf(new Date(parsed[0].start).toISOString()), 2);
      if (parsed.some((item, index) =>
        (index > 0 && item.start <= parsed[index - 1].start) ||
        dayKeyOf(new Date(item.start).toISOString()) > maxDate,
      )) return Promise.resolve({ ok: false, error: "not_found" as const });

      const active = activeBookings(data);
      const overlapsExisting = parsed.some((slot) => active.some((booking) =>
        overlaps(slot.start, slot.end, Date.parse(booking.startsAt), occupiedEnd(booking.startsAt, booking.durationMin)),
      ));
      const overlapsSelected = parsed.some((slot, index) => parsed.slice(index + 1).some((other) =>
        overlaps(slot.start, slot.end, other.start, other.end),
      ));
      if (overlapsExisting || overlapsSelected) return Promise.resolve({ ok: false, error: "conflict" as const });

      const packageId = randomUUID();
      const now = new Date().toISOString();
      const cents = Math.round(input.packagePriceCad * 100);
      const baseCents = Math.floor(cents / sessions.length);
      const remainder = cents % sessions.length;
      const records = sessions.map((session, index): BookingRecord => ({
        id: randomUUID(),
        reference: makeReference(),
        packageId,
        sessionIndex: index + 1,
        sessionCount: sessions.length,
        packagePriceCad: input.packagePriceCad,
        packageWindowStart: dayKeyOf(sessions[0].startsAt),
        lessonId: input.lessonId,
        lessonName: input.lessonName,
        durationMin: input.durationMin,
        priceCad: (baseCents + (index < remainder ? 1 : 0)) / 100,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        studentName: input.studentName,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        status: "pending_payment",
        paymentStatus: "due",
        stripeCheckoutAttempt: 0,
        stripeCheckoutExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      }));
      data.bookings.push(...records);
      data.tokens = data.tokens.filter((entry) => entry.tokenHash !== token.hash);
      data.tokens.push({ tokenHash: token.hash, bookingId: records[0].id, expiresAt: token.expiresAt });
      save(data);
      return Promise.resolve({ ok: true as const, value: records });
    });
  },

  createBookingBundle(
    input: CreateBookingBundleInput,
    token: { hash: string; expiresAt: string },
    holdTokenHash: string,
  ): Promise<StoreResult<BookingRecord[]>> {
    return withLock((): Promise<StoreResult<BookingRecord[]>> => {
      const data = load();
      if (!input.packages.length || input.packages.length > 20 || input.packages[0].quantity !== 1) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const selections = input.packages.map((selection, index) => {
        const lesson = data.lessons.find((item) => item.id === selection.lessonId && (index === 0 || item.category === "package"));
        if (!lesson || !Number.isSafeInteger(selection.quantity) || selection.quantity < 1 ||
            selection.startsAt.length !== lesson.sessionCount * selection.quantity) return null;
        return { lesson, selection };
      });
      if (selections.some((item) => !item) ||
          new Set(input.packages.slice(1).map((item) => item.lessonId)).size !== input.packages.length - 1) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const validSelections = selections as Array<{ lesson: Lesson; selection: ScheduledPackageSelection }>;
      const scheduledCount = validSelections.reduce((sum, item) => sum + item.selection.startsAt.length, 0);
      const subtotal = validSelections.reduce((sum, item) => sum + item.lesson.priceCad * item.selection.quantity, 0);
      if (scheduledCount > 200 || subtotal > 999_999.99 || !Number.isSafeInteger(Math.round(subtotal * 100))) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }

      const anchorStart = Date.parse(input.packages[0].startsAt[0]);
      if (!Number.isFinite(anchorStart) || anchorStart < Date.now() + 120 * 60_000 ||
          dayKeyOf(new Date(anchorStart).toISOString()) > addMonthsToKey(dayKeyOf(new Date().toISOString()), 6)) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }
      const anchorDay = dayKeyOf(new Date(anchorStart).toISOString());
      const maxDay = addMonthsToKey(anchorDay, 6);
      const expanded = validSelections.flatMap(({ lesson, selection }) => selection.startsAt.map((startsAt) => ({ lesson, startsAt })));
      const ordered = expanded.map((item) => ({ ...item, start: Date.parse(item.startsAt) })).sort((a, b) => a.start - b.start);
      const activeHolds = data.bookingSlotHolds.filter((hold) => hold.holdTokenHash === holdTokenHash && Date.parse(hold.expiresAt) > Date.now());
      if (activeHolds.length !== ordered.length || ordered.some((item) => !activeHolds.some((hold) =>
        Date.parse(hold.startsAt) === item.start && hold.durationMin === item.lesson.durationMin,
      ))) return Promise.resolve({ ok: false, error: "conflict" as const });
      if (ordered.some((item, index) => !Number.isFinite(item.start) || dayKeyOf(item.startsAt) < anchorDay ||
          dayKeyOf(item.startsAt) > maxDay || (index > 0 && item.start === ordered[index - 1].start))) {
        return Promise.resolve({ ok: false, error: "not_found" as const });
      }

      const busy = activeBookings(data).map((booking) => ({ startsAt: booking.startsAt, endsAt: new Date(occupiedEnd(booking.startsAt, booking.durationMin)).toISOString() }));
      for (const item of ordered) {
        const validation = validateSlot(item.startsAt, {
          lessonDurationMin: item.lesson.durationMin,
          busy: [...busy, ...ordered.slice(0, ordered.indexOf(item)).map((previous) => ({
            startsAt: previous.startsAt,
            endsAt: new Date(previous.start + occupiedDurationMin(previous.lesson.durationMin) * 60_000).toISOString(),
          }))],
          blackouts: data.blackouts,
          rules: data.rules,
          dateOverrides: data.dateOverrides,
          now: new Date(),
        });
        if (!validation.valid) return Promise.resolve({ ok: false, error: validation.reason === "occupied" ? "conflict" as const : "not_found" as const });
      }

      const packageId = randomUUID();
      const now = new Date().toISOString();
      const records: BookingRecord[] = [];
      for (const { lesson, selection } of validSelections) {
        const groupCents = Math.round(lesson.priceCad * selection.quantity * 100);
        const groupCount = selection.startsAt.length;
        const baseCents = Math.floor(groupCents / groupCount);
        const remainder = groupCents % groupCount;
        const orderedStarts = [...selection.startsAt].sort((a, b) => Date.parse(a) - Date.parse(b));
        orderedStarts.forEach((startsAt, index) => {
          const start = Date.parse(startsAt);
          records.push({
            id: randomUUID(),
            reference: makeReference(),
            packageId,
            sessionIndex: records.length + 1,
            sessionCount: scheduledCount,
            packagePriceCad: validSelections[0].lesson.priceCad,
            packageWindowStart: anchorDay,
            lessonId: lesson.id,
            lessonName: lesson.name,
            durationMin: lesson.durationMin,
            priceCad: (baseCents + (index < remainder ? 1 : 0)) / 100,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(start + lesson.durationMin * 60_000).toISOString(),
            studentName: input.studentName,
            email: input.email.trim().toLowerCase(),
            phone: input.phone,
            notes: input.notes,
            status: "pending_payment",
            paymentStatus: "due",
            stripeCheckoutAttempt: 0,
            stripeCheckoutExpiresAt: new Date(Date.now() + 31 * 60_000).toISOString(),
            createdAt: now,
            updatedAt: now,
          });
        });
      }
      data.bookings.push(...records);
      data.bookingStudentDetails.push({
        bookingId: records[0].id,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        licenseNumber: input.licenseNumber,
      });
      data.bookingSlotHolds = data.bookingSlotHolds.filter((hold) => hold.holdTokenHash !== holdTokenHash);
      data.tokens = data.tokens.filter((entry) => entry.tokenHash !== token.hash);
      data.tokens.push({ tokenHash: token.hash, bookingId: records[0].id, expiresAt: token.expiresAt });
      let offset = input.packages[0].startsAt.length;
      for (const selection of input.packages.slice(1)) {
        const bookingIds = records.slice(offset, offset + selection.startsAt.length).map((record) => record.id);
        data.bookingCheckoutAddonSchedules.push({ bookingId: records[0].id, lessonId: selection.lessonId, bookingIds });
        offset += selection.startsAt.length;
      }
      save(data);
      return Promise.resolve({ ok: true as const, value: records });
    });
  },

  async getBookingByToken(tokenHash: string) {
    const data = load();
    const entry = data.tokens.find((t) => t.tokenHash === tokenHash);
    if (!entry) return null;
    if (Date.parse(entry.expiresAt) < Date.now()) return null;
    const booking = data.bookings.find((b) => b.id === entry.bookingId);
    if (!booking) return null;
    const packageId = booking.packageId ?? booking.id;
    const sessions = data.bookings.filter((item) => (item.packageId ?? item.id) === packageId)
      .sort((a, b) => (a.sessionIndex ?? 1) - (b.sessionIndex ?? 1));
    if (!sessions.some((session) => customerCanAccessBooking(session.status))) return null;
    return {
      booking: sessions.find((session) => (session.sessionIndex ?? 1) === 1) ?? booking,
      sessions,
      tokenExpiresAt: entry.expiresAt,
    };
  },

  rescheduleBookingByToken(
    tokenHash: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const entry = data.tokens.find((t) => t.tokenHash === tokenHash);
      if (!entry || Date.parse(entry.expiresAt) < Date.now()) {
        return Promise.resolve({ ok: false, error: "expired" as const });
      }
      const booking = data.bookings.find((b) => b.id === entry.bookingId);
      if (!booking || booking.status === "cancelled" || booking.status === "completed") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      if ((booking.studentRescheduleCount ?? 0) >= 2) {
        return Promise.resolve({ ok: false, error: "reschedule_limit" as const });
      }

      const start = Date.parse(startsAt);
      const end = occupiedEnd(startsAt, booking.durationMin);
      const conflict = activeBookings(data).some(
        (b) => b.id !== booking.id && overlaps(start, end, Date.parse(b.startsAt), occupiedEnd(b.startsAt, b.durationMin)),
      );
      if (conflict) return Promise.resolve({ ok: false, error: "conflict" as const });

      booking.startsAt = startsAt;
      booking.endsAt = endsAt;
      booking.status = "rescheduled";
      booking.studentRescheduleCount = (booking.studentRescheduleCount ?? 0) + 1;
      booking.updatedAt = new Date().toISOString();

      data.tokens = data.tokens.filter((t) => t.bookingId !== booking.id);
      data.tokens.push({ tokenHash: newToken.hash, bookingId: booking.id, expiresAt: newToken.expiresAt });
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
    });
  },

  reschedulePackageSessionByToken(
    tokenHash: string,
    sessionId: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const token = data.tokens.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) >= Date.now());
      const anchor = token && data.bookings.find((item) => item.id === token.bookingId);
      const target = data.bookings.find((item) => item.id === sessionId);
      if (!anchor || !target || (anchor.packageId ?? anchor.id) !== (target.packageId ?? target.id)) {
        return Promise.resolve({ ok: false, error: "expired" as const });
      }
      if (["cancelled", "completed"].includes(target.status)) return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      if ((target.sessionCount ?? 1) === 1 && target.paymentStatus === "paid") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      if ((target.studentRescheduleCount ?? 0) >= 2) return Promise.resolve({ ok: false, error: "reschedule_limit" as const });
      if (Date.parse(target.startsAt) - Date.now() < 48 * 60 * 60 * 1000) return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      const start = Date.parse(startsAt);
      const end = occupiedEnd(startsAt, target.durationMin);
      const conflict = activeBookings(data).some((item) => item.id !== target.id && overlaps(start, end, Date.parse(item.startsAt), occupiedEnd(item.startsAt, item.durationMin)));
      if (conflict) return Promise.resolve({ ok: false, error: "conflict" as const });
      const packageStart = target.packageWindowStart ?? dayKeyOf(anchor.startsAt);
      if (dayKeyOf(new Date(start).toISOString()) < packageStart || dayKeyOf(new Date(start).toISOString()) > addMonthsToKey(packageStart, 2)) {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      target.startsAt = new Date(start).toISOString();
      target.endsAt = endsAt;
      target.status = "rescheduled";
      target.studentRescheduleCount = (target.studentRescheduleCount ?? 0) + 1;
      target.updatedAt = new Date().toISOString();
      const packageId = anchor.packageId ?? anchor.id;
      const packageAnchor = data.bookings.find((item) =>
        (item.packageId ?? item.id) === packageId && (item.sessionIndex ?? 1) === 1,
      ) ?? anchor;
      data.tokens = data.tokens.filter((item) => !data.bookings.some((session) =>
        (session.packageId ?? session.id) === packageId && session.id === item.bookingId,
      ));
      data.tokens.push({ tokenHash: newToken.hash, bookingId: packageAnchor.id, expiresAt: newToken.expiresAt });
      save(data);
      return Promise.resolve({ ok: true as const, value: target });
    });
  },

  async listBookings(filter: BookingFilter = {}): Promise<BookingRecord[]> {
    const from = filter.fromIso ? Date.parse(filter.fromIso) : Number.NEGATIVE_INFINITY;
    const to = filter.toIso ? Date.parse(filter.toIso) : Number.POSITIVE_INFINITY;
    const needle = filter.search?.trim().toLowerCase();

    return load()
      .bookings.filter((b) => {
        const start = Date.parse(b.startsAt);
        if (start < from || start >= to) return false;
        if (filter.status && b.status !== filter.status) return false;
        if (needle) {
          const haystack = `${b.studentName} ${b.email} ${b.phone} ${b.reference}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  },

  async getBookingById(id: string): Promise<BookingRecord | null> {
    return load().bookings.find((b) => b.id === id) ?? null;
  },

  async getBookingStudentDetails(bookingId: string) {
    const details = load().bookingStudentDetails.find((item) => item.bookingId === bookingId);
    if (!details) return null;
    return {
      dateOfBirth: details.dateOfBirth,
      gender: details.gender,
      licenseNumber: details.licenseNumber,
    };
  },

  updateBookingStatus(id: string, status: BookingStatus): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === id);
      if (!booking) return Promise.resolve({ ok: false, error: "not_found" as const });
      if (status === "completed") {
        const packageId = booking.packageId ?? booking.id;
        const now = new Date().toISOString();
        if (["cancelled", "completed"].includes(booking.status)) {
          return Promise.resolve({ ok: false, error: "not_modifiable" as const });
        }
        booking.status = "completed";
        booking.updatedAt = now;
        const remainingActiveSessions = data.bookings.some((item) =>
          (item.packageId ?? item.id) === packageId && item.id !== booking.id &&
          !["cancelled", "completed"].includes(item.status),
        );
        if (!remainingActiveSessions) {
          data.tokens = data.tokens.filter((entry) => !data.bookings.some((item) =>
            (item.packageId ?? item.id) === packageId && item.id === entry.bookingId,
          ));
        }
      } else if (status === "cancelled") {
        if (!cancelPackage(data, booking)) return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      } else {
        if (booking.status === "cancelled" || booking.status === "completed") {
          return Promise.resolve({ ok: false, error: "not_modifiable" as const });
        }
        const packageId = booking.packageId ?? booking.id;
        const now = new Date().toISOString();
        data.bookings.filter((item) => (item.packageId ?? item.id) === packageId).forEach((session) => {
          if (session.status !== "cancelled" && session.status !== "completed") {
            session.status = status;
            session.updatedAt = now;
          }
        });
      }
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
    });
  },

  updatePaymentStatus(
    id: string,
    paymentStatus: PaymentStatus,
  ): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === id);
      if (!booking) return Promise.resolve({ ok: false, error: "not_found" as const });
      const packageId = booking.packageId ?? booking.id;
      const now = new Date().toISOString();
      data.bookings.filter((item) => (item.packageId ?? item.id) === packageId).forEach((session) => {
        session.paymentStatus = paymentStatus;
        session.updatedAt = now;
      });
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
    });
  },

  updateBookingCheque(id: string, status: ChequeStatus, reference?: string) {
    return withLock(async () => {
      const data = load();
      const booking = data.bookings.find((item) => item.id === id);
      if (!booking) return { ok: false as const, error: "not_found" as const };
      const now = new Date().toISOString();
      const packageId = booking.packageId ?? booking.id;
      for (const session of data.bookings.filter((item) => (item.packageId ?? item.id) === packageId)) {
        session.chequeStatus = status;
        session.chequeReference = status === "none" ? undefined : reference?.trim() || undefined;
        session.chequeReceivedAt = status === "received" || status === "cleared" ? now : undefined;
        if (status === "cleared") session.paymentStatus = "paid";
        if (status === "returned") session.paymentStatus = "due";
        session.updatedAt = now;
      }
      save(data);
      return { ok: true as const, value: booking };
    });
  },

  updatePackagePurchaseCheque(id: string, status: ChequeStatus, reference?: string) {
    return withLock(async () => {
      const data = load();
      const purchase = data.packagePurchases.find((item) => item.id === id);
      if (!purchase) return { ok: false as const, error: "not_found" as const };
      const now = new Date().toISOString();
      purchase.chequeStatus = status;
      purchase.chequeReference = status === "none" ? undefined : reference?.trim() || undefined;
      purchase.chequeReceivedAt = status === "received" || status === "cleared" ? now : undefined;
      if (status === "cleared" && (purchase.paymentStatus === "pending" || purchase.paymentStatus === "failed")) {
        purchase.paymentStatus = "paid";
        purchase.purchasedAt = now;
        const expiry = new Date(now);
        expiry.setMonth(expiry.getMonth() + 6);
        purchase.validUntil = expiry.toISOString();
        data.packageCreditEvents.push({ purchaseId: id, eventType: "grant", quantityDelta: purchase.creditsPurchased, sourceKey: `cheque-cleared:${id}:${now}`, note: "Cheque payment cleared", createdAt: now });
      } else if (status === "returned" && purchase.paymentStatus === "paid") {
        purchase.paymentStatus = "pending";
        purchase.purchasedAt = undefined;
        purchase.validUntil = undefined;
        data.packageCreditEvents.push({ purchaseId: id, eventType: "refund", quantityDelta: -purchase.creditsPurchased, sourceKey: `cheque-returned:${id}:${now}`, note: "Cheque returned", createdAt: now });
      }
      purchase.updatedAt = now;
      save(data);
      const creditsAvailable = data.packageCreditEvents.filter((event) => event.purchaseId === id).reduce((sum, event) => sum + event.quantityDelta, 0);
      return { ok: true as const, value: { ...purchase, creditsAvailable } };
    });
  },

  adminRescheduleBooking(
    id: string,
    startsAt: string,
    endsAt: string,
  ): Promise<StoreResult<AdminRescheduleResult>> {
    return withLock((): Promise<StoreResult<AdminRescheduleResult>> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === id);
      if (!booking) return Promise.resolve({ ok: false, error: "not_found" as const });
      if (booking.status === "cancelled" || booking.status === "completed") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }

      const start = Date.parse(startsAt);
      const conflict = activeBookings(data).some(
        (b) => b.id !== id && overlaps(start, occupiedEnd(startsAt, booking.durationMin), Date.parse(b.startsAt), occupiedEnd(b.startsAt, b.durationMin)),
      );
      if (conflict) return Promise.resolve({ ok: false, error: "conflict" as const });

      booking.startsAt = startsAt;
      booking.endsAt = endsAt;
      booking.status = "rescheduled";
      booking.updatedAt = new Date().toISOString();
      const newToken = generateToken();
      const packageId = booking.packageId ?? booking.id;
      const packageAnchor = data.bookings.find((item) =>
        (item.packageId ?? item.id) === packageId && (item.sessionIndex ?? 1) === 1,
      ) ?? booking;
      data.tokens = data.tokens.filter((entry) => !data.bookings.some((session) =>
        (session.packageId ?? session.id) === packageId && session.id === entry.bookingId,
      ));
      data.tokens.push({
        tokenHash: hashToken(newToken),
        bookingId: packageAnchor.id,
        expiresAt: tokenExpiry(),
      });
      save(data);
      return Promise.resolve({ ok: true as const, value: { booking, newToken } });
    });
  },

  adminCancelBooking(id: string): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === id);
      if (!booking) return Promise.resolve({ ok: false, error: "not_found" as const });
      if (!cancelPackage(data, booking)) {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
    });
  },

  setRules(rules: AvailabilityRule[]): Promise<AvailabilityRule[]> {
    return withLock((): Promise<AvailabilityRule[]> => {
      const data = load();
      data.rules = rules;
      save(data);
      return Promise.resolve(data.rules);
    });
  },

  setDateOverride(override: AvailabilityDateOverride): Promise<void> {
    return withLock(async () => {
      const data = load();
      data.dateOverrides = [
        ...data.dateOverrides.filter((item) => item.date !== override.date),
        override,
      ].sort((a, b) => a.date.localeCompare(b.date));
      save(data);
    });
  },

  removeDateOverride(date: string): Promise<void> {
    return withLock(async () => {
      const data = load();
      data.dateOverrides = data.dateOverrides.filter((item) => item.date !== date);
      save(data);
    });
  },

  addBlackout(date: string, reason?: string): Promise<BlackoutDate[]> {
    return withLock((): Promise<BlackoutDate[]> => {
      const data = load();
      data.blackouts = [
        ...data.blackouts.filter((b) => b.date !== date),
        { date, reason: reason || undefined },
      ].sort((a, b) => a.date.localeCompare(b.date));
      save(data);
      return Promise.resolve(data.blackouts);
    });
  },

  removeBlackout(date: string): Promise<BlackoutDate[]> {
    return withLock((): Promise<BlackoutDate[]> => {
      const data = load();
      data.blackouts = data.blackouts.filter((b) => b.date !== date);
      save(data);
      return Promise.resolve(data.blackouts);
    });
  },

  async getLessons(): Promise<Lesson[]> {
    return load().lessons;
  },

  saveLesson(lesson: Lesson): Promise<Lesson[]> {
    return withLock((): Promise<Lesson[]> => {
      const data = load();
      const index = data.lessons.findIndex((l) => l.id === lesson.id);
      if (index >= 0) data.lessons[index] = lesson;
      else data.lessons.push(lesson);
      save(data);
      return Promise.resolve(data.lessons);
    });
  },

  async findBookingsByEmail(email: string): Promise<BookingRecord[]> {
    const needle = email.trim().toLowerCase();
    return load()
      .bookings.filter((b) => b.email.toLowerCase() === needle)
        .filter((b) => customerCanAccessBooking(b.status))
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  },

  issueManageToken(bookingId: string): Promise<string | null> {
    return withLock((): Promise<string | null> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === bookingId);
      if (!booking || !customerCanAccessBooking(booking.status)) return Promise.resolve(null);
      const packageId = booking.packageId ?? booking.id;
      const anchor = data.bookings.find((item) =>
        (item.packageId ?? item.id) === packageId && (item.sessionIndex ?? 1) === 1,
      ) ?? booking;
      const raw = generateToken();
      data.tokens = data.tokens.filter((t) => !data.bookings.some((session) =>
        (session.packageId ?? session.id) === packageId && session.id === t.bookingId,
      ));
      data.tokens.push({
        tokenHash: hashToken(raw),
        bookingId: anchor.id,
        expiresAt: tokenExpiry(),
      });
      save(data);
      return Promise.resolve(raw);
    });
  },

  putOtp(email: string, codeHash: string, expiresAt: string): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      const key = email.trim().toLowerCase();
      data.otps = data.otps.filter((entry) => entry.email !== key);
      data.otps.push({ email: key, codeHash, expiresAt, attempts: 0 });
      save(data);
      return Promise.resolve();
    });
  },

  verifyOtp(
    email: string,
    codeHash: string,
    consume = false,
  ): Promise<{ ok: true } | { ok: false; reason: "mismatch" | "expired" | "locked" }> {
    return withLock((): Promise<{ ok: true } | { ok: false; reason: "mismatch" | "expired" | "locked" }> => {
      const data = load();
      const key = email.trim().toLowerCase();
      const entry = data.otps.find((otp) => otp.email === key);
      if (!entry) return Promise.resolve({ ok: false, reason: "expired" });
      if (Date.parse(entry.expiresAt) < Date.now()) {
        data.otps = data.otps.filter((otp) => otp.email !== key);
        save(data);
        return Promise.resolve({ ok: false, reason: "expired" });
      }
      if (entry.attempts >= OTP_MAX_ATTEMPTS) {
        return Promise.resolve({ ok: false, reason: "locked" });
      }
      if (entry.codeHash !== codeHash) {
        entry.attempts += 1;
        save(data);
        return Promise.resolve({ ok: false, reason: "mismatch" });
      }
      if (consume) {
        data.otps = data.otps.filter((otp) => otp.email !== key);
        save(data);
      }
      return Promise.resolve({ ok: true });
    });
  },

  deleteOtp(email: string): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      const key = email.trim().toLowerCase();
      data.otps = data.otps.filter((entry) => entry.email !== key);
      save(data);
      return Promise.resolve();
    });
  },

  consumeOtpSendQuota(email: string, nowIso: string): Promise<OtpSendPermit> {
    return withLock((): Promise<OtpSendPermit> => {
      const data = load();
      const key = email.trim().toLowerCase();
      const now = Date.parse(nowIso);
      const dayMs = 24 * 60 * 60 * 1000;
      const cooldownMs = 2 * 60 * 1000;
      let limit = data.otpSendLimits.find((entry) => entry.email === key);

      if (!limit || now - Date.parse(limit.windowStartedAt) >= dayMs) {
        limit = {
          email: key,
          windowStartedAt: nowIso,
          lastSentAt: "",
          sends: 0,
        };
        data.otpSendLimits = data.otpSendLimits.filter((entry) => entry.email !== key);
        data.otpSendLimits.push(limit);
      }

      if (limit.sends >= 3) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((Date.parse(limit.windowStartedAt) + dayMs - now) / 1000),
        );
        save(data);
        return Promise.resolve({ allowed: false, reason: "daily_limit", retryAfterSeconds });
      }

      if (limit.lastSentAt) {
        const retryAfterSeconds = Math.ceil(
          (Date.parse(limit.lastSentAt) + cooldownMs - now) / 1000,
        );
        if (retryAfterSeconds > 0) {
          return Promise.resolve({
            allowed: false,
            reason: "cooldown",
            retryAfterSeconds,
          });
        }
      }

      limit.lastSentAt = nowIso;
      limit.sends += 1;
      save(data);
      return Promise.resolve({ allowed: true });
    });
  },

  setStripeCheckoutSession(
    bookingId: string,
    sessionId: string,
    expiresAt: string,
    expectedStartsAt: string,
    addOnPackages: PackageQuantitySelection[] = [],
  ): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      const booking = data.bookings.find((item) => item.id === bookingId);
      if (!booking) throw new Error("Booking not found while saving Checkout Session.");
      if (booking.status === "cancelled" || booking.status === "completed" || booking.paymentStatus !== "due" || booking.startsAt !== expectedStartsAt) {
        throw new Error("Booking is no longer eligible for Checkout.");
      }
      if (new Set(addOnPackages.map((item) => item.lessonId)).size !== addOnPackages.length) {
        throw new Error("Checkout add-on selection is invalid.");
      }
      const alreadySaved = data.bookingCheckoutAddons.filter((item) => item.sessionId === sessionId);
      if (alreadySaved.length) {
        const savedAmounts = new Map<string, number>();
        for (const link of alreadySaved) {
          const purchase = data.packagePurchases.find((item) => item.id === link.purchaseId);
          if (purchase) savedAmounts.set(link.lessonId, (savedAmounts.get(link.lessonId) ?? 0) + Math.round(purchase.amountCad * 100));
        }
        const expectedAmounts = addOnPackages.map((selection) => {
          const lesson = data.lessons.find((item) => item.id === selection.lessonId && item.category === "package");
          return lesson ? `${lesson.id}:${Math.round(lesson.priceCad * selection.quantity * 100)}` : `${selection.lessonId}:invalid`;
        }).sort();
        const actualAmounts = [...savedAmounts].map(([id, cents]) => `${id}:${cents}`).sort();
        if (JSON.stringify(actualAmounts) !== JSON.stringify(expectedAmounts)) {
          throw new Error("Checkout add-ons do not match the saved payment session.");
        }
      } else {
        for (const selection of addOnPackages) {
          const lesson = data.lessons.find((item) => item.id === selection.lessonId && item.category === "package");
          if (!lesson) throw new Error("A selected add-on is no longer available.");
          const purchaseId = randomUUID();
          const now = new Date().toISOString();
          const reference = `WDA-A-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
          data.packagePurchases.push({
            id: purchaseId,
            reference,
            studentName: booking.studentName,
            email: booking.email.toLowerCase(),
            phone: booking.phone,
            notes: `Additional lessons purchased with booking ${booking.reference}.`,
            lessonId: lesson.id,
            lessonName: lesson.name,
            durationMin: lesson.durationMin,
            creditsPurchased: lesson.sessionCount * selection.quantity,
            amountCad: lesson.priceCad * selection.quantity,
            currency: "cad",
            paymentStatus: "pending",
            source: "new",
            createdAt: now,
            updatedAt: now,
            creditsAvailable: 0,
          });
          const scheduled = data.bookingCheckoutAddonSchedules.find((item) => item.bookingId === bookingId && item.lessonId === lesson.id);
          if (!scheduled || scheduled.bookingIds.length !== lesson.sessionCount * selection.quantity) {
            throw new Error("All add-on lesson times must be selected before checkout.");
          }
          data.bookingCheckoutAddons.push({ bookingId, sessionId, purchaseId, lessonId: lesson.id, scheduledBookingIds: scheduled.bookingIds });
        }
      }
      const packageId = booking.packageId ?? booking.id;
      data.bookings.filter((item) => (item.packageId ?? item.id) === packageId).forEach((session) => {
        session.stripeCheckoutSessionId = session.id === booking.id ? sessionId : undefined;
        session.stripeCheckoutExpiresAt = expiresAt;
      });
      save(data);
      return Promise.resolve();
    });
  },

  async getBookingByCheckoutSession(sessionId: string): Promise<BookingRecord | null> {
    return load().bookings.find((booking) => booking.stripeCheckoutSessionId === sessionId) ?? null;
  },

  async getBookingCheckoutAddons(bookingId: string, sessionId: string): Promise<PackagePurchaseRecord[]> {
    const data = load();
    return data.bookingCheckoutAddons
      .filter((item) => item.bookingId === bookingId && item.sessionId === sessionId)
      .map(({ purchaseId }) => {
        const purchase = data.packagePurchases.find((item) => item.id === purchaseId);
        if (!purchase) return null;
        const creditsAvailable = data.packageCreditEvents
          .filter((event) => event.purchaseId === purchase.id)
          .reduce((balance, event) => balance + event.quantityDelta, 0);
        return { ...purchase, creditsAvailable };
      })
      .filter((purchase): purchase is PackagePurchaseRecord => purchase !== null);
  },

  setStripeUpgradeCheckoutSession(bookingId, sessionId, targetLesson, fromPriceCad, amountCad, expectedStartsAt, proposedSessions) {
    return withLock(async () => {
      const data = load();
      const booking = data.bookings.find((item) => item.id === bookingId);
      const packageId = booking?.packageId ?? booking?.id;
      const sessions = packageId ? data.bookings.filter((item) => (item.packageId ?? item.id) === packageId) : [];
      const currentPriceCad = booking?.packagePriceCad ?? booking?.priceCad;
      const proposedConflicts = proposedSessions.some((candidate, index) =>
        proposedSessions.some((other, otherIndex) => index !== otherIndex && overlaps(Date.parse(candidate.startsAt), occupiedEnd(candidate.startsAt, targetLesson.durationMin), Date.parse(other.startsAt), occupiedEnd(other.startsAt, targetLesson.durationMin))) ||
        activeBookings(data).some((item) => (item.packageId ?? item.id) !== packageId && overlaps(Date.parse(candidate.startsAt), occupiedEnd(candidate.startsAt, targetLesson.durationMin), Date.parse(item.startsAt), occupiedEnd(item.startsAt, item.durationMin))) ||
        data.bookings.some((item) => item.stripeUpgradeCheckoutSessionId && (item.packageId ?? item.id) !== packageId &&
          (item.stripeUpgradeTargetSessions ?? []).some((reserved) => overlaps(Date.parse(candidate.startsAt), occupiedEnd(candidate.startsAt, targetLesson.durationMin), Date.parse(reserved.startsAt), occupiedEnd(reserved.startsAt, item.stripeUpgradeTargetDurationMin ?? item.durationMin))))
      );
      if (!booking || !sessions.every((item) => ["confirmed", "rescheduled"].includes(item.status) && item.paymentStatus === "paid") ||
         booking.startsAt !== expectedStartsAt || currentPriceCad !== fromPriceCad ||
         targetLesson.priceCad <= fromPriceCad ||
         Math.round((targetLesson.priceCad - fromPriceCad) * 100) / 100 !== amountCad ||
         booking.stripeUpgradeCheckoutSessionId || proposedSessions.length !== targetLesson.sessionCount || proposedConflicts) {
        throw new Error("Booking is no longer eligible for an upgrade.");
      }
      booking.stripeUpgradeCheckoutSessionId = sessionId;
      booking.stripeUpgradeAttempt ??= 0;
      booking.stripeUpgradeFromPriceCad = fromPriceCad;
      booking.stripeUpgradeTargetLessonId = targetLesson.id;
      booking.stripeUpgradeTargetLessonName = targetLesson.name;
      booking.stripeUpgradeTargetDurationMin = targetLesson.durationMin;
      booking.stripeUpgradeTargetPriceCad = targetLesson.priceCad;
      booking.stripeUpgradeAmountCad = amountCad;
      booking.stripeUpgradeTargetSessions = proposedSessions;
      save(data);
    });
  },

  async getBookingByUpgradeCheckoutSession(sessionId) {
    return load().bookings.find((booking) => booking.stripeUpgradeCheckoutSessionId === sessionId) ?? null;
  },

  handleStripeCheckoutEvent(event: StripeCheckoutEvent): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      if (data.stripeWebhookEvents.includes(event.eventId)) return Promise.resolve();
      const booking = data.bookings.find((item) => item.id === event.bookingId);
      const addonLinks = data.bookingCheckoutAddons.filter((item) => item.bookingId === event.bookingId && item.sessionId === event.sessionId);
      const addonPurchases = addonLinks.map((link) => data.packagePurchases.find((item) => item.id === link.purchaseId)).filter((item): item is PackagePurchaseRecord => Boolean(item));
      const expectedSubtotalCents = Math.round(((booking?.packagePriceCad ?? booking?.priceCad ?? -1) + addonPurchases.reduce((sum, item) => sum + item.amountCad, 0)) * 100);
      const paymentTotalsMatch = event.subtotalCents === expectedSubtotalCents &&
        event.taxCents !== undefined && event.taxCents >= 0 &&
        event.totalCents === event.subtotalCents + event.taxCents &&
        event.currency?.toLowerCase() === "cad";
      if (event.eventType === "paid" && (
        !booking || booking.stripeCheckoutSessionId !== event.sessionId ||
        booking.paymentStatus !== "due" || !paymentTotalsMatch
      )) {
        throw new Error("Stripe Checkout event does not match the stored booking payment.");
      }
      data.stripeWebhookEvents.push(event.eventId);
      if (
        booking && event.eventType === "paid" &&
        booking.stripeCheckoutSessionId === event.sessionId &&
        booking.paymentStatus === "due" && paymentTotalsMatch
      ) {
        const packageId = booking.packageId ?? booking.id;
        const now = new Date().toISOString();
        data.bookings.filter((item) => (item.packageId ?? item.id) === packageId).forEach((session) => {
          session.paymentStatus = "paid";
          session.stripeCheckoutExpiresAt = session.status === "pending_payment" ? now : undefined;
          if (session.status === "pending_payment") session.status = "confirmed";
          session.stripePaymentIntentId = event.paymentIntentId;
          session.stripeInvoiceId = event.invoiceId;
          session.stripeInvoiceUrl = event.invoiceUrl;
          session.stripeSubtotalCad = centsToCad(event.subtotalCents);
          session.stripeTaxCad = centsToCad(event.taxCents);
          session.stripeTotalCad = centsToCad(event.totalCents);
          session.stripeCurrency = event.currency?.toUpperCase();
          session.updatedAt = now;
        });
        addonPurchases.forEach((purchase) => {
          if (purchase.paymentStatus !== "pending") return;
          purchase.paymentStatus = "paid";
          purchase.purchasedAt = now;
          purchase.validUntil = addVancouverCalendarMonths(new Date(now), 6).toISOString();
          purchase.stripePaymentIntentId = event.paymentIntentId;
          purchase.stripeInvoiceId = event.invoiceId;
          purchase.stripeInvoiceUrl = event.invoiceUrl;
          purchase.stripeSubtotalCad = purchase.amountCad;
          purchase.updatedAt = now;
          const sourceKey = `booking-addon-grant:${purchase.id}`;
          if (!data.packageCreditEvents.some((entry) => entry.sourceKey === sourceKey)) {
            data.packageCreditEvents.push({
              purchaseId: purchase.id,
              eventType: "grant",
              quantityDelta: purchase.creditsPurchased,
              sourceKey,
              note: `Additional lessons paid with booking ${booking.reference}.`,
              createdAt: now,
            });
          }
          const scheduledIds = data.bookingCheckoutAddons.find((link) => link.purchaseId === purchase.id)?.scheduledBookingIds ?? [];
          if (scheduledIds.length !== purchase.creditsPurchased) {
            throw new Error("Scheduled add-on lesson count does not match the purchased package.");
          }
          for (const scheduledBookingId of scheduledIds) {
            const redeemKey = `booking-addon-redeem:${purchase.id}:${scheduledBookingId}`;
            if (!data.packageCreditEvents.some((entry) => entry.sourceKey === redeemKey)) {
              data.packageCreditEvents.push({
                purchaseId: purchase.id,
                bookingId: scheduledBookingId,
                eventType: "redeem",
                quantityDelta: -1,
                sourceKey: redeemKey,
                note: "Lesson scheduled as part of the combined booking checkout.",
                createdAt: now,
              });
            }
          }
        });
      } else if (
        booking &&
        event.eventType === "expired" &&
        booking.stripeCheckoutSessionId === event.sessionId
      ) {
        const packageId = booking.packageId ?? booking.id;
        data.bookings.filter((session) => (session.packageId ?? session.id) === packageId).forEach((session) => {
          session.stripeCheckoutSessionId = undefined;
          session.stripeCheckoutExpiresAt = undefined;
          session.stripeCheckoutAttempt = (session.stripeCheckoutAttempt ?? 0) + 1;
          session.updatedAt = new Date().toISOString();
        });
        addonPurchases.forEach((purchase) => {
          if (purchase.paymentStatus === "pending") {
            purchase.paymentStatus = "failed";
            purchase.updatedAt = booking.updatedAt;
          }
        });
      }
      save(data);
      return Promise.resolve();
    });
  },

  handleStripeUpgradeCheckoutEvent(event: StripeUpgradeCheckoutEvent): Promise<void> {
    return withLock(async () => {
      const data = load();
      if (data.stripeWebhookEvents.includes(event.eventId)) return;
      data.stripeWebhookEvents.push(event.eventId);
      const booking = data.bookings.find((item) => item.id === event.bookingId);
      if (!booking) { save(data); return; }
      const totalsMatch = event.subtotalCents === Math.round((booking.stripeUpgradeAmountCad ?? -1) * 100) &&
        event.taxCents !== undefined && event.taxCents >= 0 &&
        event.totalCents === event.subtotalCents + event.taxCents &&
        event.currency?.toLowerCase() === "cad";
      if (
        event.eventType === "paid" && booking.stripeUpgradeCheckoutSessionId === event.sessionId &&
        booking.paymentStatus === "paid" && ["confirmed", "rescheduled"].includes(booking.status) &&
        booking.stripeUpgradeFromPriceCad === event.fromPriceCad &&
        booking.stripeUpgradeTargetLessonId === event.targetLessonId &&
        booking.stripeUpgradeTargetLessonName === event.targetLessonName &&
        booking.stripeUpgradeTargetDurationMin === event.targetDurationMin &&
        booking.stripeUpgradeTargetPriceCad === event.targetPriceCad && totalsMatch
      ) {
        const packageId = booking.packageId ?? booking.id;
        const sessions = data.bookings.filter((item) => (item.packageId ?? item.id) === packageId);
        const totalCents = Math.round(event.targetPriceCad * 100);
        const baseCents = Math.floor(totalCents / sessions.length);
        const remainder = totalCents % sessions.length;
        const now = new Date().toISOString();
        sessions.forEach((session, index) => {
          session.lessonId = event.targetLessonId;
          session.lessonName = event.targetLessonName;
          session.durationMin = event.targetDurationMin;
          session.priceCad = (baseCents + (index < remainder ? 1 : 0)) / 100;
          session.packagePriceCad = event.targetPriceCad;
          session.endsAt = new Date(Date.parse(session.startsAt) + event.targetDurationMin * 60000).toISOString();
          const proposed = booking.stripeUpgradeTargetSessions?.[index];
          if (!proposed) throw new Error("Upgrade session schedule is incomplete.");
          session.startsAt = proposed.startsAt;
          session.endsAt = proposed.endsAt;
          session.stripePaymentIntentId = event.paymentIntentId;
          session.stripeInvoiceId = event.invoiceId;
          session.stripeInvoiceUrl = event.invoiceUrl;
          session.stripeSubtotalCad = centsToCad(event.subtotalCents);
          session.stripeTaxCad = centsToCad(event.taxCents);
          session.stripeTotalCad = centsToCad(event.totalCents);
          session.stripeCurrency = event.currency?.toUpperCase();
          session.stripeUpgradeCheckoutSessionId = undefined;
          session.stripeUpgradeAttempt = (session.stripeUpgradeAttempt ?? 0) + 1;
          session.stripeUpgradeFromPriceCad = undefined;
          session.stripeUpgradeTargetLessonId = undefined;
          session.stripeUpgradeTargetLessonName = undefined;
          session.stripeUpgradeTargetDurationMin = undefined;
          session.stripeUpgradeTargetPriceCad = undefined;
          session.stripeUpgradeAmountCad = undefined;
          session.stripeUpgradeTargetSessions = undefined;
          session.updatedAt = now;
        });
      } else if (event.eventType === "expired" && booking.stripeUpgradeCheckoutSessionId === event.sessionId) {
        booking.stripeUpgradeCheckoutSessionId = undefined;
        booking.stripeUpgradeTargetSessions = undefined;
        booking.stripeUpgradeAttempt = (booking.stripeUpgradeAttempt ?? 0) + 1;
        booking.updatedAt = new Date().toISOString();
      }
      save(data);
    });
  },

  async createPackagePurchase(input: CreatePackagePurchaseInput): Promise<PackagePurchaseRecord> {
    return withLock(async () => {
      const data = load();
      const now = new Date().toISOString();
      const purchase: PackagePurchaseRecord = {
        id: randomUUID(),
        reference: input.reference,
        studentName: input.studentName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        notes: input.notes.trim(),
        lessonId: input.lessonId,
        lessonName: input.lessonName,
        durationMin: input.durationMin,
        creditsPurchased: input.creditsPurchased,
        amountCad: input.amountCad,
        currency: "cad",
        paymentStatus: "pending",
        source: "new",
        createdAt: now,
        updatedAt: now,
        creditsAvailable: 0,
      };
      data.packagePurchases.push(purchase);
      save(data);
      return purchase;
    });
  },

  setStripePackagePurchaseCheckout(purchaseId, sessionId, expiresAt) {
    return withLock(async () => {
      const data = load();
      const purchase = data.packagePurchases.find((item) => item.id === purchaseId);
      if (!purchase || !["pending", "failed"].includes(purchase.paymentStatus)) {
        throw new Error("Package purchase is no longer eligible for Checkout.");
      }
      purchase.paymentStatus = "pending";
      purchase.stripeCheckoutSessionId = sessionId;
      purchase.stripeCheckoutExpiresAt = expiresAt;
      purchase.updatedAt = new Date().toISOString();
      save(data);
    });
  },

  async getPackagePurchaseByCheckoutSession(sessionId) {
    return load().packagePurchases.find((item) => item.stripeCheckoutSessionId === sessionId) ?? null;
  },

  async findPackagePurchasesByEmail(email) {
    const data = load();
    return data.packagePurchases
      .filter((item) => item.email === email.trim().toLowerCase())
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((purchase) => ({
        ...purchase,
        creditsAvailable: data.packageCreditEvents
          .filter((event) => event.purchaseId === purchase.id)
          .reduce((balance, event) => balance + event.quantityDelta, 0),
      }));
  },

  async listPackagePurchases(limit = 200) {
    const data = load();
    return [...data.packagePurchases]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(500, limit)))
      .map((purchase) => ({
        ...purchase,
        creditsAvailable: data.packageCreditEvents
          .filter((event) => event.purchaseId === purchase.id)
          .reduce((balance, event) => balance + event.quantityDelta, 0),
      }));
  },

  async listPackageCreditEvents(purchaseIds): Promise<PackageCreditEventRecord[]> {
    if (!purchaseIds.length) return [];
    const wanted = new Set(purchaseIds);
    return load().packageCreditEvents
      .filter((event) => wanted.has(event.purchaseId))
      .map((event) => ({
        id: event.sourceKey,
        purchaseId: event.purchaseId,
        bookingId: event.bookingId,
        eventType: event.eventType,
        quantityDelta: event.quantityDelta,
        sourceKey: event.sourceKey,
        note: event.note,
        createdAt: event.createdAt,
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },

  async getPackagePurchaseByToken(tokenHash) {
    const data = load();
    const token = data.packagePurchaseTokens.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) >= Date.now());
    const purchase = token && data.packagePurchases.find((item) => item.id === token.purchaseId);
    if (!purchase) return null;
    const creditsAvailable = data.packageCreditEvents
      .filter((event) => event.purchaseId === purchase.id)
      .reduce((balance, event) => balance + event.quantityDelta, 0);
    return { ...purchase, creditsAvailable };
  },

  async getPackagePurchaseById(purchaseId) {
    const data = load();
    const purchase = data.packagePurchases.find((item) => item.id === purchaseId);
    if (!purchase) return null;
    const creditsAvailable = data.packageCreditEvents
      .filter((event) => event.purchaseId === purchase.id)
      .reduce((balance, event) => balance + event.quantityDelta, 0);
    return { ...purchase, creditsAvailable };
  },

  async findBookingsByPurchaseId(purchaseId) {
    return load().bookings
      .filter((booking) => booking.purchaseId === purchaseId)
      .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0));
  },

  issuePackagePurchaseManageToken(purchaseId) {
    return withLock(async () => {
      const data = load();
      if (!data.packagePurchases.some((item) => item.id === purchaseId)) return null;
      const rawToken = generateToken();
      data.packagePurchaseTokens = data.packagePurchaseTokens.filter((item) => item.purchaseId !== purchaseId);
      data.packagePurchaseTokens.push({ tokenHash: hashToken(rawToken), purchaseId, expiresAt: tokenExpiry() });
      save(data);
      return rawToken;
    });
  },

  handleStripePackagePurchaseEvent(event: StripePackagePurchaseEvent): Promise<void> {
    return withLock(async () => {
      const data = load();
      if (data.stripeWebhookEvents.includes(event.eventId)) return;
      const purchase = data.packagePurchases.find((item) => item.id === event.purchaseId);
      if (!purchase || purchase.source !== "new" || purchase.stripeCheckoutSessionId !== event.sessionId) {
        throw new Error("Stripe event does not match the stored package purchase.");
      }
      if (event.eventType === "expired") {
        if (purchase.paymentStatus === "pending") {
          data.stripeWebhookEvents.push(event.eventId);
          purchase.paymentStatus = "failed";
          purchase.stripeCheckoutSessionId = undefined;
          purchase.stripeCheckoutExpiresAt = undefined;
          purchase.updatedAt = new Date().toISOString();
          save(data);
        }
        return;
      }
      const totalsMatch = event.subtotalCents === Math.round(purchase.amountCad * 100) &&
        event.taxCents !== undefined && event.taxCents >= 0 &&
        event.totalCents === event.subtotalCents + event.taxCents &&
        event.currency?.toLowerCase() === "cad" &&
        typeof event.paidAt === "string" && Number.isFinite(Date.parse(event.paidAt)) &&
        Date.parse(event.paidAt) <= Date.now() + 5 * 60_000;
      if (!totalsMatch || !["pending", "paid"].includes(purchase.paymentStatus)) {
        throw new Error("Stripe Checkout event does not match the package purchase amount or status.");
      }
      data.stripeWebhookEvents.push(event.eventId);
      const purchasedAt = purchase.purchasedAt ?? new Date(event.paidAt!).toISOString();
      purchase.paymentStatus = "paid";
      purchase.purchasedAt = purchasedAt;
      purchase.validUntil = addVancouverCalendarMonths(new Date(purchasedAt), 6).toISOString();
      purchase.stripePaymentIntentId = event.paymentIntentId;
      purchase.stripeInvoiceId = event.invoiceId;
      purchase.stripeInvoiceUrl = event.invoiceUrl;
      purchase.stripeSubtotalCad = centsToCad(event.subtotalCents);
      purchase.stripeTaxCad = centsToCad(event.taxCents);
      purchase.stripeTotalCad = centsToCad(event.totalCents);
      purchase.updatedAt = new Date().toISOString();
      const sourceKey = `stripe-purchase-grant:${purchase.id}`;
      if (!data.packageCreditEvents.some((entry) => entry.sourceKey === sourceKey)) {
        data.packageCreditEvents.push({
          purchaseId: purchase.id,
          eventType: "grant",
          quantityDelta: purchase.creditsPurchased,
          sourceKey,
          createdAt: new Date().toISOString(),
        });
      }
      purchase.creditsAvailable = data.packageCreditEvents
        .filter((entry) => entry.purchaseId === purchase.id)
        .reduce((balance, entry) => balance + entry.quantityDelta, 0);
      save(data);
    });
  },

  schedulePackageCredit(purchaseId, startsAt, token) {
    return withLock(async () => {
      const data = load();
      const purchase = data.packagePurchases.find((item) => item.id === purchaseId);
      if (!purchase || purchase.paymentStatus !== "paid" || !purchase.validUntil || Date.parse(purchase.validUntil) <= Date.now()) {
        return { ok: false, error: "expired" as const };
      }
      const currentToken = data.packagePurchaseTokens.find((item) =>
        item.tokenHash === token.currentHash && item.purchaseId === purchase.id && Date.parse(item.expiresAt) >= Date.now(),
      );
      if (!currentToken) return { ok: false, error: "not_found" as const };
      const available = data.packageCreditEvents
        .filter((event) => event.purchaseId === purchase.id)
        .reduce((balance, event) => balance + event.quantityDelta, 0);
      if (available < 1) return { ok: false, error: "not_modifiable" as const };
      const startsAtMs = Date.parse(startsAt);
      if (!Number.isFinite(startsAtMs) || startsAtMs >= Date.parse(purchase.validUntil)) {
        return { ok: false, error: "expired" as const };
      }
      const busy: BusyInterval[] = [
        ...activeBookings(data).map((booking) => ({
          startsAt: booking.startsAt,
          endsAt: new Date(occupiedEnd(booking.startsAt, booking.durationMin)).toISOString(),
        })),
        ...data.bookings.flatMap((booking) => booking.stripeUpgradeCheckoutSessionId
          ? (booking.stripeUpgradeTargetSessions ?? []).map((item) => ({
              startsAt: item.startsAt,
              endsAt: new Date(occupiedEnd(item.startsAt, booking.stripeUpgradeTargetDurationMin ?? booking.durationMin)).toISOString(),
            }))
          : []),
      ];
      const validation = validateSlot(startsAt, {
        lessonDurationMin: purchase.durationMin,
        busy,
        blackouts: data.blackouts,
        rules: data.rules.length ? data.rules : DEFAULT_RULES,
        dateOverrides: data.dateOverrides,
        now: new Date(),
      });
      if (!validation.valid) return { ok: false, error: validation.reason === "occupied" ? "conflict" as const : "not_found" as const };

      const sessionIndex = data.bookings
        .filter((booking) => booking.purchaseId === purchase.id)
        .reduce((max, booking) => Math.max(max, booking.sessionIndex ?? 0), 0) + 1;
      if (sessionIndex > purchase.creditsPurchased) return { ok: false, error: "not_modifiable" as const };
      const totalCents = Math.round(purchase.amountCad * 100);
      const baseCents = Math.floor(totalCents / purchase.creditsPurchased);
      const remainder = totalCents % purchase.creditsPurchased;
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: randomUUID(),
        reference: makeReference(),
        lessonId: purchase.lessonId,
        lessonName: purchase.lessonName,
        durationMin: purchase.durationMin,
        priceCad: (baseCents + (sessionIndex <= remainder ? 1 : 0)) / 100,
        startsAt: new Date(startsAtMs).toISOString(),
        endsAt: new Date(startsAtMs + purchase.durationMin * 60_000).toISOString(),
        studentName: purchase.studentName,
        email: purchase.email,
        phone: purchase.phone,
        notes: purchase.notes,
        status: "confirmed",
        paymentStatus: "paid",
        stripePaymentIntentId: purchase.stripePaymentIntentId,
        stripeInvoiceId: purchase.stripeInvoiceId,
        stripeInvoiceUrl: purchase.stripeInvoiceUrl,
        stripeCurrency: "CAD",
        createdAt: now,
        updatedAt: now,
        packageId: purchase.id,
        purchaseId: purchase.id,
        sessionIndex,
        sessionCount: purchase.creditsPurchased,
        packagePriceCad: purchase.amountCad,
        packageWindowStart: dayKeyOf(new Date(startsAtMs).toISOString()),
      };
      const sourceKey = `scheduled-credit:${booking.id}`;
      data.bookings.push(booking);
      data.tokens = data.tokens.filter((entry) => !data.bookings.some((session) =>
        session.purchaseId === purchase.id && session.id === entry.bookingId,
      ));
      data.tokens.push({ tokenHash: token.hash, bookingId: booking.id, expiresAt: token.expiresAt });
      data.packageCreditEvents.push({
        purchaseId: purchase.id,
        bookingId: booking.id,
        eventType: "redeem",
        quantityDelta: -1,
        sourceKey,
        createdAt: now,
      });
      purchase.creditsAvailable = available - 1;
      purchase.updatedAt = now;
      data.packagePurchaseTokens = data.packagePurchaseTokens.filter((item) => item.purchaseId !== purchase.id);
      data.packagePurchaseTokens.push({ tokenHash: token.hash, purchaseId: purchase.id, expiresAt: token.expiresAt });
      save(data);
      return { ok: true, value: booking };
    });
  },
};

function centsToCad(cents: number | undefined): number | undefined {
  return cents === undefined ? undefined : cents / 100;
}
