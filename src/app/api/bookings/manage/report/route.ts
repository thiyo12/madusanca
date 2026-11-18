import { NextResponse } from "next/server";
import { assessmentsForStudent, assessmentForBooking, bookingsForStudent, studentForBooking, type StudentAssessment } from "@/lib/admin/student-profiles";
import { createStudentAssessmentPdf } from "@/lib/admin/student-assessment-pdf";
import { getManageToken } from "@/lib/booking/manage-cookie";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { bookingsByCourse, courseKeyForBooking } from "@/lib/admin/course-groups";
import { courseAccessForBooking } from "@/lib/admin/student-course-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const token = await getManageToken();
  if (!token) return NextResponse.json({ error: "Verify your booking to download this report." }, { status: 401 });

  try {
    const store = getStore();
    const tokenHash = hashToken(token);
    const found = await store.getBookingByToken(tokenHash);
    let bookings = found?.sessions ?? [];
    let studentName = found?.booking.studentName;

    if (!found) {
      const purchase = await store.getPackagePurchaseByToken(tokenHash);
      if (!purchase) return NextResponse.json({ error: "This verified booking session has expired." }, { status: 404 });
      bookings = await store.findBookingsByPurchaseId(purchase.id);
      studentName = purchase.studentName;
    }

    const seedBooking = bookings[0];
    if (!seedBooking || !studentName) {
      return NextResponse.json({ error: "No lesson reports are available for this booking." }, { status: 404 });
    }
    const selectedCourseAccess = await courseAccessForBooking(seedBooking);
    if (!selectedCourseAccess.canViewReports) {
      return NextResponse.json({ error: "Report access for this completed course has ended." }, { status: 410 });
    }
    const profile = await studentForBooking(seedBooking.id);
    let reports: StudentAssessment[];
    if (profile) {
      const [profileBookings, profileReports] = await Promise.all([
        bookingsForStudent(profile.id),
        assessmentsForStudent(profile.id),
      ]);
      const selectedCourseKey = courseKeyForBooking(seedBooking, profileBookings);
      const groups = bookingsByCourse(profileBookings);
      const visibleGroups = await Promise.all([...groups].map(async ([key, sessions]) => {
        if (key === selectedCourseKey) return sessions;
        const courseAccess = await courseAccessForBooking(sessions[0]!);
        if (courseAccess.completion) return courseAccess.canViewReports ? sessions : [];
        return sessions.some((session) =>
          ["confirmed", "rescheduled"].includes(session.status) && session.paymentStatus === "paid",
        ) ? sessions : [];
      }));
      bookings = visibleGroups.flat();
      const allowedIds = new Set(bookings.map((booking) => booking.id));
      reports = profileReports.filter((report) => report.booking_id && allowedIds.has(report.booking_id));
    } else {
      reports = (await Promise.all(bookings.map((booking) => assessmentForBooking(booking.id))))
        .filter((report): report is StudentAssessment => Boolean(report));
    }
    if (!reports.length) {
      return NextResponse.json({ error: "No saved lesson reports are available yet." }, { status: 404 });
    }

    const generatedAt = new Date();
    const pdf = createStudentAssessmentPdf(studentName, generatedAt, bookings, reports);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="wda-overall-lesson-report-${generatedAt.toISOString().replace(/[:.]/g, "-")}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not generate the lesson report. Please try again." }, { status: 500 });
  }
}
