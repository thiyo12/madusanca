import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, occupiedDurationMin } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { lessons as defaultLessons, type Lesson } from "@/lib/data/lessons";
import { customerCanAccessBooking } from "@/lib/booking/customer-access";
import type {
  AdminRescheduleResult,
  AvailabilityDateOverride,
  AvailabilityRule,
  BlackoutDate,
  BookingFilter,
  BookingRecord,
  BookingStudentDetails,
  ChequeStatus,
  BookingStore,
  BookingStatus,
  BookingSlotHold,
  BusyInterval,
  CreateBookingInput,
  CreateBookingBundleInput,
  CreateBookingPackageInput,
  CreatePackagePurchaseInput,
  OtpSendPermit,
  PackagePurchaseRecord,
  PackageCreditEventRecord,
  PaymentStatus,
  PackageQuantitySelection,
  StripePackagePurchaseEvent,
  StripeCheckoutEvent,
  StripeUpgradeCheckoutEvent,
  StoreResult,
} from "@/lib/booking/types";

let client: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Booking storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.",
    );
  }
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

interface BookingRow {
  id: string;
  reference: string;
  lesson_id: string;
  lesson_name: string;
  duration_min: number;
  price_cad: number;
  starts_at: string;
  ends_at: string;
  student_name: string;
  email: string;
  phone: string;
  notes: string;
  status: BookingStatus;
  payment_status?: BookingRecord["paymentStatus"];
  cheque_status?: ChequeStatus;
  cheque_reference?: string | null;
  cheque_received_at?: string | null;
  student_reschedule_count?: number;
  stripe_checkout_session_id?: string | null;
  stripe_checkout_attempt?: number;
  stripe_checkout_expires_at?: string | null;
  stripe_upgrade_checkout_session_id?: string | null;
  stripe_upgrade_attempt?: number;
  stripe_upgrade_from_price_cad?: number | null;
  stripe_upgrade_target_lesson_id?: string | null;
  stripe_upgrade_target_lesson_name?: string | null;
  stripe_upgrade_target_duration_min?: number | null;
  stripe_upgrade_target_price_cad?: number | null;
  stripe_upgrade_amount_cad?: number | null;
  stripe_upgrade_target_sessions?: Array<{ startsAt: string; endsAt: string }> | null;
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_invoice_url?: string | null;
  stripe_subtotal_cad?: number | null;
  stripe_tax_cad?: number | null;
  stripe_total_cad?: number | null;
  stripe_currency?: string | null;
  created_at: string;
  updated_at: string;
  package_id?: string;
  session_index?: number;
  session_count?: number;
  package_price_cad?: number;
  package_window_start?: string;
  purchase_id?: string | null;
}

export function toRecord(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    reference: row.reference,
    lessonId: row.lesson_id,
    lessonName: row.lesson_name,
    durationMin: row.duration_min,
    priceCad: row.price_cad,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    studentName: row.student_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    paymentStatus: row.payment_status ?? "due",
    chequeStatus: row.cheque_status ?? "none",
    chequeReference: row.cheque_reference ?? undefined,
    chequeReceivedAt: row.cheque_received_at ?? undefined,
    studentRescheduleCount: row.student_reschedule_count ?? 0,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined,
    stripeCheckoutAttempt: row.stripe_checkout_attempt ?? 0,
    stripeCheckoutExpiresAt: row.stripe_checkout_expires_at ?? undefined,
    stripeUpgradeCheckoutSessionId: row.stripe_upgrade_checkout_session_id ?? undefined,
    stripeUpgradeAttempt: row.stripe_upgrade_attempt ?? 0,
    stripeUpgradeFromPriceCad: row.stripe_upgrade_from_price_cad == null ? undefined : Number(row.stripe_upgrade_from_price_cad),
    stripeUpgradeTargetLessonId: row.stripe_upgrade_target_lesson_id ?? undefined,
    stripeUpgradeTargetLessonName: row.stripe_upgrade_target_lesson_name ?? undefined,
    stripeUpgradeTargetDurationMin: row.stripe_upgrade_target_duration_min ?? undefined,
    stripeUpgradeTargetPriceCad: row.stripe_upgrade_target_price_cad == null ? undefined : Number(row.stripe_upgrade_target_price_cad),
    stripeUpgradeAmountCad: row.stripe_upgrade_amount_cad == null ? undefined : Number(row.stripe_upgrade_amount_cad),
    stripeUpgradeTargetSessions: row.stripe_upgrade_target_sessions ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    stripeInvoiceId: row.stripe_invoice_id ?? undefined,
    stripeInvoiceUrl: row.stripe_invoice_url ?? undefined,
    stripeSubtotalCad: row.stripe_subtotal_cad == null ? undefined : Number(row.stripe_subtotal_cad),
    stripeTaxCad: row.stripe_tax_cad == null ? undefined : Number(row.stripe_tax_cad),
    stripeTotalCad: row.stripe_total_cad == null ? undefined : Number(row.stripe_total_cad),
    stripeCurrency: row.stripe_currency ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    packageId: row.package_id ?? row.id,
    sessionIndex: row.session_index ?? 1,
    sessionCount: row.session_count ?? 1,
    packagePriceCad: row.package_price_cad == null ? Number(row.price_cad) : Number(row.package_price_cad),
    packageWindowStart: row.package_window_start,
    purchaseId: row.purchase_id ?? undefined,
  };
}

interface PackagePurchaseRow {
  id: string;
  reference: string;
  student_name: string;
  email: string;
  phone: string;
  notes: string;
  lesson_id: string;
  lesson_name: string;
  duration_min: number;
  credits_purchased: number;
  amount_cad: number;
  currency: "cad";
  payment_status: PackagePurchaseRecord["paymentStatus"];
  cheque_status?: ChequeStatus;
  cheque_reference?: string | null;
  cheque_received_at?: string | null;
  purchased_at: string | null;
  valid_until: string | null;
  stripe_checkout_session_id: string | null;
  stripe_checkout_expires_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  stripe_subtotal_cad: number | null;
  stripe_tax_cad: number | null;
  stripe_total_cad: number | null;
  source: PackagePurchaseRecord["source"];
  created_at: string;
  updated_at: string;
}

