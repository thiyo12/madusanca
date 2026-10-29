import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { DEFAULT_RULES } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { OTP_MAX_ATTEMPTS } from "@/lib/booking/otp";
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
  OtpSendPermit,
  PaymentStatus,
  StripeCheckoutEvent,
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

  async getBookingByToken(tokenHash: string) {
    const data = load();
    const entry = data.tokens.find((t) => t.tokenHash === tokenHash);
    if (!entry) return null;
    if (Date.parse(entry.expiresAt) < Date.now()) return null;
    const booking = data.bookings.find((b) => b.id === entry.bookingId);
    if (!booking) return null;
    return { booking, tokenExpiresAt: entry.expiresAt };
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

  cancelBookingByToken(tokenHash: string): Promise<StoreResult<BookingRecord>> {
    return withLock((): Promise<StoreResult<BookingRecord>> => {
      const data = load();
      const entry = data.tokens.find((t) => t.tokenHash === tokenHash);
      if (!entry || Date.parse(entry.expiresAt) < Date.now()) {
        return Promise.resolve({ ok: false, error: "expired" as const });
      }
      const booking = data.bookings.find((b) => b.id === entry.bookingId);
      if (!booking || booking.status === "cancelled") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      booking.status = "cancelled";
      booking.updatedAt = new Date().toISOString();
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
      if (booking.status === "cancelled" || booking.status === "completed") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      booking.status = status;
      booking.updatedAt = new Date().toISOString();
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
      booking.paymentStatus = paymentStatus;
      booking.updatedAt = new Date().toISOString();
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
      data.tokens = data.tokens.filter((entry) => entry.bookingId !== id);
      data.tokens.push({
        tokenHash: hashToken(newToken),
        bookingId: id,
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
      if (booking.status === "cancelled") {
        return Promise.resolve({ ok: false, error: "not_modifiable" as const });
      }
      booking.status = "cancelled";
      booking.updatedAt = new Date().toISOString();
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
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  },

  issueManageToken(bookingId: string): Promise<string | null> {
    return withLock((): Promise<string | null> => {
      const data = load();
      const booking = data.bookings.find((b) => b.id === bookingId);
      if (!booking) return Promise.resolve(null);
      const raw = generateToken();
      data.tokens = data.tokens.filter((t) => t.bookingId !== bookingId);
      data.tokens.push({
        tokenHash: hashToken(raw),
        bookingId,
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

  handleStripeCheckoutEvent(event: StripeCheckoutEvent): Promise<void> {
    return withLock((): Promise<void> => {
      const data = load();
      if (data.stripeWebhookEvents.includes(event.eventId)) return Promise.resolve();
      data.stripeWebhookEvents.push(event.eventId);
      const booking = data.bookings.find((item) => item.id === event.bookingId);
      if (booking && event.eventType === "paid") {
        booking.paymentStatus = "paid";
        booking.stripeCheckoutExpiresAt = booking.status === "pending_payment"
          ? new Date().toISOString()
          : undefined;
        if (booking.status === "pending_payment") booking.status = "confirmed";
        booking.stripeCheckoutSessionId = event.sessionId;
        booking.stripePaymentIntentId = event.paymentIntentId;
        booking.stripeInvoiceId = event.invoiceId;
        booking.stripeInvoiceUrl = event.invoiceUrl;
        booking.stripeSubtotalCad = centsToCad(event.subtotalCents);
        booking.stripeTaxCad = centsToCad(event.taxCents);
        booking.stripeTotalCad = centsToCad(event.totalCents);
        booking.stripeCurrency = event.currency?.toUpperCase();
        booking.updatedAt = new Date().toISOString();
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
};

function centsToCad(cents: number | undefined): number | undefined {
  return cents === undefined ? undefined : cents / 100;
}
