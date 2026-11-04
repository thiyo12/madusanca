export type BookingStatus = "pending_payment" | "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";
export type PaymentStatus = "due" | "paid" | "refunded" | "waived";
export type ChequeStatus = "none" | "received" | "cleared" | "returned";

import type { Lesson } from "@/lib/data/lessons";

/** A single school availability window for one weekday (Vancouver local minutes). */
export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes from local midnight, inclusive. */
  startMin: number;
  /** Minutes from local midnight, exclusive. */
  endMin: number;
}

/** One-off shorter/open hours for a specific Pacific calendar date. */
export interface AvailabilityDateOverride {
  date: string;
  startMin: number;
  endMin: number;
}

export interface BlackoutDate {
  /** YYYY-MM-DD in America/Vancouver */
  date: string;
  reason?: string;
}

export interface BusyInterval {
  /** Interval during which the instructor is occupied, including any buffer. */
  startsAt: string;
  endsAt: string;
}

export interface BookingRecord {
  id: string;
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
  status: BookingStatus;
  paymentStatus?: PaymentStatus;
  chequeStatus?: ChequeStatus;
  chequeReference?: string;
  chequeReceivedAt?: string;
  /** Number of student-initiated reschedules; admin changes do not count. */
  studentRescheduleCount?: number;
  stripeCheckoutSessionId?: string;
  stripeCheckoutAttempt?: number;
  stripeCheckoutExpiresAt?: string;
  stripeUpgradeCheckoutSessionId?: string;
  stripeUpgradeAttempt?: number;
  stripeUpgradeFromPriceCad?: number;
  stripeUpgradeTargetLessonId?: string;
  stripeUpgradeTargetLessonName?: string;
  stripeUpgradeTargetDurationMin?: number;
  stripeUpgradeTargetPriceCad?: number;
  stripeUpgradeAmountCad?: number;
  stripeUpgradeTargetSessions?: Array<{ startsAt: string; endsAt: string }>;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  stripeInvoiceUrl?: string;
  stripeSubtotalCad?: number;
  stripeTaxCad?: number;
  stripeTotalCad?: number;
  stripeCurrency?: string;
  createdAt: string;
  updatedAt: string;
  packageId?: string;
  sessionIndex?: number;
  sessionCount?: number;
  packagePriceCad?: number;
  packageWindowStart?: string;
  purchaseId?: string;
}

export type PackagePurchasePaymentStatus = "pending" | "paid" | "refunded" | "waived" | "failed";

export interface PackagePurchaseRecord {
  id: string;
  reference: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  creditsPurchased: number;
  amountCad: number;
  currency: "cad";
  paymentStatus: PackagePurchasePaymentStatus;
  chequeStatus?: ChequeStatus;
  chequeReference?: string;
  chequeReceivedAt?: string;
  purchasedAt?: string;
  validUntil?: string;
  stripeCheckoutSessionId?: string;
  stripeCheckoutExpiresAt?: string;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  stripeInvoiceUrl?: string;
  stripeSubtotalCad?: number;
  stripeTaxCad?: number;
  stripeTotalCad?: number;
  source: "new" | "legacy_backfill";
  createdAt: string;
  updatedAt: string;
  creditsAvailable: number;
}

export interface PackageCreditEventRecord {
  id: string;
  purchaseId: string;
  bookingId?: string;
  eventType: "grant" | "redeem" | "refund" | "expire" | "admin_adjustment";
  quantityDelta: number;
  sourceKey: string;
  actorId?: string;
  note?: string;
  createdAt: string;
}

export interface CreatePackagePurchaseInput {
  reference: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  creditsPurchased: number;
  amountCad: number;
}

export interface PackageQuantitySelection {
  lessonId: string;
  quantity: number;
}

export interface ScheduledPackageSelection extends PackageQuantitySelection {
  startsAt: string[];
}

export interface BookingSlotHold {
  startsAt: string;
  durationMin: number;
}

export interface CreateBookingBundleInput {
  packages: ScheduledPackageSelection[];
  studentName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: "woman" | "man" | "non_binary" | "another_identity" | "prefer_not_to_say";
  licenseNumber: string;
  notes: string;
}

export interface BookingStudentDetails {
  dateOfBirth: string;
  gender: string;
  licenseNumber: string;
}

export interface StripePackagePurchaseEvent {
  eventId: string;
  eventType: "paid" | "expired";
  purchaseId: string;
  sessionId: string;
  paymentIntentId?: string;
  invoiceId?: string;
  invoiceUrl?: string;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
  paidAt?: string;
}

