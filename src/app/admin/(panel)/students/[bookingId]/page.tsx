import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/admin/status-chip";
import { formatLessonPrice } from "@/lib/data/lessons";
import { dayKeyOf, formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { pickupLocation } from "@/lib/admin/student-record-format";
import { adminStudentPdfHref } from "@/lib/admin/urls";
import { assessmentsForStudent, courseCompletionsForStudent, profileById, studentForBooking, unlinkedBookings } from "@/lib/admin/student-profiles";
import { finishStudentCourseAction, linkStudentBookingAction, saveStudentDetailsAction } from "../actions";
import { adminStudentCsvHref } from "@/lib/admin/urls";
import { PrintReportButton } from "./print-report-button";

export const metadata: Metadata = {
  title: "Student bookings — Wisdom Driving Academy Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const courseError = typeof query.courseError === "string" ? query.courseError : "";
  const bookings = await getStudentBookingsByAnchor(bookingId);
  const student = bookings?.[0];
  if (!student || !bookings) notFound();
  const anchor = bookings.find((booking) => booking.sessionIndex === 1) ?? student;
  const profile = await studentForBooking(anchor.id);
  if (!profile) notFound();
  const [studentDetails, assessments, candidates, completions] = await Promise.all([
    profileById(profile.id), assessmentsForStudent(profile.id), unlinkedBookings(), courseCompletionsForStudent(profile.id),
  ]);
  const reportByBooking = new Map(assessments.filter((item) => item.booking_id).map((item) => [item.booking_id!, item]));
  const courseGroups = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const key = booking.packageId ?? booking.id;
    courseGroups.set(key, [...(courseGroups.get(key) ?? []), booking]);
  }
  const courseSummaries = [...courseGroups].map(([key, sessions]) => {
    const done = sessions.filter((item) => item.status === "completed");
    const expected = Math.max(...sessions.map((item) => item.sessionCount ?? sessions.length), sessions.length);
    const finished = completions.find((item) => item.course_key === key);
    const scoreFields = ["vehicle_control", "observation", "intersections", "lane_changes", "speed_space", "parking", "hazard_awareness"] as const;
    const averages = scoreFields.map((field) => {
      const values = done.map((item) => reportByBooking.get(item.id)?.[field]).filter((value): value is number => typeof value === "number");
      return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : "—";
    });
    return { key, sessions, done, expected, finished, averages };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/students" className="text-[12.5px] font-bold text-gold-deep hover:underline print:hidden">
        ← Students
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 print:hidden">
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
        <section className="mt-5 rounded-[16px] border border-line bg-white p-5 print:hidden">
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

      <section className="mt-5 rounded-[16px] border border-line bg-white p-5 print:hidden">
        <h2 className="text-[15px] font-extrabold text-ink">Link another booking to this student</h2>
        <p className="mt-1 text-xs text-soft">Bookings are not combined by email. Choose only when you have verified they belong to this person.</p>
        <form action={linkStudentBookingAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="studentId" value={profile.id} /><input type="hidden" name="anchorId" value={anchor.id} />
          <select name="bookingId" required className="min-w-64 flex-1 rounded border bg-white p-2 text-sm">{candidates.map(b=><option key={b.id} value={b.id}>{b.studentName} · {b.reference} · {formatSlotDay(b.startsAt)}</option>)}</select>
          <button className="rounded-lg border px-4 py-2 text-sm font-bold">Link booking</button>
        </form>
      </section>

      <section className="mt-5 rounded-[16px] border border-line bg-white p-5 print:border-0 print:p-0">
        {courseError && <p role="alert" className="mb-3 rounded-lg bg-[#fff5f2] p-3 text-xs font-semibold text-[#bc4633]">{courseError === "lessons_remaining" ? "Complete all scheduled lessons before using Finish course, or choose End course early." : courseError === "report_missing" ? "A completed lesson is missing its saved report." : "Could not close this course. Refresh and try again."}</p>}
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Wisdom Driving Academy · Student assessment</p><h2 className="mt-1 text-[19px] font-extrabold text-ink">Course progress &amp; final report</h2><p className="mt-1 text-xs font-bold text-ink">{profile.full_name}</p><p className="mt-1 text-xs text-soft">School teaching assessment only. Instructional rubric: 1 = needs practice; 5 = consistent. Averages use completed lessons with saved reports. This is not an official ICBC form or score.</p></div><PrintReportButton /></div>
        <div className="mt-4 grid gap-4">{courseSummaries.map((course) => { const completedCount = course.finished?.completed_lessons ?? course.done.length; const expectedCount = course.finished?.expected_lessons ?? course.expected; return <article key={course.key} className="rounded-xl border border-line p-4 print:break-inside-avoid"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-ink">{course.sessions[0]?.lessonName ?? "Driving course"}</h3><p className="mt-1 text-xs text-soft">{completedCount} of {expectedCount} lessons completed · {course.finished ? (course.finished.ended_early ? "Ended early" : "Course complete") : "In progress"}{course.finished ? ` · Closed ${formatSlotDay(course.finished.finished_at)}` : ""}</p></div>{!course.finished && course.done.length > 0 && <div className="flex flex-wrap gap-2"><form action={finishStudentCourseAction}><input type="hidden" name="studentId" value={profile.id}/><input type="hidden" name="anchorId" value={anchor.id}/><input type="hidden" name="courseKey" value={course.key}/><input type="hidden" name="endedEarly" value="false"/><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" disabled={course.done.length < course.expected}>Finish course</button></form>{course.done.length < course.expected && <form action={finishStudentCourseAction}><input type="hidden" name="studentId" value={profile.id}/><input type="hidden" name="anchorId" value={anchor.id}/><input type="hidden" name="courseKey" value={course.key}/><input type="hidden" name="endedEarly" value="true"/><button className="rounded-lg border border-[#eadcb1] bg-[#fff9e9] px-3 py-2 text-xs font-bold text-[#735c1e]">End course early</button></form>}</div>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{["Vehicle control","Observation","Intersections","Lane changes","Speed / space","Parking","Hazard awareness"].map((label,index)=><p key={label} className="rounded bg-mist px-2.5 py-2 text-soft">{label}: <strong className="text-ink">{course.averages[index]}</strong></p>)}</div><ol className="mt-3 grid gap-1">{course.sessions.map((session) => { const report = reportByBooking.get(session.id); return <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs"><span className="text-ink">{formatSlotDay(session.startsAt)} · {session.lessonName}</span><span className="text-soft">{session.status === "completed" ? `Completed${report ? ` · Report ${report.assessment_date}` : " · Report missing"}` : session.status}</span></li>; })}</ol></article>; })}</div>
        <div className="mt-5 grid gap-3">{assessments.map(a=><article key={a.id} className="rounded-lg bg-mist p-4 text-sm print:break-inside-avoid"><p className="font-bold text-ink">Lesson report · {a.assessment_date}{a.road_test_outcome ? ` · Road test: ${a.road_test_outcome.replaceAll("_"," ")}` : ""}{a.road_test_location ? ` · ${a.road_test_location}` : ""}</p><p className="mt-1 text-xs text-soft">Vehicle {a.vehicle_control ?? "—"} · Observation {a.observation ?? "—"} · Intersections {a.intersections ?? "—"} · Lane changes {a.lane_changes ?? "—"} · Speed/space {a.speed_space ?? "—"} · Parking {a.parking ?? "—"} · Hazards {a.hazard_awareness ?? "—"}</p>{a.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-soft">{a.notes}</p>}</article>)}</div>
      </section>

      <div className="mt-6 grid gap-4">
        {bookings.map((booking, index) => {
          const location = pickupLocation(booking.notes);
          return (
            <section key={booking.id} className="rounded-[16px] border border-line bg-white p-5 print:hidden">
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
                <Link href={`/admin/calendar?view=day&date=${encodeURIComponent(dayKeyOf(booking.startsAt))}&booking=${encodeURIComponent(booking.id)}`} className="inline-flex rounded-lg border border-line px-3 py-2 text-[11px] font-extrabold text-ink hover:border-gold hover:text-gold-deep">Open lesson in Calendar</Link>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
