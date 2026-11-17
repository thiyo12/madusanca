import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { logSafeError } from "@/lib/server/safe-log";
import { assessmentsForStudent, profileById, studentForBooking } from "@/lib/admin/student-profiles";
import { createFullStudentRecordPdf } from "@/lib/admin/student-assessment-pdf";

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
    const anchor = bookings.find((booking) => booking.sessionIndex === 1) ?? bookings[0];
    const linkedStudent = await studentForBooking(anchor.id);
    const student = linkedStudent ? await profileById(linkedStudent.id) : null;
    if (!student) return NextResponse.json({ error: "Student profile not found." }, { status: 404, headers: privateHeaders });
    const assessments = await assessmentsForStudent(student.id);
    const generatedAt = new Date();
    const pdf = createFullStudentRecordPdf(student, generatedAt, bookings, assessments);
    const reference = bookings[0].reference.replace(/[^A-Za-z0-9-]/g, "");
    const fileTimestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
    return new Response(Buffer.from(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lesson-progress-report-${reference}-${fileTimestamp}.pdf"`,
      },
    });
  } catch (error) {
    logSafeError("[admin/student-pdf] generation failed", error);
    return NextResponse.json({ error: "Could not generate the student record." }, { status: 500, headers: privateHeaders });
  }
}