/** Booking payload safe to return to the client (no full email). */
export interface BookingView {
  id: string;
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  /** Masked, e.g. j•••@example.com */
  emailMasked: string;
  status: BookingStatus;
}

export interface TokenRecord {
  tokenHash: string;
  bookingId: string;
  expiresAt: string;
}

export type StoreError =
  | "conflict"
  | "not_found"
  | "expired"
  | "not_modifiable"
  | "reschedule_limit";

export type OtpSendPermit =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "daily_limit"; retryAfterSeconds: number };

export interface StripeCheckoutEvent {
  eventId: string;
  eventType: "paid" | "expired";
  bookingId: string;
  sessionId: string;
  paymentIntentId?: string;
  invoiceId?: string;
  invoiceUrl?: string;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
}

export interface StripeUpgradeCheckoutEvent {
  eventId: string;
  eventType: "paid" | "expired";
  bookingId: string;
  sessionId: string;
  paymentIntentId?: string;
  invoiceId?: string;
  invoiceUrl?: string;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
  targetLessonId: string;
  targetLessonName: string;
  targetDurationMin: number;
  targetPriceCad: number;
  fromPriceCad: number;
}

export interface CreateBookingInput {
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
}

export interface CreateBookingPackageInput {
  lessonId: string;
  lessonName: string;
  durationMin: number;
  packagePriceCad: number;
  sessions: Array<{ startsAt: string; endsAt: string }>;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
}

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreError };

export interface BookingFilter {
  /** Inclusive ISO lower bound on startsAt. */
  fromIso?: string;
  /** Exclusive ISO upper bound on startsAt. */
  toIso?: string;
  status?: BookingStatus;
  /** Case-insensitive match against name, email, phone or reference. */
  search?: string;
}

/**
 * Result of an admin reschedule. `newToken` is the rotated student manage
 * token; the caller emails the fresh link to the student.
 */
export interface AdminRescheduleResult {
  booking: BookingRecord;
  newToken?: string;
}