function toPackagePurchase(row: PackagePurchaseRow, creditsAvailable = 0): PackagePurchaseRecord {
  return {
    id: row.id,
    reference: row.reference,
    studentName: row.student_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    lessonId: row.lesson_id,
    lessonName: row.lesson_name,
    durationMin: row.duration_min,
    creditsPurchased: row.credits_purchased,
    amountCad: Number(row.amount_cad),
    currency: "cad",
    paymentStatus: row.payment_status,
    chequeStatus: row.cheque_status ?? "none",
    chequeReference: row.cheque_reference ?? undefined,
    chequeReceivedAt: row.cheque_received_at ?? undefined,
    purchasedAt: row.purchased_at ?? undefined,
    validUntil: row.valid_until ?? undefined,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined,
    stripeCheckoutExpiresAt: row.stripe_checkout_expires_at ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    stripeInvoiceId: row.stripe_invoice_id ?? undefined,
    stripeInvoiceUrl: row.stripe_invoice_url ?? undefined,
    stripeSubtotalCad: row.stripe_subtotal_cad == null ? undefined : Number(row.stripe_subtotal_cad),
    stripeTaxCad: row.stripe_tax_cad == null ? undefined : Number(row.stripe_tax_cad),
    stripeTotalCad: row.stripe_total_cad == null ? undefined : Number(row.stripe_total_cad),
    source: row.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    creditsAvailable,
  };
}

type RpcEnvelope<T> = { ok: true; record?: T } | { ok: false; error: string };

