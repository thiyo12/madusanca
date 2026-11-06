import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { createStudentBookingPdf } from "@/lib/admin/student-booking-pdf";
import { getStore } from "@/lib/booking/store";
import { logSafeError } from "@/lib/server/safe-log";
import { assessmentsForStudent, studentForBooking } from "@/lib/admin/student-profiles";

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
    const studentDetails = await studentForBooking(anchor.id);
    const assessments = studentDetails ? await assessmentsForStudent(studentDetails.id) : [];
    const details = studentDetails ? { dateOfBirth: studentDetails.date_of_birth ?? "Not recorded", gender: studentDetails.gender ?? "Not recorded", licenseNumber: studentDetails.license_number ?? "Not recorded" } : await getStore().getBookingStudentDetails(anchor.id);
    const progress = assessments.map((a) => `${a.assessment_date} · Vehicle ${a.vehicle_control ?? "—"} · Observation ${a.observation ?? "—"} · Intersections ${a.intersections ?? "—"} · Lane changes ${a.lane_changes ?? "—"} · Speed/space ${a.speed_space ?? "—"} · Parking ${a.parking ?? "—"} · Hazard awareness ${a.hazard_awareness ?? "—"}${a.road_test_outcome ? ` · Road test ${a.road_test_outcome}${a.road_test_location ? ` · ${a.road_test_location}` : ""}` : ""}${a.notes ? ` · ${a.notes}` : ""}`);
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
