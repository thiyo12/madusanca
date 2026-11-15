import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { allStudentProfiles, assessmentsForStudent, bookingsForStudent, profileById } from "@/lib/admin/student-profiles";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";
import { dayKeyOf } from "@/lib/booking/format";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function cell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request): Promise<Response> {
  await requireAdmin("/admin/students");
  const url = new URL(request.url);
  const parsed = z.object({ start: z.iso.date(), end: z.iso.date() }).safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  });
  if (!parsed.success || parsed.data.start > parsed.data.end) {
    return NextResponse.json({ error: "Choose a valid start and end date." }, { status: 400, headers });
  }

  try {
    const profiles = await allStudentProfiles();
    const profileColumns = ["Student ID", "Full name", "First name", "Last name", "Email", "Phone", "Date of birth", "Gender", "Licence number", "Licence class", "Street", "City", "Province", "Postal code"];
    const bookingColumns = ["Booking reference", "Lesson", "Lesson ID", "Start (Pacific)", "End (Pacific)", "Duration minutes", "Booking status", "Active booking", "Payment status", "Price CAD", "Stripe subtotal CAD", "Stripe tax CAD", "Stripe total CAD", "Currency", "Stripe payment intent ID", "Stripe invoice ID", "Session index", "Session count", "Notes"];
    const rubricColumns = TUTOR_REPORT_RUBRIC.flatMap((section) => section.items.map((item) => `${section.title}: ${item.label} (1–10)`));
    const commentColumns = TUTOR_REPORT_RUBRIC.map((section) => `${section.title} instructor comment`);
    const headersRow = ["Record type", ...profileColumns, ...bookingColumns, "Report date", "Road test date", "Road test location", "Road test outcome", ...rubricColumns, ...commentColumns, "Tutor notes"];
    const rows: unknown[][] = [headersRow];

    for (const listedProfile of profiles) {
      const [profile, allBookings] = await Promise.all([
        profileById(listedProfile.id),
        bookingsForStudent(listedProfile.id),
      ]);
      if (!profile) continue;
      const bookings = allBookings.filter((booking) => {
        const day = dayKeyOf(booking.startsAt);
        return day >= parsed.data.start && day <= parsed.data.end;
      });
      if (!bookings.length) continue;
      const details = [profile.id, profile.full_name, profile.first_name, profile.last_name, profile.email, profile.phone,
        profile.date_of_birth, profile.gender, profile.license_number, profile.license_class, profile.street, profile.city,
        profile.province, profile.postal_code];
      const bookingIds = new Set(bookings.map((booking) => booking.id));
      const assessments = (await assessmentsForStudent(profile.id)).filter((assessment) => assessment.booking_id && bookingIds.has(assessment.booking_id));
      rows.push(["Student", ...details, ...Array(bookingColumns.length + 5 + rubricColumns.length + commentColumns.length).fill("")]);
      for (const booking of bookings) {
        const bookingData = [booking.reference, booking.lessonName, booking.lessonId, booking.startsAt, booking.endsAt,
          booking.durationMin, booking.status, ["pending_payment", "confirmed", "rescheduled"].includes(booking.status) ? "yes" : "no",
          booking.paymentStatus, booking.packagePriceCad ?? booking.priceCad, booking.stripeSubtotalCad ?? "",
          booking.stripeTaxCad ?? "", booking.stripeTotalCad ?? "", booking.stripeCurrency ?? "",
          booking.stripePaymentIntentId ?? "", booking.stripeInvoiceId ?? "",
          booking.sessionIndex, booking.sessionCount, booking.notes];
        rows.push(["Lesson", ...details, ...bookingData, ...Array(5 + rubricColumns.length + commentColumns.length).fill("")]);
      }
      for (const assessment of assessments) {
        const booking = bookings.find((item) => item.id === assessment.booking_id);
        const bookingData = booking ? [booking.reference, booking.lessonName, booking.lessonId, booking.startsAt, booking.endsAt,
          booking.durationMin, booking.status, ["pending_payment", "confirmed", "rescheduled"].includes(booking.status) ? "yes" : "no",
          booking.paymentStatus, booking.packagePriceCad ?? booking.priceCad, booking.stripeSubtotalCad ?? "",
          booking.stripeTaxCad ?? "", booking.stripeTotalCad ?? "", booking.stripeCurrency ?? "",
          booking.stripePaymentIntentId ?? "", booking.stripeInvoiceId ?? "",
          booking.sessionIndex, booking.sessionCount, booking.notes] : Array(bookingColumns.length).fill("");
        rows.push(["Lesson report", ...details, ...bookingData, assessment.assessment_date, assessment.road_test_date,
          assessment.road_test_location, assessment.road_test_outcome,
          ...TUTOR_REPORT_RUBRIC.flatMap((section) => section.items.map((item) => assessment.rubric_scores?.[item.key] ?? "")),
          ...TUTOR_REPORT_RUBRIC.map((section) => assessment.section_comments?.[section.key] ?? ""), assessment.notes]);
      }
    }

    const csv = `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`;
    return new Response(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="student-data-${parsed.data.start}-to-${parsed.data.end}.csv"` } });
  } catch (error) {
    logSafeError("[admin/students-export] generation failed", error);
    return NextResponse.json({ error: "Could not generate the student data export." }, { status: 500, headers });
  }
}