export const supabaseStore: BookingStore = {
  async getRules(): Promise<AvailabilityRule[]> {
    const { data, error } = await adminClient()
      .from("availability_rules")
      .select("weekday, start_min, end_min");
    if (error) throw new Error(`Failed to load availability rules: ${error.message}`);
    const rules: AvailabilityRule[] = (data ?? []).map((row) => ({
      weekday: row.weekday,
      startMin: row.start_min,
      endMin: row.end_min,
    }));
    return rules.length > 0 ? rules : DEFAULT_RULES;
  },

  async getDateOverrides(fromDate?: string, toDate?: string): Promise<AvailabilityDateOverride[]> {
    let query = adminClient().from("availability_date_overrides").select("date, start_min, end_min").order("date");
    if (fromDate) query = query.gte("date", fromDate);
    if (toDate) query = query.lte("date", toDate);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load date-specific availability: ${error.message}`);
    return (data ?? []).map((row) => ({
      date: typeof row.date === "string" ? row.date : String(row.date).slice(0, 10),
      startMin: row.start_min,
      endMin: row.end_min,
    }));
  },

  async getBlackouts(): Promise<BlackoutDate[]> {
    const { data, error } = await adminClient()
      .from("blackout_dates")
      .select("date, reason")
      .order("date");
    if (error) throw new Error(`Failed to load blackout dates: ${error.message}`);
    return (data ?? []).map((row) => ({
      date: typeof row.date === "string" ? row.date : String(row.date).slice(0, 10),
      reason: row.reason ?? undefined,
    }));
  },

  async getBusy(fromIso: string, toIso: string, excludeHoldTokenHash?: string): Promise<BusyInterval[]> {
    const [bookings, upgrades, holds] = await Promise.all([adminClient()
      .from("bookings")
      .select("starts_at, duration_min")
      .or(`status.in.(confirmed,rescheduled),and(status.eq.pending_payment,stripe_checkout_expires_at.gt.${new Date().toISOString()})`)
      .lt("starts_at", toIso)
      .gt("starts_at", new Date(Date.parse(fromIso) - 600 * 60_000).toISOString()), adminClient().from("bookings").select("stripe_upgrade_target_sessions, stripe_upgrade_target_duration_min").not("stripe_upgrade_checkout_session_id", "is", null), adminClient().from("booking_slot_holds").select("hold_token_hash, starts_at, duration_min").lt("starts_at", toIso).gt("starts_at", new Date(Date.parse(fromIso) - 600 * 60_000).toISOString()).gt("expires_at", new Date().toISOString())]);
    if (bookings.error || upgrades.error || holds.error) throw new Error(`Failed to load booking availability: ${bookings.error?.message ?? upgrades.error?.message ?? holds.error?.message}`);
    const intervals = (bookings.data ?? []).flatMap((row) => {
      const startsAt = new Date(row.starts_at).toISOString();
      const endsAt = new Date(Date.parse(startsAt) + occupiedDurationMin(row.duration_min) * 60_000).toISOString();
      return new Date(endsAt) > new Date(fromIso) ? [{ startsAt, endsAt }] : [];
    }).concat((upgrades.data ?? []).flatMap((row) => ((row.stripe_upgrade_target_sessions ?? []) as Array<{ startsAt: string; endsAt: string }>).map((item) => ({
      startsAt: item.startsAt,
      endsAt: new Date(Date.parse(item.startsAt) + occupiedDurationMin(row.stripe_upgrade_target_duration_min ?? 600) * 60_000).toISOString(),
    }))).concat((holds.data ?? []).filter((row) => row.hold_token_hash !== excludeHoldTokenHash).map((row) => ({
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(Date.parse(row.starts_at) + occupiedDurationMin(row.duration_min) * 60_000).toISOString(),
    })))
      .filter((item) => new Date(item.startsAt) < new Date(toIso) && new Date(item.endsAt) > new Date(fromIso)));
    return intervals;
  },

  async createBookingHold(slots: BookingSlotHold[], holdTokenHash: string, expiresAt: string) {
    const { data, error } = await adminClient().rpc("hold_booking_slots", {
      p_token_hash: holdTokenHash,
      p_slots: slots,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(`Failed to hold booking slots: ${error.message}`);
    const result = data as { ok: boolean; error?: string; expiresAt?: string };
    if (!result.ok || !result.expiresAt) return { ok: false as const, error: result.error === "conflict" ? "conflict" as const : "not_found" as const };
    return { ok: true as const, value: { expiresAt: result.expiresAt } };
  },

  async releaseBookingHold(holdTokenHash: string) {
    const { error } = await adminClient().rpc("release_booking_slots", { p_token_hash: holdTokenHash });
    if (error) throw new Error(`Failed to release booking hold: ${error.message}`);
  },

  async createBooking(
    input: CreateBookingInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    const { data, error } = await adminClient().rpc("create_booking", {
      p_token_hash: token.hash,
      p_token_expires_at: token.expiresAt,
      p_lesson_id: input.lessonId,
      p_lesson_name: input.lessonName,
      p_duration_min: input.durationMin,
      p_price_cad: input.priceCad,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_student_name: input.studentName,
      p_email: input.email,
      p_phone: input.phone,
      p_notes: input.notes,
    });
    if (error) throw new Error(`Failed to create booking: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) {
      return { ok: false, error: envelope.error === "conflict" ? "conflict" : "not_found" };
    }
    if (!envelope.record) return { ok: false, error: "not_found" };
    const { error: statusError } = await adminClient()
      .from("bookings")
      .update({ status: "pending_payment" })
      .eq("id", envelope.record.id);
    if (statusError) throw new Error(`Failed to mark booking as awaiting payment: ${statusError.message}`);
    return { ok: true, value: { ...toRecord(envelope.record), status: "pending_payment" } };
  },

  async createAdminBooking(
    input: CreateBookingInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    const { data, error } = await adminClient().rpc("admin_create_calendar_booking", {
      p_token_hash: token.hash,
      p_token_expires_at: token.expiresAt,
      p_lesson_id: input.lessonId,
      p_starts_at: input.startsAt,
      p_student_name: input.studentName,
      p_email: input.email,
      p_phone: input.phone,
      p_notes: input.notes,
    });
    if (error) throw new Error(`Failed to create admin booking: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: envelope.error === "conflict" ? "conflict" : "not_found" };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toRecord(envelope.record) };
  },

  async createBookingPackage(
    input: CreateBookingPackageInput,
    token: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord[]>> {
    const { data, error } = await adminClient().rpc("create_booking_package", {
      p_token_hash: token.hash,
      p_token_expires_at: token.expiresAt,
      p_lesson_id: input.lessonId,
      p_lesson_name: input.lessonName,
      p_duration_min: input.durationMin,
      p_package_price_cad: input.packagePriceCad,
      p_starts_at: input.sessions.map((session) => session.startsAt),
      p_student_name: input.studentName,
      p_email: input.email,
      p_phone: input.phone,
      p_notes: input.notes,
    });
    if (error) throw new Error(`Failed to create booking package: ${error.message}`);
    const envelope = data as { ok: true; records?: BookingRow[] } | { ok: false; error: string };
    if (!envelope.ok) return { ok: false, error: envelope.error === "conflict" ? "conflict" : "not_found" };
    if (!envelope.records?.length) return { ok: false, error: "not_found" };
    return { ok: true, value: envelope.records.map(toRecord) };
  },

  async createBookingBundle(
    input: CreateBookingBundleInput,
    token: { hash: string; expiresAt: string },
    holdTokenHash: string,
  ): Promise<StoreResult<BookingRecord[]>> {
    const { data, error } = await adminClient().rpc("create_booking_bundle_with_student_details", {
      p_token_hash: token.hash,
      p_token_expires_at: token.expiresAt,
      p_packages: input.packages,
      p_student_name: input.studentName,
      p_email: input.email,
      p_phone: input.phone,
      p_notes: input.notes,
      p_date_of_birth: input.dateOfBirth,
      p_gender: input.gender,
      p_license_number: input.licenseNumber,
      p_hold_token_hash: holdTokenHash,
    });
    if (error) throw new Error(`Failed to create booking bundle: ${error.message}`);
    const envelope = data as { ok: true; records?: BookingRow[] } | { ok: false; error: string };
    if (!envelope.ok) return { ok: false, error: envelope.error === "conflict" ? "conflict" : "not_found" };
    if (!envelope.records?.length) return { ok: false, error: "not_found" };
    return { ok: true, value: envelope.records.map(toRecord) };
  },

  async getBookingStudentDetails(bookingId: string): Promise<BookingStudentDetails | null> {
    const { data, error } = await adminClient()
      .from("booking_student_details")
      .select("date_of_birth,gender,license_number")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load student details: ${error.message}`);
    if (!data) return null;
    return {
      dateOfBirth: data.date_of_birth,
      gender: data.gender,
      licenseNumber: data.license_number,
    };
  },

  async getBookingByToken(tokenHash: string) {
    const { data, error } = await adminClient()
      .from("booking_tokens")
      .select("expires_at, bookings(*)")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw new Error(`Failed to load booking token: ${error.message}`);
    if (!data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    const rows = data.bookings as BookingRow[] | BookingRow | null;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    const packageId = row.package_id ?? row.id;
    const { data: packageRows, error: packageError } = await adminClient()
      .from("bookings")
      .select("*")
      .eq("package_id", packageId)
      .order("session_index", { ascending: true });
    if (packageError) throw new Error(`Failed to load booking sessions: ${packageError.message}`);
    const sessions = (packageRows ?? [row]).map(toRecord);
    if (!sessions.some((session) => customerCanAccessBooking(session.status))) return null;
    return {
      booking: sessions.find((session) => session.sessionIndex === 1) ?? toRecord(row),
      sessions,
      tokenExpiresAt: new Date(data.expires_at).toISOString(),
    };
  },

  async rescheduleBookingByToken(
    tokenHash: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    const { data, error } = await adminClient().rpc("reschedule_student_booking_by_token", {
      p_token_hash: tokenHash,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_new_token_hash: newToken.hash,
      p_new_token_expires_at: newToken.expiresAt,
    });
    if (error) throw new Error(`Failed to reschedule booking: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error ?? "conflict") };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toRecord(envelope.record) };
  },

  async reschedulePackageSessionByToken(
    tokenHash: string,
    sessionId: string,
    startsAt: string,
    endsAt: string,
    newToken: { hash: string; expiresAt: string },
  ): Promise<StoreResult<BookingRecord>> {
    const { data, error } = await adminClient().rpc("reschedule_package_session_by_token", {
      p_token_hash: tokenHash,
      p_session_id: sessionId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_new_token_hash: newToken.hash,
      p_new_token_expires_at: newToken.expiresAt,
    });
    if (error) throw new Error(`Failed to reschedule package session: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error) };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toRecord(envelope.record) };
  },

  async listBookings(filter: BookingFilter = {}): Promise<BookingRecord[]> {
    let query = adminClient().from("bookings").select("*");
    if (filter.fromIso) query = query.gte("starts_at", filter.fromIso);
    if (filter.toIso) query = query.lt("starts_at", filter.toIso);
    if (filter.status) query = query.eq("status", filter.status);
    const needle = filter.search?.replace(/[,()']/g, "").trim();
    if (needle) {
      query = query.or(
        `student_name.ilike.%${needle}%,email.ilike.%${needle}%,phone.ilike.%${needle}%,reference.ilike.%${needle}%`,
      );
    }
    const { data, error } = await query.order("starts_at", { ascending: true });
    if (error) throw new Error(`Failed to list bookings: ${error.message}`);
    return (data ?? []).map(toRecord);
  },

  async countBookings(): Promise<number> {
    const { count, error } = await adminClient().from("bookings").select("id", { count: "exact", head: true });
    if (error) throw new Error(`Failed to count bookings: ${error.message}`);
    return count ?? 0;
  },

  async getBookingById(id: string): Promise<BookingRecord | null> {
    const { data, error } = await adminClient()
      .from("bookings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load booking: ${error.message}`);
    return data ? toRecord(data) : null;
  },

  async updateBookingStatus(id: string, status: BookingStatus): Promise<StoreResult<BookingRecord>> {
    if (status === "completed") {
      const { data, error } = await adminClient().rpc("complete_booking_session", { p_booking_id: id });
      if (error) throw new Error(`Failed to complete booking session: ${error.message}`);
      const envelope = data as RpcEnvelope<BookingRow>;
      if (!envelope.ok) return { ok: false, error: envelope.error === "report_required" ? "report_required" : envelope.error === "not_modifiable" ? "not_modifiable" : "not_found" };
      if (!envelope.record) return { ok: false, error: "not_found" };
      return { ok: true, value: toRecord(envelope.record) };
    }
    if (status === "cancelled") {
      const { data, error } = await adminClient().rpc("admin_cancel_booking_package", { p_booking_id: id });
      if (error) throw new Error(`Failed to cancel booking package: ${error.message}`);
      const envelope = data as RpcEnvelope<BookingRow>;
      if (!envelope.ok || !envelope.record) return { ok: false, error: "not_found" };
      return { ok: true, value: toRecord(envelope.record) };
    }
    if (status === "no_show") {
      const existing = await adminClient().from("bookings").select("status").eq("id", id).maybeSingle();
      if (existing.error) throw new Error(`Failed to load booking: ${existing.error.message}`);
      if (!existing.data) return { ok: false, error: "not_found" };
      if (["cancelled", "completed", "no_show"].includes(existing.data.status)) return { ok: false, error: "not_modifiable" };
      const { data, error } = await adminClient().from("bookings").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
      if (error) throw new Error(`Failed to mark booking no-show: ${error.message}`);
      return data ? { ok: true, value: toRecord(data) } : { ok: false, error: "not_found" };
    }
    const existing = await adminClient().from("bookings").select("status, package_id").eq("id", id).maybeSingle();
    if (existing.error) throw new Error(`Failed to load booking: ${existing.error.message}`);
    if (!existing.data) return { ok: false, error: "not_found" };
    if (["cancelled", "completed"].includes(existing.data.status)) {
      return { ok: false, error: "not_modifiable" };
    }

    const { data, error } = await adminClient()
      .from("bookings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("package_id", existing.data.package_id ?? id)
      .select();
    if (error) throw new Error(`Failed to update booking status: ${error.message}`);
    const row = (data ?? []).find((item) => item.id === id);
    return row ? { ok: true, value: toRecord(row) } : { ok: false, error: "not_found" };
  },

  async updatePaymentStatus(
    id: string,
    paymentStatus: PaymentStatus,
  ): Promise<StoreResult<BookingRecord>> {
    if (paymentStatus === "paid") {
      const { data, error } = await adminClient().rpc("mark_booking_paid_by_cash", { p_booking_id: id });
      if (error) throw new Error(`Failed to mark booking paid by cash: ${error.message}`);
      if (data !== true) return { ok: false, error: "conflict" };
      const { data: updated, error: loadError } = await adminClient().from("bookings").select("*").eq("id", id).maybeSingle();
      if (loadError) throw new Error(`Failed to reload cash-paid booking: ${loadError.message}`);
      return updated ? { ok: true, value: toRecord(updated as BookingRow) } : { ok: false, error: "not_found" };
    }
    const existing = await adminClient().from("bookings").select("id, package_id").eq("id", id).maybeSingle();
    if (existing.error) throw new Error(`Failed to load booking: ${existing.error.message}`);
    if (!existing.data) return { ok: false, error: "not_found" };

    const { data, error } = await adminClient()
      .from("bookings")
      .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq("package_id", existing.data.package_id ?? existing.data.id)
      .select();
    if (error) throw new Error(`Failed to update payment status: ${error.message}`);
    const row = (data ?? []).find((item) => item.id === id);
    return row ? { ok: true, value: toRecord(row) } : { ok: false, error: "not_found" };
  },

  async updateBookingCheque(id: string, status: ChequeStatus, reference?: string): Promise<StoreResult<BookingRecord>> {
    const existing = await adminClient().from("bookings").select("id, package_id").eq("id", id).maybeSingle();
    if (existing.error) throw new Error(`Failed to load booking: ${existing.error.message}`);
    if (!existing.data) return { ok: false, error: "not_found" };
    const now = new Date().toISOString();
    const { data, error } = await adminClient().from("bookings").update({
      cheque_status: status,
      cheque_reference: status === "none" ? null : reference?.trim() || null,
      cheque_received_at: status === "received" || status === "cleared" ? now : null,
      ...(status === "cleared" ? { payment_status: "paid" } : status === "returned" ? { payment_status: "due" } : {}),
      updated_at: now,
    }).eq("package_id", existing.data.package_id ?? existing.data.id).select();
    if (error) throw new Error(`Failed to update cheque: ${error.message}`);
    const row = (data ?? []).find((item) => item.id === id);
    return row ? { ok: true, value: toRecord(row) } : { ok: false, error: "not_found" };
  },

  async updatePackagePurchaseCheque(id: string, status: ChequeStatus, reference?: string): Promise<StoreResult<PackagePurchaseRecord>> {
    const { data: purchaseId, error } = await adminClient().rpc("record_package_cheque", {
      p_purchase_id: id,
      p_status: status,
      p_reference: reference ?? null,
    });
    if (error) throw new Error(`Failed to update package cheque: ${error.message}`);
    if (!purchaseId) return { ok: false, error: "not_found" };
    const { data, error: loadError } = await adminClient().from("package_purchases").select("*").eq("id", id).single();
    if (loadError || !data) throw new Error(`Failed to reload package purchase: ${loadError?.message ?? "not found"}`);
    const { data: events, error: eventsError } = await adminClient().from("package_credit_events").select("quantity_delta").eq("purchase_id", id);
    if (eventsError) throw new Error(`Failed to load package credit balance: ${eventsError.message}`);
    return { ok: true, value: toPackagePurchase(data as PackagePurchaseRow, (events ?? []).reduce((sum, event) => sum + event.quantity_delta, 0)) };
  },

  async adminRescheduleBooking(
    id: string,
    startsAt: string,
    endsAt: string,
  ): Promise<StoreResult<AdminRescheduleResult>> {
    const token = generateToken();
    const newToken = { hash: hashToken(token), expiresAt: tokenExpiry() };
    const { data, error } = await adminClient().rpc("admin_reschedule_package_session", {
      p_booking_id: id,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_new_token_hash: newToken.hash,
      p_new_token_expires_at: newToken.expiresAt,
    });
    if (error) throw new Error(`Failed to reschedule booking package: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error) };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: { booking: toRecord(envelope.record), newToken: token } };
  },

  async adminCancelBooking(id: string): Promise<StoreResult<BookingRecord>> {
    const { data, error } = await adminClient().rpc("admin_cancel_booking_package", { p_booking_id: id });
    if (error) throw new Error(`Failed to cancel booking package: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error) };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toRecord(envelope.record) };
  },

  async setRules(rules: AvailabilityRule[]): Promise<AvailabilityRule[]> {
    const keep = rules.map((r) => r.weekday);
    const db = adminClient();
    if (keep.length > 0) {
      const removed = await db
        .from("availability_rules")
        .delete()
        .not("weekday", "in", `(${keep.join(",")})`);
      if (removed.error) throw new Error(`Failed to clear rules: ${removed.error.message}`);
    }
    const upserted = await db
      .from("availability_rules")
      .upsert(
        rules.map((r) => ({ weekday: r.weekday, start_min: r.startMin, end_min: r.endMin })),
        { onConflict: "weekday" },
      );
    if (upserted.error) throw new Error(`Failed to save rules: ${upserted.error.message}`);
    return rules;
  },

  async setDateOverride(override: AvailabilityDateOverride): Promise<void> {
    const { error } = await adminClient().rpc("set_availability_date_override", {
      p_date: override.date,
      p_start_min: override.startMin,
      p_end_min: override.endMin,
    });
    if (error) throw new Error(`Failed to save date-specific availability: ${error.message}`);
  },

  async removeDateOverride(date: string): Promise<void> {
    const { error } = await adminClient().rpc("remove_availability_date_override", { p_date: date });
    if (error) throw new Error(`Failed to remove date-specific availability: ${error.message}`);
  },

  async addBlackout(date: string, reason?: string): Promise<BlackoutDate[]> {
    const { error } = await adminClient()
      .from("blackout_dates")
      .upsert({ date, reason: reason || null }, { onConflict: "date" });
    if (error) throw new Error(`Failed to add blackout: ${error.message}`);
    return this.getBlackouts();
  },

  async removeBlackout(date: string): Promise<BlackoutDate[]> {
    const { error } = await adminClient().from("blackout_dates").delete().eq("date", date);
    if (error) throw new Error(`Failed to remove blackout: ${error.message}`);
    return this.getBlackouts();
  },

  async getLessons(): Promise<Lesson[]> {
    const { data, error } = await adminClient()
      .from("lessons")
      .select("*")
      .order("category", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      // Migration 0002 not applied yet — fall back to the code catalogue.
      console.error(`Lessons table unavailable (${error.code ?? "error"}), using defaults.`);
      return structuredClone(defaultLessons);
    }
    return (data ?? []).map(toLesson);
  },

  async saveLesson(lesson: Lesson): Promise<Lesson[]> {
    const { error } = await adminClient().from("lessons").upsert(
      {
        id: lesson.id,
        name: lesson.name,
        duration_min: lesson.durationMin,
        session_count: lesson.sessionCount,
        price_cad: lesson.priceCad,
        description: lesson.description,
        features: lesson.features,
        icon: lesson.icon,
        popular: lesson.popular ?? false,
        category: lesson.category,
      },
      { onConflict: "id" },
    );
    if (error) {
      if (error.code === "42P01" || error.message.includes("relation") || error.message.includes("schema cache")) {
        throw new Error(
          "The lessons table does not exist yet. Run migration supabase/migrations/0002_lessons.sql in the Supabase SQL editor first.",
        );
      }
      throw new Error(`Failed to save lesson: ${error.message}`);
    }
    return this.getLessons();
  },

  async findBookingsByEmail(email: string): Promise<BookingRecord[]> {
    const needle = email.trim();
    const { data, error } = await adminClient()
      .from("bookings")
      .select("*")
      .ilike("email", needle)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to find bookings: ${error.message}`);
    return (data ?? []).map(toRecord).filter((booking) => customerCanAccessBooking(booking.status));
  },

  async issueManageToken(bookingId: string): Promise<string | null> {
    const found = await adminClient().from("bookings").select("id, status, package_id").eq("id", bookingId).maybeSingle();
    if (found.error) throw new Error(`Failed to load booking: ${found.error.message}`);
    if (!found.data || !customerCanAccessBooking(found.data.status)) return null;
    const anchorResult = await adminClient().from("bookings").select("id")
      .eq("package_id", found.data.package_id ?? found.data.id).eq("session_index", 1).maybeSingle();
    if (anchorResult.error) throw new Error(`Failed to load booking package: ${anchorResult.error.message}`);
    const anchorId = anchorResult.data?.id ?? found.data.id;

    const raw = generateToken();
    const hash = hashToken(raw);
    const sessionRows = await adminClient().from("bookings").select("id").eq("package_id", found.data.package_id ?? found.data.id);
    if (sessionRows.error) throw new Error(`Failed to load booking package: ${sessionRows.error.message}`);
    const bookingIds = (sessionRows.data ?? []).map((row) => row.id);
    const deleted = await adminClient().from("booking_tokens").delete().in("booking_id", bookingIds);
    if (deleted.error) throw new Error(`Failed to rotate token: ${deleted.error.message}`);
    const inserted = await adminClient()
      .from("booking_tokens")
      .insert({ token_hash: hash, booking_id: anchorId, expires_at: tokenExpiry() });
    if (inserted.error) throw new Error(`Failed to mint token: ${inserted.error.message}`);
    return raw;
  },

  async putOtp(email: string, codeHash: string, expiresAt: string): Promise<void> {
    const { error } = await adminClient()
      .from("booking_otps")
      .upsert(
        { email: email.trim().toLowerCase(), code_hash: codeHash, expires_at: expiresAt, attempts: 0 },
        { onConflict: "email" },
      );
    if (error) {
      if (error.code === "42P01" || error.message.includes("relation")) {
        throw new Error(
          "The booking_otps table does not exist yet. Run migration supabase/migrations/0003_booking_otps.sql first.",
        );
      }
      throw new Error(`Failed to store verification code: ${error.message}`);
    }
  },

  async verifyOtp(
    email: string,
    codeHash: string,
    consume = false,
  ): Promise<{ ok: true } | { ok: false; reason: "mismatch" | "expired" | "locked" }> {
    const { data, error } = await adminClient().rpc("verify_booking_otp", {
      p_email: email.trim().toLowerCase(),
      p_code_hash: codeHash,
      p_consume: consume,
    });
    if (error) throw new Error(`Failed to check verification code: ${error.message}`);
    if (data === "ok") return { ok: true };
    if (data === "mismatch" || data === "expired" || data === "locked") return { ok: false, reason: data };
    throw new Error("OTP verification returned an invalid result.");
  },

  async deleteOtp(email: string): Promise<void> {
    const { error } = await adminClient()
      .from("booking_otps")
      .delete()
      .eq("email", email.trim().toLowerCase());
    if (error) throw new Error(`Failed to clear verification code: ${error.message}`);
  },

  async consumeOtpSendQuota(email: string, nowIso: string): Promise<OtpSendPermit> {
    const { data, error } = await adminClient().rpc("consume_booking_otp_send_quota", {
      p_email: email.trim().toLowerCase(),
      p_now: nowIso,
    });
    if (error) throw new Error(`Failed to check code-send limit: ${error.message}`);
    const result = data as {
      allowed?: boolean;
      reason?: "cooldown" | "daily_limit";
      retry_after_seconds?: number;
    };
    if (result.allowed) return { allowed: true };
    return {
      allowed: false,
      reason: result.reason === "daily_limit" ? "daily_limit" : "cooldown",
      retryAfterSeconds: Math.max(1, result.retry_after_seconds ?? 1),
    };
  },

  async setStripeCheckoutSession(
    bookingId: string,
    sessionId: string,
    expiresAt: string,
    expectedStartsAt: string,
    addOnPackages: PackageQuantitySelection[] = [],
  ): Promise<void> {
    const { data, error } = await adminClient().rpc("set_booking_checkout_session_with_addons", {
      p_booking_id: bookingId,
      p_session_id: sessionId,
      p_expires_at: expiresAt,
      p_expected_starts_at: expectedStartsAt,
      p_addon_packages: addOnPackages,
    });
    if (error) throw new Error(`Failed to save Checkout Session: ${error.message}`);
    if (data !== true) throw new Error("Booking is no longer eligible for Checkout or the selected add-ons changed.");
  },

  async getBookingCheckoutAddons(bookingId: string, sessionId: string): Promise<PackagePurchaseRecord[]> {
    const { data: attempt, error: attemptError } = await adminClient().from("booking_checkout_addon_attempts")
      .select("id").eq("booking_id", bookingId).eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (attemptError) throw new Error(`Failed to load booking add-on payment: ${attemptError.message}`);
    if (!attempt) return [];
    const { data: items, error: itemsError } = await adminClient().from("booking_checkout_addon_items")
      .select("purchase_id").eq("attempt_id", attempt.id);
    if (itemsError) throw new Error(`Failed to load booking add-on items: ${itemsError.message}`);
    const ids = (items ?? []).map((item) => item.purchase_id);
    if (!ids.length) return [];
    const { data: purchases, error: purchaseError } = await adminClient().from("package_purchases")
      .select("*").in("id", ids);
    if (purchaseError) throw new Error(`Failed to load add-on purchase records: ${purchaseError.message}`);
    const { data: events, error: eventError } = await adminClient().from("package_credit_events")
      .select("purchase_id, quantity_delta").in("purchase_id", ids);
    if (eventError) throw new Error(`Failed to load add-on credit balances: ${eventError.message}`);
    const balances = new Map<string, number>();
    for (const event of events ?? []) balances.set(event.purchase_id, (balances.get(event.purchase_id) ?? 0) + event.quantity_delta);
    return ((purchases ?? []) as PackagePurchaseRow[]).map((row) => toPackagePurchase(row, balances.get(row.id) ?? 0));
  },

  async getBookingByCheckoutSession(sessionId: string): Promise<BookingRecord | null> {
    const { data, error } = await adminClient()
      .from("bookings")
      .select("*")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (error) throw new Error(`Failed to find Checkout booking: ${error.message}`);
    return data ? toRecord(data) : null;
  },

  async setStripeUpgradeCheckoutSession(bookingId, sessionId, targetLesson, fromPriceCad, amountCad, expectedStartsAt, sessions) {
    const { data, error } = await adminClient().rpc("set_booking_package_upgrade_checkout", {
      p_booking_id: bookingId,
      p_session_id: sessionId,
      p_target_lesson_id: targetLesson.id,
      p_target_lesson_name: targetLesson.name,
      p_target_duration_min: targetLesson.durationMin,
      p_target_price_cad: targetLesson.priceCad,
      p_from_price_cad: fromPriceCad,
      p_amount_cad: amountCad,
      p_expected_starts_at: expectedStartsAt,
      p_sessions: sessions,
    });
    if (error) throw new Error(`Failed to save upgrade Checkout Session: ${error.message}`);
    if (data !== true) throw new Error("Booking package is no longer eligible for an upgrade.");
  },

  async getBookingByUpgradeCheckoutSession(sessionId) {
    const { data, error } = await adminClient().from("bookings").select("*")
      .eq("stripe_upgrade_checkout_session_id", sessionId).maybeSingle();
    if (error) throw new Error(`Failed to find upgrade Checkout booking: ${error.message}`);
    return data ? toRecord(data) : null;
  },

  async handleStripeCheckoutEvent(event: StripeCheckoutEvent): Promise<void> {
    const { error } = await adminClient().rpc("record_stripe_checkout_event", {
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_booking_id: event.bookingId,
      p_session_id: event.sessionId,
      p_payment_intent_id: event.paymentIntentId ?? null,
      p_invoice_id: event.invoiceId ?? null,
      p_invoice_url: event.invoiceUrl ?? null,
      p_subtotal_cents: event.subtotalCents ?? null,
      p_tax_cents: event.taxCents ?? null,
      p_total_cents: event.totalCents ?? null,
      p_currency: event.currency?.toUpperCase() ?? null,
    });
    if (error) throw new Error(`Failed to record Stripe payment event: ${error.message}`);
  },

  async handleStripeUpgradeCheckoutEvent(event: StripeUpgradeCheckoutEvent): Promise<void> {
    const { error } = await adminClient().rpc("record_stripe_upgrade_checkout_event", {
      p_event_id: event.eventId, p_event_type: event.eventType, p_booking_id: event.bookingId,
      p_session_id: event.sessionId, p_payment_intent_id: event.paymentIntentId ?? null,
      p_invoice_id: event.invoiceId ?? null, p_invoice_url: event.invoiceUrl ?? null,
      p_subtotal_cents: event.subtotalCents ?? null, p_tax_cents: event.taxCents ?? null,
      p_total_cents: event.totalCents ?? null, p_currency: event.currency?.toUpperCase() ?? null,
      p_target_lesson_id: event.targetLessonId, p_target_lesson_name: event.targetLessonName,
      p_target_duration_min: event.targetDurationMin, p_target_price_cad: event.targetPriceCad,
      p_from_price_cad: event.fromPriceCad,
    });
    if (error) throw new Error(`Failed to record Stripe upgrade event: ${error.message}`);
  },

  async createPackagePurchase(input: CreatePackagePurchaseInput): Promise<PackagePurchaseRecord> {
    const { data, error } = await adminClient().from("package_purchases").insert({
      reference: input.reference,
      student_name: input.studentName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      notes: input.notes.trim(),
      lesson_id: input.lessonId,
      lesson_name: input.lessonName,
      duration_min: input.durationMin,
      credits_purchased: input.creditsPurchased,
      amount_cad: input.amountCad,
      currency: "cad",
      payment_status: "pending",
      source: "new",
    }).select("*").single();
    if (error || !data) throw new Error(`Failed to create package purchase: ${error?.message ?? "No purchase returned."}`);
    return toPackagePurchase(data as PackagePurchaseRow);
  },

  async createScheduledPackagePurchase(input, packageQuantity, startsAt, manageTokenHash, checkoutSessionId, checkoutExpiresAt) {
    const { data, error } = await adminClient().rpc("create_scheduled_package_purchase_checkout", {
      p_purchase_id: input.id,
      p_reference: input.reference,
      p_lesson_id: input.lessonId,
      p_quantity: packageQuantity,
      p_amount_cad: input.amountCad,
      p_starts_at: startsAt,
      p_manage_token_hash: manageTokenHash,
      p_session_id: checkoutSessionId,
      p_expires_at: checkoutExpiresAt,
      p_notes: input.notes,
    });
    if (error) throw new Error(`Failed to reserve package lesson times: ${error.message}`);
    const envelope = data as RpcEnvelope<PackagePurchaseRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error) };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toPackagePurchase(envelope.record) };
  },

  async createScheduledPackagePurchaseBundle(purchases, manageTokenHash, checkoutSessionId, checkoutExpiresAt) {
    const { data, error } = await adminClient().rpc("create_scheduled_package_purchase_bundle", {
      p_purchases: purchases.map(({ input, packageQuantity, startsAt }) => ({
        id: input.id,
        reference: input.reference,
        lesson_id: input.lessonId,
        quantity: packageQuantity,
        amount_cad: input.amountCad,
        starts_at: startsAt,
        notes: input.notes,
      })),
      p_manage_token_hash: manageTokenHash,
      p_session_id: checkoutSessionId,
      p_expires_at: checkoutExpiresAt,
    });
    if (error) throw new Error(`Failed to reserve package lesson times: ${error.message}`);
    const envelope = data as { ok: boolean; error?: string; records?: PackagePurchaseRow[] };
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error ?? "conflict") };
    return { ok: true, value: (envelope.records ?? []).map((row) => toPackagePurchase(row)) };
  },

  async setStripePackagePurchaseCheckout(purchaseId: string, sessionId: string, expiresAt: string): Promise<void> {
    const { data, error } = await adminClient().from("package_purchases")
      .update({ payment_status: "pending", stripe_checkout_session_id: sessionId, stripe_checkout_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("id", purchaseId)
      .in("payment_status", ["pending", "failed"])
      .select("id").maybeSingle();
    if (error) throw new Error(`Failed to save package Checkout Session: ${error.message}`);
    if (!data) throw new Error("Package purchase is no longer eligible for Checkout.");
  },

  async getPackagePurchaseByCheckoutSession(sessionId: string): Promise<PackagePurchaseRecord | null> {
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (error) throw new Error(`Failed to load package purchase: ${error.message}`);
    return data ? toPackagePurchase(data as PackagePurchaseRow) : null;
  },

  async getPackagePurchasesByCheckoutSession(sessionId: string): Promise<PackagePurchaseRecord[]> {
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .eq("stripe_checkout_session_id", sessionId).order("created_at", { ascending: true });
    if (error) throw new Error(`Failed to load package purchases by Checkout Session: ${error.message}`);
    return (data ?? []).map((row) => toPackagePurchase(row as PackagePurchaseRow));
  },

  async findPackagePurchasesByEmail(email: string): Promise<PackagePurchaseRecord[]> {
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .eq("email", email.trim().toLowerCase()).order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list package purchases: ${error.message}`);
    const rows = (data ?? []) as PackagePurchaseRow[];
    if (!rows.length) return [];
    const { data: events, error: eventsError } = await adminClient().from("package_credit_events")
      .select("purchase_id, quantity_delta").in("purchase_id", rows.map((row) => row.id));
    if (eventsError) throw new Error(`Failed to load package credit balances: ${eventsError.message}`);
    const balances = new Map<string, number>();
    for (const event of events ?? []) balances.set(event.purchase_id, (balances.get(event.purchase_id) ?? 0) + event.quantity_delta);
    return rows.map((row) => toPackagePurchase(row, balances.get(row.id) ?? 0));
  },

  async listPackagePurchases(limit = 200): Promise<PackagePurchaseRecord[]> {
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .order("created_at", { ascending: false }).limit(Math.max(1, Math.min(500, limit)));
    if (error) throw new Error(`Failed to list package purchases: ${error.message}`);
    const rows = (data ?? []) as PackagePurchaseRow[];
    if (!rows.length) return [];
    const { data: events, error: eventsError } = await adminClient().from("package_credit_events")
      .select("purchase_id, quantity_delta").in("purchase_id", rows.map((row) => row.id));
    if (eventsError) throw new Error(`Failed to load package credit balances: ${eventsError.message}`);
    const balances = new Map<string, number>();
    for (const event of events ?? []) balances.set(event.purchase_id, (balances.get(event.purchase_id) ?? 0) + event.quantity_delta);
    return rows.map((row) => toPackagePurchase(row, balances.get(row.id) ?? 0));
  },

  async listPackageCreditEvents(purchaseIds: string[]): Promise<PackageCreditEventRecord[]> {
    if (!purchaseIds.length) return [];
    const { data, error } = await adminClient().from("package_credit_events").select("*")
      .in("purchase_id", purchaseIds).order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list package credit events: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      purchaseId: row.purchase_id,
      bookingId: row.booking_id ?? undefined,
      eventType: row.event_type,
      quantityDelta: row.quantity_delta,
      sourceKey: row.source_key,
      actorId: row.actor_id ?? undefined,
      note: row.note ?? undefined,
      createdAt: row.created_at,
    }));
  },

  async getPackagePurchaseByToken(tokenHash: string): Promise<PackagePurchaseRecord | null> {
    const { data: token, error: tokenError } = await adminClient().from("package_purchase_tokens")
      .select("purchase_id, expires_at").eq("token_hash", tokenHash).maybeSingle();
    if (tokenError) throw new Error(`Failed to load package manage token: ${tokenError.message}`);
    if (!token || Date.parse(token.expires_at) < Date.now()) return null;
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .eq("id", token.purchase_id).maybeSingle();
    if (error) throw new Error(`Failed to load package purchase: ${error.message}`);
    if (!data) return null;
    const { data: events, error: eventsError } = await adminClient().from("package_credit_events")
      .select("quantity_delta").eq("purchase_id", token.purchase_id);
    if (eventsError) throw new Error(`Failed to load package credit balance: ${eventsError.message}`);
    const balance = (events ?? []).reduce((sum, item) => sum + item.quantity_delta, 0);
    return toPackagePurchase(data as PackagePurchaseRow, balance);
  },

  async getPackagePurchaseById(purchaseId: string): Promise<PackagePurchaseRecord | null> {
    const { data, error } = await adminClient().from("package_purchases").select("*")
      .eq("id", purchaseId).maybeSingle();
    if (error) throw new Error(`Failed to load package purchase: ${error.message}`);
    if (!data) return null;
    const { data: events, error: eventsError } = await adminClient().from("package_credit_events")
      .select("quantity_delta").eq("purchase_id", purchaseId);
    if (eventsError) throw new Error(`Failed to load package credit balance: ${eventsError.message}`);
    const balance = (events ?? []).reduce((sum, item) => sum + item.quantity_delta, 0);
    return toPackagePurchase(data as PackagePurchaseRow, balance);
  },

  async findBookingsByPurchaseId(purchaseId: string): Promise<BookingRecord[]> {
    const { data, error } = await adminClient().from("bookings").select("*")
      .eq("purchase_id", purchaseId).order("session_index", { ascending: true });
    if (error) throw new Error(`Failed to load purchased lesson sessions: ${error.message}`);
    return (data ?? []).map(toRecord);
  },

  async issuePackagePurchaseManageToken(purchaseId: string): Promise<string | null> {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const { data, error } = await adminClient().rpc("rotate_package_purchase_token", {
      p_purchase_id: purchaseId,
      p_token_hash: tokenHash,
      p_expires_at: tokenExpiry(),
    });
    if (error) throw new Error(`Failed to rotate package manage token: ${error.message}`);
    if (data !== true) return null;
    return rawToken;
  },

  async handleStripePackagePurchaseEvent(event: StripePackagePurchaseEvent): Promise<void> {
    const client = adminClient();
    if (event.eventType === "paid") {
      const { data, error } = await client.rpc("fulfill_package_purchase_payment", {
        p_event_id: event.eventId,
        p_purchase_id: event.purchaseId,
        p_session_id: event.sessionId,
        p_payment_intent_id: event.paymentIntentId ?? null,
        p_invoice_id: event.invoiceId ?? null,
        p_invoice_url: event.invoiceUrl ?? null,
        p_subtotal_cents: event.subtotalCents ?? null,
        p_tax_cents: event.taxCents ?? null,
        p_total_cents: event.totalCents ?? null,
        p_currency: event.currency?.toLowerCase() ?? null,
        p_paid_at: event.paidAt ?? null,
      });
      if (error) throw new Error(`Failed to fulfill package purchase: ${error.message}`);
      if (data !== true) throw new Error("Package purchase payment did not match its stored Checkout order.");
      return;
    }
    const { error } = await client.rpc("expire_package_purchase_checkout", {
      p_event_id: event.eventId,
      p_purchase_id: event.purchaseId,
      p_session_id: event.sessionId,
    });
    if (error) throw new Error(`Failed to expire package purchase: ${error.message}`);
  },

  async schedulePackageCredit(purchaseId, startsAt, token) {
    const { data, error } = await adminClient().rpc("schedule_package_credit", {
      p_purchase_id: purchaseId,
      p_starts_at: startsAt,
      p_current_token_hash: token.currentHash,
      p_token_hash: token.hash,
      p_token_expires_at: token.expiresAt,
    });
    if (error) throw new Error(`Failed to schedule package credit: ${error.message}`);
    const envelope = data as RpcEnvelope<BookingRow>;
    if (!envelope.ok) return { ok: false, error: mapError(envelope.error) };
    if (!envelope.record) return { ok: false, error: "not_found" };
    return { ok: true, value: toRecord(envelope.record) };
  },
};

interface LessonRow {
  id: string;
  name: string;
  duration_min: number;
  session_count?: number;
  price_cad: number;
  description: string;
  features: string[] | null;
  icon: string | null;
  popular: boolean | null;
  category: string;
}

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    name: row.name,
    durationMin: row.duration_min,
    sessionCount: row.session_count ?? 1,
    priceCad: row.price_cad,
    description: row.description,
    features: Array.isArray(row.features) ? row.features : [],
    icon: (row.icon as Lesson["icon"]) || "clock",
    popular: row.popular ?? undefined,
    category: row.category === "module" ? "module" : "package",
  };
}

function mapError(code: string): "conflict" | "not_found" | "expired" | "not_modifiable" | "reschedule_limit" {
  if (code === "conflict") return "conflict";
  if (code === "expired") return "expired";
  if (code === "not_modifiable") return "not_modifiable";
  if (code === "reschedule_limit") return "reschedule_limit";
  return "not_found";
}
