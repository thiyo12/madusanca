"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { zonedToUtc } from "@/lib/booking/slots";
import { manageUrl } from "@/lib/booking/urls";
import { sendBookingConfirmedEmail } from "@/lib/email/booking-emails";
import { logSafeError } from "@/lib/server/safe-log";
import { dateOnlySchema } from "@/lib/validation/booking";
import { searchBookingsByLicense } from "@/lib/admin/student-profiles";
import { redirect } from "next/navigation";
import { saveBookingAssessment, studentForBooking } from "@/lib/admin/student-profiles";
import { TUTOR_REPORT_ITEMS, TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";

export interface QuickBookingState {
  ok: boolean;
  message: string;
  reference?: string;
}

export async function saveTutorLessonReportAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/calendar");
  const returnView = formData.get("view") === "month" ? "month" : "week";
  const reportReturn = (day: string, bookingId: string, error: string) => `/admin/calendar?view=${returnView}&date=${encodeURIComponent(day)}&booking=${encodeURIComponent(bookingId)}&error=${error}`;
  const bookingId = String(formData.get("bookingId") ?? "");
  const rubricScores: Record<string, number> = {};
  for (const item of TUTOR_REPORT_ITEMS) {
    const parsedScore = z.coerce.number().int().min(1).max(10).safeParse(formData.get(`score_${item.key}`));
    if (!parsedScore.success) redirect(reportReturn(String(formData.get("day") ?? ""), bookingId, "report"));
    rubricScores[item.key] = parsedScore.data;
  }
  const sectionComments: Record<string, string> = {};
  for (const section of TUTOR_REPORT_RUBRIC) {
    const parsedComment = z.string().trim().max(2000).safeParse(formData.get(`comment_${section.key}`));
    if (!parsedComment.success) redirect(reportReturn(String(formData.get("day") ?? ""), bookingId, "report"));
    sectionComments[section.key] = parsedComment.data;
  }
  const parsed = z.object({ bookingId: z.uuid(), reportDate: z.iso.date(), notes: z.string().max(4000), roadTestDate: z.iso.date().nullable(), location: z.string().max(120), outcome: z.enum(["passed", "not_passed", "not_taken"]).nullable(), day: z.iso.date() }).safeParse({
    bookingId, reportDate: formData.get("reportDate"), notes: formData.get("notes"), roadTestDate: String(formData.get("roadTestDate") ?? "") || null, location: formData.get("location"), outcome: String(formData.get("outcome") ?? "") || null, day: formData.get("day"),
  });
  if (!parsed.success) {
    redirect(reportReturn(String(formData.get("day") ?? ""), bookingId, "report"));
  }
  const student = await studentForBooking(parsed.data.bookingId);
  if (!student) redirect(reportReturn(parsed.data.day, parsed.data.bookingId, "student"));
  const d = parsed.data;
  const legacyScore = (sectionKeys: string[]): number => {
    const values = TUTOR_REPORT_RUBRIC.filter((section) => sectionKeys.includes(section.key))
      .flatMap((section) => section.items.map((item) => rubricScores[item.key]!));
    return Math.max(1, Math.min(5, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 2)));
  };
  await saveBookingAssessment(student.id, d.bookingId, admin.userId, {
    assessment_date: d.reportDate,
    vehicle_control: legacyScore(["vehicle_control"]),
    observation: legacyScore(["observation"]),
    intersections: legacyScore(["intersection"]),
    lane_changes: legacyScore(["multi_lane_driving"]),
    speed_space: legacyScore(["speed"]),
    parking: legacyScore(["parking"]),
    hazard_awareness: legacyScore(["traffic_rules", "other", "appropriate_pedal"]),
    rubric_scores: rubricScores,
    section_comments: sectionComments,
    notes: d.notes,
    road_test_date: d.roadTestDate,
    road_test_location: d.location,
    road_test_outcome: d.outcome,
  });
  revalidatePath(`/admin/calendar`);
  revalidatePath(`/admin/students/${d.bookingId}`);
}

export async function searchStudentByLicenseAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/calendar");
  const mode = formData.get("mode");
  const query = z.string().trim().min(1).max(160).safeParse(formData.get("query"));
  const view = formData.get("view") === "month" ? "month" : "week";
  const date = z.iso.date().safeParse(formData.get("date"));
  const day = date.success ? date.data : new Date().toISOString().slice(0, 10);
  const status = z.string().max(32).safeParse(formData.get("status"));
  const suffix = new URLSearchParams({ view, date: day });
  if (status.success && status.data) suffix.set("status", status.data);
  if (!query.success) redirect(`/admin/calendar?${suffix.toString()}&error=search`);
  if (mode !== "license") {
    suffix.set("q", query.data);
    redirect(`/admin/calendar?${suffix.toString()}`);
  }
  const license = z.string().trim().min(4).max(32).safeParse(query.data);
  if (!license.success) redirect(`/admin/calendar?${suffix.toString()}&licenseSearch=invalid`);
  const ids = await searchBookingsByLicense(license.data);
  if (!ids.length) redirect(`/admin/calendar?${suffix.toString()}&licenseSearch=none`);
  // Only an opaque booking UUID goes into the redirect; the licence itself
  // never appears in a URL, query string, or application log.
  redirect(`/admin/students/${encodeURIComponent(ids[0])}`);
}

const quickBookingSchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  dayKey: dateOnlySchema,
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
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
    time: formData.get("time"),
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
    const [hour, minute] = parsed.data.time.split(":").map(Number);
    const startsAt = zonedToUtc(year, month, day, hour * 60 + minute).toISOString();
    const startMs = Date.parse(startsAt);
    const endsAt = new Date(startMs + lesson.durationMin * 60_000).toISOString();
    if (startMs <= Date.now()) return { ok: false, message: "Choose a future date and time." };

    const token = generateToken();
    const created = await store.createAdminBooking(
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
      return { ok: false, message: created.error === "conflict" ? "That time overlaps another lesson. Choose a different time." : "Could not create that booking. Check the details and try again." };
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
