import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { studentSessionsComplete } from "@/lib/admin/student-record-format";
import { createStudentBookingPdf } from "@/lib/admin/student-booking-pdf";
import { getStore } from "@/lib/booking/store";
import { logSafeError } from "@/lib/server/safe-log";
import { assessmentsForStudent, studentForBooking } from "@/lib/admin/student-profiles";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  await requireAdmin("/admin/students");
  const { bookingId } = await params;
  try {
    const bookings = await getStudentBookingsByAnchor(bookingId);
    if (!bookings?.length) {
      return NextResponse.json({ error: "Student record not found." }, { status: 404, headers: privateHeaders });
    }
    if (!studentSessionsComplete(bookings)) {
      return NextResponse.json({ error: "The overall report is available after all booked lessons are complete." }, { status: 409, headers: privateHeaders });
    }
    const anchor = bookings.find((booking) => booking.sessionIndex === 1) ?? bookings[0];
    const studentDetails = await studentForBooking(anchor.id);
    const assessments = studentDetails ? await assessmentsForStudent(studentDetails.id) : [];
    const details = studentDetails ? { dateOfBirth: studentDetails.date_of_birth ?? "Not recorded", gender: studentDetails.gender ?? "Not recorded", licenseNumber: studentDetails.license_number ?? "Not recorded" } : await getStore().getBookingStudentDetails(anchor.id);
    const progress = assessments.flatMap((assessment) => {
      if (!assessment.rubric_scores) return [`${assessment.assessment_date} · Historical report saved before detailed skill ratings were added.${assessment.notes ? ` Notes: ${assessment.notes}` : ""}`];
      return [
        `Lesson report · ${assessment.assessment_date}${assessment.road_test_outcome ? ` · Road test ${assessment.road_test_outcome}${assessment.road_test_location ? ` · ${assessment.road_test_location}` : ""}` : ""}`,
        ...TUTOR_REPORT_RUBRIC.map((section) => {
          const values = section.items.map((item) => `${item.label} ${assessment.rubric_scores?.[item.key] ?? "—"}/10`).join("; ");
          const comment = assessment.section_comments?.[section.key];
          return `${section.title}: ${values}${comment ? ` · Comment: ${comment}` : ""}`;
        }),
        ...(assessment.notes ? [`Additional tutor notes: ${assessment.notes}`] : []),
      ];
    });
    const pdf = createStudentBookingPdf(bookings, new Date(), details, progress);
    const reference = bookings[0].reference.replace(/[^A-Za-z0-9-]/g, "");
    return new Response(Buffer.from(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="student-${reference}.pdf"`,
      },
    });
  } catch (error) {
    logSafeError("[admin/student-pdf] generation failed", error);
    return NextResponse.json({ error: "Could not generate the student record." }, { status: 500, headers: privateHeaders });
  }
}
