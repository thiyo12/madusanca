import { NextResponse } from "next/server";
import { assessmentForBooking } from "@/lib/admin/student-profiles";
import { createStudentAssessmentPdf } from "@/lib/admin/student-assessment-pdf";
import { getManageToken } from "@/lib/booking/manage-cookie";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";

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

    if (!bookings.length || !studentName) {
      return NextResponse.json({ error: "No lesson reports are available for this booking." }, { status: 404 });
    }
    const reports = (await Promise.all(bookings.map((booking) => assessmentForBooking(booking.id))))
      .filter((report): report is NonNullable<typeof report> => Boolean(report));
    if (!reports.length) {
      return NextResponse.json({ error: "No saved lesson reports are available yet." }, { status: 404 });
    }

    const pdf = createStudentAssessmentPdf(studentName, new Date(), bookings, reports);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="lesson-assessment.pdf"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not generate the lesson report. Please try again." }, { status: 500 });
  }
}
