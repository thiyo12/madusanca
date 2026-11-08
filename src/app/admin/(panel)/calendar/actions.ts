"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { validateSlot, zonedToUtc } from "@/lib/booking/slots";
import { manageUrl } from "@/lib/booking/urls";
import { sendBookingConfirmedEmail } from "@/lib/email/booking-emails";
import { logSafeError } from "@/lib/server/safe-log";
import { dateOnlySchema } from "@/lib/validation/booking";
import { searchBookingsByLicense } from "@/lib/admin/student-profiles";
import { redirect } from "next/navigation";
import { saveBookingAssessment, studentForBooking } from "@/lib/admin/student-profiles";

export interface QuickBookingState {
  ok: boolean;
  message: string;
  reference?: string;
}

export async function saveTutorLessonReportAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/calendar");
  const score = z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().int().min(1).max(5).nullable());
  const parsed = z.object({ bookingId: z.uuid(), reportDate: z.iso.date(), vehicle: score, observation: score, intersections: score, laneChanges: score, speedSpace: score, parking: score, hazard: score, notes: z.string().max(4000), roadTestDate: z.iso.date().nullable(), location: z.string().max(120), outcome: z.enum(["passed", "not_passed", "not_taken"]).nullable(), day: z.iso.date() }).safeParse({
    bookingId: formData.get("bookingId"), reportDate: formData.get("reportDate"), vehicle: formData.get("vehicle"), observation: formData.get("observation"), intersections: formData.get("intersections"), laneChanges: formData.get("laneChanges"), speedSpace: formData.get("speedSpace"), parking: formData.get("parking"), hazard: formData.get("hazard"), notes: formData.get("notes"), roadTestDate: String(formData.get("roadTestDate") ?? "") || null, location: formData.get("location"), outcome: String(formData.get("outcome") ?? "") || null, day: formData.get("day"),
  });
  if (!parsed.success || ![parsed.data.vehicle, parsed.data.observation, parsed.data.intersections, parsed.data.laneChanges, parsed.data.speedSpace, parsed.data.parking, parsed.data.hazard].some((value) => value !== null)) {
    redirect(`/admin/calendar?view=day&date=${encodeURIComponent(String(formData.get("day") ?? ""))}&error=report`);
  }
  const student = await studentForBooking(parsed.data.bookingId);
  if (!student) redirect(`/admin/calendar?view=day&date=${parsed.data.day}&error=student`);
  const d = parsed.data;
  await saveBookingAssessment(student.id, d.bookingId, admin.userId, { assessment_date: d.reportDate, vehicle_control: d.vehicle, observation: d.observation, intersections: d.intersections, lane_changes: d.laneChanges, speed_space: d.speedSpace, parking: d.parking, hazard_awareness: d.hazard, notes: d.notes, road_test_date: d.roadTestDate, road_test_location: d.location, road_test_outcome: d.outcome });
  revalidatePath(`/admin/calendar`);
  revalidatePath(`/admin/students/${d.bookingId}`);
}

export async function searchStudentByLicenseAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/calendar");
  const license = z.string().trim().min(4).max(32).safeParse(formData.get("license"));
  if (!license.success) redirect("/admin/calendar?licenseSearch=invalid");
  const ids = await searchBookingsByLicense(license.data);
  if (!ids.length) redirect("/admin/calendar?licenseSearch=none");
  // Only an opaque booking UUID goes into the redirect; the licence itself
  // never appears in a URL, query string, or application log.
  redirect(`/admin/students/${encodeURIComponent(ids[0])}`);
}

const quickBookingSchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  dayKey: dateOnlySchema,
  startMin: z.coerce.number().int().min(0).max(1439),
  studentName: z.string().trim().min(2).max(80),
  email: z.email().max(160),
  phone: z.string().trim().min(7).max(25),
  notes: z.string().trim().max(220).optional().or(z.literal("")),
}).strict();

export async function createCalendarBookingAction(
  _previous: QuickBookingState,
  formData: FormData,
): Promise<QuickBookingState> {
  await requireAdmin("/admin/calendar");

  const parsed = quickBookingSchema.safeParse({
    lessonId: formData.get("lessonId"),
    dayKey: formData.get("dayKey"),
    startMin: formData.get("startMin"),
    studentName: formData.get("studentName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the booking details." };
  }

  try {
    const store = getStore();
    const lessons = await store.getLessons();
    const lesson = lessons.find((item) => item.id === parsed.data.lessonId);
    if (!lesson) return { ok: false, message: "That lesson package is no longer available." };

    const [year, month, day] = parsed.data.dayKey.split("-").map(Number);
    const startsAt = zonedToUtc(year, month, day, parsed.data.startMin).toISOString();
    const startMs = Date.parse(startsAt);
    const endsAt = new Date(startMs + lesson.durationMin * 60_000).toISOString();
    const [rules, blackouts, busy, dateOverrides] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      ),
      store.getDateOverrides(parsed.data.dayKey, parsed.data.dayKey),
    ]);
    const validation = validateSlot(startsAt, {
      lessonDurationMin: lesson.durationMin,
      busy,
      blackouts,
      rules,
      dateOverrides,
      now: new Date(),
    });
    if (!validation.valid) {
      return {
        ok: false,
        message: validation.reason === "occupied"
          ? "That slot was just taken. Choose another time."
          : "That slot is outside current booking hours or the minimum lead time.",
      };
    }

    const token = generateToken();
    const created = await store.createBooking(
      {
        lessonId: lesson.id,
        lessonName: lesson.name,
        durationMin: lesson.durationMin,
        priceCad: lesson.priceCad,
        startsAt,
        endsAt,
        studentName: parsed.data.studentName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        notes: parsed.data.notes ?? "",
      },
      { hash: hashToken(token), expiresAt: tokenExpiry() },
    );
    if (!created.ok) {
      return { ok: false, message: "That slot was just taken. Choose another time." };
    }

    const emailSent = await sendBookingConfirmedEmail({
      reference: created.value.reference,
      lessonName: created.value.lessonName,
      durationMin: created.value.durationMin,
      startsAt: created.value.startsAt,
      studentName: created.value.studentName,
      studentEmail: created.value.email,
      manageUrl: manageUrl(),
    });

    revalidatePath("/admin/calendar");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin");
    return {
      ok: true,
      reference: created.value.reference,
      message: emailSent
        ? `Booking ${created.value.reference} created; confirmation emailed to the student.`
        : `Booking ${created.value.reference} created, but the email was not delivered. Check Resend sender/domain settings.`,
    };
  } catch (error) {
    logSafeError("[admin/calendar] quick booking failed", error);
    return { ok: false, message: "Could not create the booking. Check the details and try again." };
  }
}
