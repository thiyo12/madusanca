import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { assessmentForBooking, studentForBooking } from "@/lib/admin/student-profiles";
import { createTutorLessonReportPdf } from "@/lib/admin/student-assessment-pdf";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string; reportBookingId: string }> },
): Promise<Response> {
  await requireAdmin("/admin/students");
  const { bookingId, reportBookingId } = await params;
  try {
    const bookings = await getStudentBookingsByAnchor(bookingId);
    const student = await studentForBooking(bookingId);
    if (!bookings?.length || !student) {
      return NextResponse.json({ error: "Student record not found." }, { status: 404, headers: privateHeaders });
    }
    const booking = bookings.find((item) => item.id === reportBookingId);
    if (!booking) {
      return NextResponse.json({ error: "Lesson does not belong to this student." }, { status: 404, headers: privateHeaders });
    }
    const report = await assessmentForBooking(booking.id);
    if (!report) {
      return NextResponse.json({ error: "No report is saved for this lesson." }, { status: 404, headers: privateHeaders });
    }
    const pdf = createTutorLessonReportPdf(student, booking, report, new Date());
    const reference = booking.reference.replace(/[^A-Za-z0-9-]/g, "");
    return new Response(Buffer.from(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lesson-report-${reference}.pdf"`,
      },
    });
  } catch (error) {
    logSafeError("[admin/student-lesson-report-pdf] generation failed", error);
    return NextResponse.json({ error: "Could not generate the lesson report." }, { status: 500, headers: privateHeaders });
  }
}
