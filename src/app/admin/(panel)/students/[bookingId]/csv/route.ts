import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { assessmentsForStudent, studentForBooking } from "@/lib/admin/student-profiles";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control":"private, no-store, max-age=0", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer" };
function cell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
}
export async function GET(_request: Request, { params }: { params: Promise<{ bookingId: string }> }): Promise<Response> {
  await requireAdmin("/admin/students");
  const { bookingId } = await params;
  try {
    const [bookings, profile] = await Promise.all([getStudentBookingsByAnchor(bookingId), studentForBooking(bookingId)]);
    if (!bookings?.length || !profile) return NextResponse.json({ error:"Student record not found." }, { status:404, headers });
    const assessments = await assessmentsForStudent(profile.id);
    const lines = [
      ["Record","Name","Email","Phone","Date of birth","Gender","Driver licence","Booking reference","Lesson","Start","Status","Payment","Assessment date","Vehicle control","Observation","Intersections","Lane changes","Speed and space","Parking","Hazard awareness","Road test date","Road test location","Road test outcome","Notes"],
      ...bookings.map((b) => ["Booking",profile.full_name,profile.email,profile.phone,profile.date_of_birth,profile.gender,profile.license_number,b.reference,b.lessonName,b.startsAt,b.status,b.paymentStatus,"","","","","","","","","","","",b.notes]),
      ...assessments.map((a) => ["School assessment",profile.full_name,profile.email,profile.phone,profile.date_of_birth,profile.gender,profile.license_number,"","","","","",a.assessment_date,a.vehicle_control,a.observation,a.intersections,a.lane_changes,a.speed_space,a.parking,a.hazard_awareness,a.road_test_date,a.road_test_location,a.road_test_outcome,a.notes]),
    ].map((row) => row.map(cell).join(",")).join("\r\n");
    return new Response(`\uFEFF${lines}`, { headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=student-progress.csv"} });
  } catch (error) {
    logSafeError("[admin/student-csv] generation failed", error);
    return NextResponse.json({ error:"Could not generate the student report." }, { status:500, headers });
  }
}