export interface BookingStore {
  getRules(): Promise<AvailabilityRule[]>;
  getDateOverrides(fromDate?: string, toDate?: string): Promise<AvailabilityDateOverride[]>;
  setDateOverride(override: AvailabilityDateOverride): Promise<void>;
  removeDateOverride(date: string): Promise<void>;
  getBlackouts(): Promise<BlackoutDate[]>;
  getBusy(fromIso: string, toIso: string, excludeHoldTokenHash?: string): Promise<BusyInterval[]>;
  createBookingHold(
    slots: BookingSlotHold[],
    holdTokenHash: string,
    expiresAt: string,
  ): Promise<StoreResult<{ expiresAt: string }>>;
  releaseBookingHold(holdTokenHash: string): Promise<void>;
  createBooking(
    input: CreateBookingInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>>;
  createBookingPackage(
    input: CreateBookingPackageInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord[]>>;
  createBookingBundle(
    input: CreateBookingBundleInput,
    token: { hash: string; expiresAt: string },
    holdTokenHash: string,
  ): Promise<StoreResult<BookingRecord[]>>;
  /** Admin-only identity details; never attach these to public booking views. */
  getBookingStudentDetails(bookingId: string): Promise<BookingStudentDetails | null>;
  getBookingByToken(tokenHash: string): Promise<{
    booking: BookingRecord;
    sessions: BookingRecord[];
    tokenExpiresAt: string;
  } | null>;
  rescheduleBookingByToken(
    tokenHash: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>>;
  reschedulePackageSessionByToken(
    tokenHash: string,
    sessionId: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>>;
  /** Admin: list bookings (all statuses, newest first by start time). */
  listBookings(filter?: BookingFilter): Promise<BookingRecord[]>;
  /** Admin: single booking by id. */
  getBookingById(id: string): Promise<BookingRecord | null>;
  /** Admin: status transition (confirm/complete/no_show/cancel). No schedule impact. */
  updateBookingStatus(id: string, status: BookingStatus): Promise<StoreResult<BookingRecord>>;
  /** Admin: set payment status (paid/refunded/waived/due). */
  updatePaymentStatus(
    id: string,
    paymentStatus: PaymentStatus,
  ): Promise<StoreResult<BookingRecord>>;
  updateBookingCheque(id: string, status: ChequeStatus, reference?: string): Promise<StoreResult<BookingRecord>>;
  updatePackagePurchaseCheque(id: string, status: ChequeStatus, reference?: string): Promise<StoreResult<PackagePurchaseRecord>>;
  /** Admin: move a booking to a new time with atomic conflict check. */
  adminRescheduleBooking(
    id: string,
    startsAt: string,
    endsAt: string,
  ): Promise<StoreResult<AdminRescheduleResult>>;
  /** Admin: cancel without needing the student token. */
  adminCancelBooking(id: string): Promise<StoreResult<BookingRecord>>;
  /** Admin: replace the weekly availability rules wholesale. */
  setRules(rules: AvailabilityRule[]): Promise<AvailabilityRule[]>;
  addBlackout(date: string, reason?: string): Promise<BlackoutDate[]>;
  removeBlackout(date: string): Promise<BlackoutDate[]>;

  /** Catalogue: lesson packages/modules shown on the public site and wizard. */
  getLessons(): Promise<Lesson[]>;
  /** Catalogue: create-or-update a lesson by id. */
  saveLesson(lesson: Lesson): Promise<Lesson[]>;
  /** Lookup used by the "find my booking" flow (no token required). */
  findBookingsByEmail(email: string): Promise<BookingRecord[]>;
  /** Rotates and returns a fresh manage token for a booking (post-verification). */
  issueManageToken(bookingId: string): Promise<string | null>;

  /**
   * Email verification codes for the self-service finder.
   * Only the code hash is stored; creating a code resets the attempt counter.
   */
  putOtp(email: string, codeHash: string, expiresAt: string): Promise<void>;
  /** Checks the code; mismatches increment attempts until OTP_MAX_ATTEMPTS locks it. */
  verifyOtp(
    email: string,
    codeHash: string,
    consume?: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: "mismatch" | "expired" | "locked" }>;
  /** Consumes the code after a manage token has been issued. */
  deleteOtp(email: string): Promise<void>;
  /** Atomically allows at most 3 sends/email/day and enforces a 2-minute cooldown. */
  consumeOtpSendQuota(email: string, nowIso: string): Promise<OtpSendPermit>;
  setStripeCheckoutSession(
    bookingId: string,
    sessionId: string,
    expiresAt: string,
    expectedStartsAt: string,
    addOnPackages?: PackageQuantitySelection[],
  ): Promise<void>;
  getBookingCheckoutAddons(bookingId: string, sessionId: string): Promise<PackagePurchaseRecord[]>;
  setStripeUpgradeCheckoutSession(
    bookingId: string,
    sessionId: string,
    targetLesson: Pick<Lesson, "id" | "name" | "durationMin" | "priceCad" | "sessionCount">,
    fromPriceCad: number,
    amountCad: number,
    expectedStartsAt: string,
    sessions: Array<{ startsAt: string; endsAt: string }>,
  ): Promise<void>;
  getBookingByCheckoutSession(sessionId: string): Promise<BookingRecord | null>;
  getBookingByUpgradeCheckoutSession(sessionId: string): Promise<BookingRecord | null>;
  handleStripeCheckoutEvent(event: StripeCheckoutEvent): Promise<void>;
  handleStripeUpgradeCheckoutEvent(event: StripeUpgradeCheckoutEvent): Promise<void>;
  createPackagePurchase(input: CreatePackagePurchaseInput): Promise<PackagePurchaseRecord>;
  createScheduledPackagePurchase(
    input: CreatePackagePurchaseInput & { id: string },
    packageQuantity: number,
    startsAt: string[],
    manageTokenHash: string,
    checkoutSessionId: string,
    checkoutExpiresAt: string,
  ): Promise<StoreResult<PackagePurchaseRecord>>;
  setStripePackagePurchaseCheckout(purchaseId: string, sessionId: string, expiresAt: string): Promise<void>;
  getPackagePurchaseByCheckoutSession(sessionId: string): Promise<PackagePurchaseRecord | null>;
  findPackagePurchasesByEmail(email: string): Promise<PackagePurchaseRecord[]>;
  /** Admin: recent purchase snapshots with ledger-derived credit balances. */
  listPackagePurchases(limit?: number): Promise<PackagePurchaseRecord[]>;
  listPackageCreditEvents(purchaseIds: string[]): Promise<PackageCreditEventRecord[]>;
  getPackagePurchaseByToken(tokenHash: string): Promise<PackagePurchaseRecord | null>;
  getPackagePurchaseById(purchaseId: string): Promise<PackagePurchaseRecord | null>;
  findBookingsByPurchaseId(purchaseId: string): Promise<BookingRecord[]>;
  issuePackagePurchaseManageToken(purchaseId: string): Promise<string | null>;
  handleStripePackagePurchaseEvent(event: StripePackagePurchaseEvent): Promise<void>;
  schedulePackageCredit(
    purchaseId: string,
    startsAt: string,
    token: { currentHash: string; hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>>;
}
