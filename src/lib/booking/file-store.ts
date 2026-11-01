import "server-only";

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { DEFAULT_RULES } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { OTP_MAX_ATTEMPTS } from "@/lib/booking/otp";
import { customerCanAccessBooking } from "@/lib/booking/customer-access";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import { lessons as defaultLessons, type Lesson } from "@/lib/data/lessons";
import type {
  AdminRescheduleResult,
  AvailabilityRule,
  BlackoutDate,
  BookingFilter,
  BookingRecord,
  BookingStatus,
  BookingStore,
  BusyInterval,
  CreateBookingInput,
  CreateBookingPackageInput,
  OtpSendPermit,
  PaymentStatus,
  StripeCheckoutEvent,
  StripeUpgradeCheckoutEvent,
  StoreResult,
} from "@/lib/booking/types";

interface FileData {
  rules: AvailabilityRule[];
  blackouts: BlackoutDate[];
  bookings: BookingRecord[];
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
}

const DATA_DIR = join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "store.json");

function load(): FileData {
  if (!existsSync(DATA_FILE)) {
    return {
      rules: DEFAULT_RULES,
      blackouts: [],
      bookings: [],
      tokens: [],
      lessons: structuredClone(defaultLessons),
      otps: [],
      otpSendLimits: [],
      stripeWebhookEvents: [],
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

  async getBlackouts(): Promise<BlackoutDate[]> {
    return load().blackouts;
  },

  async getBusy(fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return activeBookings(load())
      .filter((b) => overlaps(Date.parse(b.startsAt), Date.parse(b.endsAt), from, to))
      .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt }));
  },

  createBooking(
    input: CreateBookingInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const start = Date.parse(input.startsAt);
      const end = Date.parse(input.endsAt);
      const conflict = activeBookings(data).some((b) =>
        overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)),
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
      const parsed = sessions.map((session) => ({ start: Date.parse(session.startsAt), end: Date.parse(session.endsAt) }));
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
        overlaps(slot.start, slot.end, Date.parse(booking.startsAt), Date.parse(booking.endsAt)),
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
      const end = Date.parse(endsAt);
      const conflict = activeBookings(data).some(
        (b) => b.id !== booking.id && overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)),
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
      const end = Date.parse(endsAt);
      const conflict = activeBookings(data).some((item) => item.id !== target.id && overlaps(start, end, Date.parse(item.startsAt), Date.parse(item.endsAt)));
      if (conflict) return Promise.resolve({ ok: false, error: "conflict" as const });
      const packageStart = target.packageWindowStart ?? dayKeyOf(anchor.startsAt);
      if (dayKeyOf(new Date(start).toISOString()) < packageStart || dayKeyOf(new Date(start).toISOString()) > addMonthsToKey(packageStart, 2)) {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      target.startsAt = new Date(start).toISOString();
      target.endsAt = new Date(end).toISOString();
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

  cancelBookingByToken(tokenHash: string): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const entry = data.tokens.find((t) => t.tokenHash === tokenHash);
      if (!entry || Date.parse(entry.expiresAt) < Date.now()) {
        return Promise.resolve({ ok: false, error: "expired" as const });
      }
      const booking = data.bookings.find((b) => b.id === entry.bookingId);
      if (!booking || !cancelPackage(data, booking)) {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      save(data);
      return Promise.resolve({ ok: true as const, value: booking });
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

  updateBookingStatus(id: string, status: BookingStatus): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === id);
      if (!booking) return Promise.resolve({ ok: false, error: "not_found" as const });
      if (status === "completed") {
        const packageId = booking.packageId ?? booking.id;
        const now = new Date().toISOString();
        data.bookings.filter((item) => (item.packageId ?? item.id) === packageId)
          .forEach((item) => { item.status = "completed"; item.updatedAt = now; });
        data.tokens = data.tokens.filter((entry) => !data.bookings.some((item) =>
          (item.packageId ?? item.id) === packageId && item.id === entry.bookingId,
        ));
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
      const end = Date.parse(endsAt);
      const conflict = activeBookings(data).some(
        (b) => b.id !== id && overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)),
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
  ): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      const booking = data.bookings.find((item) => item.id === bookingId);
      if (!booking) throw new Error("Booking not found while saving Checkout Session.");
      if (booking.status === "cancelled" || booking.status === "completed" || booking.paymentStatus !== "due" || booking.startsAt !== expectedStartsAt) {
        throw new Error("Booking is no longer eligible for Checkout.");
      }
      booking.stripeCheckoutSessionId = sessionId;
      booking.stripeCheckoutExpiresAt = expiresAt;
      save(data);
      return Promise.resolve();
    });
  },

  async getBookingByCheckoutSession(sessionId: string): Promise<BookingRecord | null> {
    return load().bookings.find((booking) => booking.stripeCheckoutSessionId === sessionId) ?? null;
  },

  setStripeUpgradeCheckoutSession(bookingId, sessionId, targetLesson, fromPriceCad, amountCad, expectedStartsAt) {
    return withLock(async () => {
      const data = load();
      const booking = data.bookings.find((item) => item.id === bookingId);
      const packageId = booking?.packageId ?? booking?.id;
      const sessions = packageId ? data.bookings.filter((item) => (item.packageId ?? item.id) === packageId) : [];
      const currentPriceCad = booking?.packagePriceCad ?? booking?.priceCad;
      if (!booking || !sessions.every((item) => ["confirmed", "rescheduled"].includes(item.status) && item.paymentStatus === "paid") ||
        booking.startsAt !== expectedStartsAt || currentPriceCad !== fromPriceCad ||
        targetLesson.priceCad <= fromPriceCad ||
        Math.round((targetLesson.priceCad - fromPriceCad) * 100) / 100 !== amountCad ||
        booking.stripeUpgradeCheckoutSessionId) {
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
      const paymentTotalsMatch = event.subtotalCents === Math.round((booking?.packagePriceCad ?? booking?.priceCad ?? -1) * 100) &&
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
      } else if (
        booking &&
        event.eventType === "expired" &&
        booking.stripeCheckoutSessionId === event.sessionId
      ) {
        booking.stripeCheckoutSessionId = undefined;
        booking.stripeCheckoutExpiresAt = undefined;
        booking.stripeCheckoutAttempt = (booking.stripeCheckoutAttempt ?? 0) + 1;
        booking.updatedAt = new Date().toISOString();
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
          session.updatedAt = now;
        });
      } else if (event.eventType === "expired" && booking.stripeUpgradeCheckoutSessionId === event.sessionId) {
        booking.stripeUpgradeCheckoutSessionId = undefined;
        booking.stripeUpgradeAttempt = (booking.stripeUpgradeAttempt ?? 0) + 1;
        booking.updatedAt = new Date().toISOString();
      }
      save(data);
    });
  },
};

function centsToCad(cents: number | undefined): number | undefined {
  return cents === undefined ? undefined : cents / 100;
}
