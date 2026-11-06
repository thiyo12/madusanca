import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/admin/status-chip";
import { formatLessonPrice } from "@/lib/data/lessons";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { pickupLocation } from "@/lib/admin/student-record-format";
import { adminStudentPdfHref } from "@/lib/admin/urls";
import { BookingActions } from "../../bookings/booking-actions";
import { assessmentsForStudent, profileById, studentForBooking, unlinkedBookings } from "@/lib/admin/student-profiles";
import { addStudentAssessmentAction, linkStudentBookingAction, saveStudentDetailsAction } from "../actions";
import { adminStudentCsvHref } from "@/lib/admin/urls";

export const metadata: Metadata = {
  title: "Student bookings — Wisdom Driving Academy Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const bookings = await getStudentBookingsByAnchor(bookingId);
  const student = bookings?.[0];
  if (!student || !bookings) notFound();
  const anchor = bookings.find((booking) => booking.sessionIndex === 1) ?? student;
  const profile = await studentForBooking(anchor.id);
  if (!profile) notFound();
  const [studentDetails, assessments, candidates] = await Promise.all([
    profileById(profile.id), assessmentsForStudent(profile.id), unlinkedBookings(),
  ]);
  const nowMs = new Date().getTime();

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/students" className="text-[12.5px] font-bold text-gold-deep hover:underline">
        ← Students
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Admin · Student record</p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            {profile.full_name}
          </h1>
          <p className="mt-1 text-sm text-soft">{profile.email} · {profile.phone || "No phone recorded"}</p>
        </div>
        <a
          href={adminStudentPdfHref(bookingId)}
          className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[12px] font-extrabold"
        >
          Download student PDF
        </a>
        <a href={adminStudentCsvHref(bookingId)} className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[12px] font-extrabold text-ink">Download CSV</a>
      </div>

      {studentDetails && (
        <section className="mt-5 rounded-[16px] border border-line bg-white p-5">
          <h2 className="text-[13px] font-extrabold text-ink">Student details · private admin record</h2>
          <form action={saveStudentDetailsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="studentId" value={studentDetails.id} /><input type="hidden" name="bookingId" value={anchor.id} />
            <label className="grid gap-1 text-xs font-semibold text-soft">Name<input name="name" required maxLength={160} defaultValue={studentDetails.full_name} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Email<input name="email" type="email" required maxLength={160} defaultValue={studentDetails.email} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Phone<input name="phone" maxLength={25} defaultValue={studentDetails.phone} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Date of birth<input name="dob" type="date" defaultValue={studentDetails.date_of_birth ?? ""} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Gender<select name="gender" defaultValue={studentDetails.gender ?? ""} className="rounded border bg-white p-2 text-ink"><option value="">Not recorded</option>{["woman","man","non_binary","another_identity","prefer_not_to_say"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Driver’s licence number<input name="license" minLength={4} maxLength={32} autoComplete="off" defaultValue={studentDetails.license_number ?? ""} className="rounded border p-2 text-ink" /></label>
            <button className="btn-gold rounded-lg px-4 py-2 text-sm font-extrabold sm:col-span-2">Save corrected details</button>
          </form>
        </section>
      )}

      <section className="mt-5 rounded-[16px] border border-line bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Link another booking to this student</h2>
        <p className="mt-1 text-xs text-soft">Bookings are not combined by email. Choose only when you have verified they belong to this person.</p>
        <form action={linkStudentBookingAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="studentId" value={profile.id} /><input type="hidden" name="anchorId" value={anchor.id} />
          <select name="bookingId" required className="min-w-64 flex-1 rounded border bg-white p-2 text-sm">{candidates.map(b=><option key={b.id} value={b.id}>{b.studentName} · {b.reference} · {formatSlotDay(b.startsAt)}</option>)}</select>
          <button className="rounded-lg border px-4 py-2 text-sm font-bold">Link booking</button>
        </form>
      </section>

      <section className="mt-5 rounded-[16px] border border-line bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Driving progress · school teaching assessment</h2>
        <p className="mt-1 text-xs text-soft">BC-focused instructional rubric (1 = needs practice, 5 = consistent). This is not an official ICBC score.</p>
        <form action={addStudentAssessmentAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="studentId" value={profile.id} /><input type="hidden" name="anchorId" value={anchor.id} />
          <label className="grid gap-1 text-xs text-soft">Lesson (optional)<select name="bookingId" className="rounded border bg-white p-2 text-ink"><option value="">General assessment</option>{bookings.map(b=><option key={b.id} value={b.id}>{b.lessonName} · {formatSlotDay(b.startsAt)}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-soft">Assessment date<input type="date" name="assessmentDate" required defaultValue={new Date().toISOString().slice(0,10)} className="rounded border p-2 text-ink" /></label>
          {[["vehicle","Vehicle control"],["observation","Observation"],["intersections","Intersections"],["laneChanges","Lane changes"],["speedSpace","Speed and space"],["parking","Parking"],["hazard","Hazard awareness"]].map(([key,label])=><label key={key} className="grid gap-1 text-xs text-soft">{label}<select name={key} defaultValue="" className="rounded border bg-white p-2 text-ink"><option value="">Not rated</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>)}
          <label className="grid gap-1 text-xs text-soft">Road-test date<input name="roadTestDate" type="date" className="rounded border p-2 text-ink" /></label>
          <label className="grid gap-1 text-xs text-soft">Road-test location (BC)<input name="location" maxLength={120} placeholder="City / test centre" className="rounded border p-2 text-ink" /></label>
          <label className="grid gap-1 text-xs text-soft">Outcome<select name="outcome" defaultValue="" className="rounded border bg-white p-2 text-ink"><option value="">Not recorded</option><option value="passed">Passed</option><option value="not_passed">Not passed</option><option value="not_taken">Not taken</option></select></label>
          <label className="grid gap-1 text-xs text-soft sm:col-span-2 lg:col-span-3">Instructor notes<textarea name="notes" maxLength={4000} rows={3} className="rounded border p-2 text-ink" /></label>
          <button className="btn-gold rounded-lg px-4 py-2 text-sm font-extrabold sm:col-span-2 lg:col-span-3">Save assessment</button>
        </form>
        <div className="mt-5 grid gap-3">{assessments.map(a=><article key={a.id} className="rounded-lg bg-mist p-4 text-sm"><p className="font-bold text-ink">{a.assessment_date}{a.road_test_outcome ? ` · Road test: ${a.road_test_outcome.replaceAll("_"," ")}` : ""}{a.road_test_location ? ` · ${a.road_test_location}` : ""}</p><p className="mt-1 text-xs text-soft">Vehicle {a.vehicle_control ?? "—"} · Observation {a.observation ?? "—"} · Intersections {a.intersections ?? "—"} · Lane changes {a.lane_changes ?? "—"} · Speed/space {a.speed_space ?? "—"} · Parking {a.parking ?? "—"} · Hazards {a.hazard_awareness ?? "—"}</p>{a.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-soft">{a.notes}</p>}</article>)}</div>
      </section>

      <div className="mt-6 grid gap-4">
        {bookings.map((booking, index) => {
          const location = pickupLocation(booking.notes);
          return (
            <section key={booking.id} className="rounded-[16px] border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-extrabold text-ink">Session {index + 1} · {booking.lessonName}</h2>
                    <StatusChip status={booking.status} />
                  </div>
                  <p className="mt-2 text-[13px] font-semibold text-ink">
                    {formatSlotDay(booking.startsAt)} · {formatSlotTime(booking.startsAt)} Pacific Time
                  </p>
                  <p className="mt-1 text-[12.5px] text-soft">Duration: {booking.durationMin} minutes · Reference: {booking.reference}</p>
                  <p className="mt-1 text-[12.5px] text-soft">Location: {location ?? "Not recorded"}</p>
                  <p className="mt-1 text-[12.5px] text-soft">
                    {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : "Payment due"}
                    {" · Package total: "}{formatLessonPrice(booking.packagePriceCad ?? booking.priceCad)}
                  </p>
                  {booking.notes && (
                    <details className="mt-3 text-[12px] text-soft">
                      <summary className="cursor-pointer font-bold text-ink">Additional booking details</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-sans leading-relaxed">{booking.notes}</pre>
                    </details>
                  )}
                </div>
                <BookingActions
                  bookingId={booking.id}
                  lessonId={booking.lessonId}
                  status={booking.status}
                  startsAt={booking.startsAt}
                  paymentStatus={booking.paymentStatus ?? "due"}
                  nowMs={nowMs}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
