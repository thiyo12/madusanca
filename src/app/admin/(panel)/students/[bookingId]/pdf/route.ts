import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { studentSessionsComplete } from "@/lib/admin/student-record-format";
import { logSafeError } from "@/lib/server/safe-log";
import { assessmentsForStudent, studentForBooking } from "@/lib/admin/student-profiles";
import { createStudentAssessmentPdf } from "@/lib/admin/student-assessment-pdf";

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
    const student = await studentForBooking(anchor.id);
    const assessments = student ? await assessmentsForStudent(student.id) : [];
    const pdf = createStudentAssessmentPdf(bookings[0]?.studentName ?? student?.full_name ?? "Student", new Date(), bookings, assessments);
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
