import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/admin/status-chip";
import { dayKeyOf, formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { adminStudentLessonPdfHref, adminStudentPdfHref } from "@/lib/admin/urls";
import { assessmentsForStudent, courseCompletionsForStudent, profileById, studentForBooking, type StudentAssessment } from "@/lib/admin/student-profiles";
import { finishStudentCourseAction, saveStudentDetailsAction } from "../actions";
import type { BookingRecord } from "@/lib/booking/types";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";

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
  const [studentDetails, assessments, completions] = await Promise.all([
    profileById(profile.id), assessmentsForStudent(profile.id), courseCompletionsForStudent(profile.id),
  ]);
  const reportByBooking = new Map<string, StudentAssessment>();
  for (const report of assessments) {
    if (!report.booking_id) continue;
    const current = reportByBooking.get(report.booking_id);
    const timestamp = (item: StudentAssessment) => item.updated_at ?? item.assessment_date;
    if (!current || timestamp(report).localeCompare(timestamp(current)) > 0) reportByBooking.set(report.booking_id, report);
  }
  const courseGroups = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const key = booking.packageId ?? booking.id;
    courseGroups.set(key, [...(courseGroups.get(key) ?? []), booking]);
  }
  const courseSummaries = [...courseGroups].map(([key, sessions]) => {
    const done = sessions.filter((item) => item.status === "completed");
    const expected = Math.max(...sessions.map((item) => item.sessionCount ?? sessions.length), sessions.length);
    const finished = completions.find((item) => item.course_key === key);
    const averages = TUTOR_REPORT_RUBRIC.map((section) => {
      const reports = done.map((item) => reportByBooking.get(item.id)).filter(Boolean);
      const detailed = reports.flatMap((report) => section.items.map((item) => report!.rubric_scores?.[item.key]).filter((value): value is number => typeof value === "number"));
      return detailed.length ? (detailed.reduce((sum, value) => sum + value, 0) / detailed.length).toFixed(1) : "—";
    });
    return { key, sessions, done, expected, finished, averages };
  });
  const completedLessons = bookings.filter((booking) => booking.status === "completed");
  const nowMs = Date.now(); // eslint-disable-line react-hooks/purity -- server-rendered request snapshot
  const upcomingLessons = bookings.filter((booking) => ["confirmed", "rescheduled", "pending_payment"].includes(booking.status) && Date.parse(booking.startsAt) + booking.durationMin * 60_000 > nowMs);
  const pastIncompleteLessons = bookings.filter((booking) => ["confirmed", "rescheduled", "pending_payment"].includes(booking.status) && Date.parse(booking.startsAt) + booking.durationMin * 60_000 <= nowMs);
  const otherLessons = bookings.filter((booking) => !["completed", "confirmed", "rescheduled", "pending_payment"].includes(booking.status));
  function renderLesson(booking: BookingRecord) {
    const report = reportByBooking.get(booking.id);
    const reportScores = Object.values(report?.rubric_scores ?? {}).filter((score): score is number => typeof score === "number");
    const reportAverage = reportScores.length ? (reportScores.reduce((sum, score) => sum + score, 0) / reportScores.length).toFixed(1) : null;
    const legacyRatings = report ? [
      ["Vehicle control", report.vehicle_control], ["Observation", report.observation],
      ["Intersections", report.intersections], ["Lane changes", report.lane_changes],
      ["Speed and space", report.speed_space], ["Parking", report.parking],
      ["Hazard awareness", report.hazard_awareness],
    ].filter((item): item is [string, number] => typeof item[1] === "number") : [];
    return (
      <article key={booking.id} className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-ink">Class {booking.sessionIndex} · {booking.lessonName}</h3><StatusChip status={booking.status} /></div>
            <p className="mt-1 text-xs text-soft">{formatSlotDay(booking.startsAt)} · {formatSlotTime(booking.startsAt)} Pacific · {booking.durationMin} minutes</p>
          </div>
          <Link href={`/admin/calendar?view=week&date=${encodeURIComponent(dayKeyOf(booking.startsAt))}&booking=${encodeURIComponent(booking.id)}`} className="inline-flex rounded-lg border border-line px-3 py-2 text-[11px] font-extrabold text-ink hover:border-gold hover:text-gold-deep">Open in calendar</Link>
        </div>
        {report ? (
          <details className="mt-3 rounded-lg bg-mist p-3" open>
            <summary className="cursor-pointer text-xs font-extrabold text-ink">Lesson report · {report.assessment_date}{reportAverage ? ` · Overall ${reportAverage}/10` : ""}</summary>
            <a href={adminStudentLessonPdfHref(bookingId, booking.id)} className="mt-3 inline-flex rounded-lg border border-line bg-white px-3 py-2 text-[11px] font-extrabold text-ink hover:border-gold hover:text-gold-deep">Download this lesson report PDF</a>
            {reportScores.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{TUTOR_REPORT_RUBRIC.map((section) => {
              const markedItems = section.items.filter((item) => typeof report.rubric_scores?.[item.key] === "number");
              const comment = report.section_comments?.[section.key]?.trim();
              if (!markedItems.length && !comment) return null;
              return <section key={section.key} className="rounded-lg border border-line bg-white p-3"><h4 className="text-xs font-extrabold text-ink">{section.title}</h4>{markedItems.length > 0 && <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">{markedItems.map((item) => <li key={item.key} className="text-soft">{item.label}: <strong className="text-ink">{report.rubric_scores?.[item.key]}/10</strong></li>)}</ul>}{comment && <p className="mt-2 whitespace-pre-wrap text-xs text-soft">{comment}</p>}</section>;
            })}</div> : legacyRatings.length ? <section className="mt-3 rounded-lg border border-line bg-white p-3"><h4 className="text-xs font-extrabold text-ink">Previously recorded category ratings · 1–5</h4><ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">{legacyRatings.map(([label, score]) => <li key={label} className="text-soft">{label}: <strong className="text-ink">{score}/5</strong></li>)}</ul></section> : <p className="mt-2 text-xs text-soft">No skill ratings were recorded in this report.</p>}
            {report.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-2 text-xs text-soft">{report.notes}</p>}
            {(report.road_test_date || report.road_test_location || report.road_test_outcome) && <p className="mt-3 border-t border-line pt-2 text-xs text-soft"><strong className="text-ink">Road test:</strong> {report.road_test_outcome?.replaceAll("_", " ") ?? "Not recorded"}{report.road_test_date ? ` · ${report.road_test_date}` : ""}{report.road_test_location ? ` · ${report.road_test_location}` : ""}</p>}
          </details>
        ) : booking.status === "completed" || (Date.parse(booking.startsAt) + booking.durationMin * 60_000 <= nowMs && ["confirmed", "rescheduled", "pending_payment"].includes(booking.status)) ? <p className="mt-3 text-xs text-soft">No report saved for this lesson yet.</p> : null}
      </article>
    );
  }

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
          <a href={adminStudentPdfHref(bookingId)} className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[12px] font-extrabold text-ink">Download full report PDF</a>
      </div>

      {studentDetails && (
        <section className="mt-5 rounded-[16px] border border-line bg-white p-5 print:hidden">
          <h2 className="text-[13px] font-extrabold text-ink">Student details · private admin record</h2>
          <p className="mt-1 text-[11px] text-soft">Edit the full set of personal and pickup details collected by the booking form. Consent and lesson-specific notes remain in the booking record.</p>
          <form action={saveStudentDetailsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="studentId" value={studentDetails.id} /><input type="hidden" name="bookingId" value={anchor.id} />
            <label className="grid gap-1 text-xs font-semibold text-soft">First name<input name="firstName" maxLength={30} defaultValue={studentDetails.first_name} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Last name<input name="lastName" maxLength={30} defaultValue={studentDetails.last_name} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Full legal name (as shown on licence)<input name="name" required maxLength={160} defaultValue={studentDetails.full_name} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Email<input name="email" type="email" required maxLength={160} defaultValue={studentDetails.email} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Phone<input name="phone" maxLength={25} defaultValue={studentDetails.phone} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Date of birth<input name="dob" type="date" defaultValue={studentDetails.date_of_birth ?? ""} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Gender<select name="gender" defaultValue={studentDetails.gender ?? ""} className="rounded border bg-white p-2 text-ink"><option value="">Not recorded</option>{["woman","man","non_binary","another_identity","prefer_not_to_say"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Driver’s licence number<input name="license" minLength={4} maxLength={32} autoComplete="off" defaultValue={studentDetails.license_number ?? ""} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">BC licence class<select name="licenseClass" defaultValue={studentDetails.license_class} className="rounded border bg-white p-2 text-ink"><option value="">Not recorded</option><option value="7L">Class 7L (Learner)</option><option value="7N">Class 7N (Novice)</option><option value="5">Class 5</option><option value="Other">Other / out-of-province</option></select></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Street address<input name="street" maxLength={120} defaultValue={studentDetails.street} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">City<input name="city" maxLength={60} defaultValue={studentDetails.city} className="rounded border p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Province<input name="province" value="BC" readOnly className="rounded border bg-mist p-2 text-ink" /></label>
            <label className="grid gap-1 text-xs font-semibold text-soft">Postal code<input name="postalCode" maxLength={12} defaultValue={studentDetails.postal_code} className="rounded border p-2 text-ink" /></label>
            <button className="btn-gold rounded-lg px-4 py-2 text-sm font-extrabold sm:col-span-2">Save corrected details</button>
          </form>
        </section>
      )}

      <section className="mt-5 rounded-[16px] border border-line bg-white p-5 print:border-0 print:p-0">
        {courseError && <p role="alert" className="mb-3 rounded-lg bg-[#fff5f2] p-3 text-xs font-semibold text-[#bc4633]">{courseError === "lessons_remaining" ? "Complete all scheduled lessons before using Finish course, or choose End course early." : courseError === "report_missing" ? "A completed lesson is missing its saved report." : "Could not close this course. Refresh and try again."}</p>}
         <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Wisdom Driving Academy · Student assessment</p><h2 className="mt-1 text-[19px] font-extrabold text-ink">Course progress &amp; final report</h2><p className="mt-1 text-xs font-bold text-ink">{profile.full_name}</p><p className="mt-1 text-xs text-soft">School teaching assessment only. Skill ratings are 1–10; course averages use saved lesson reports. This is not an official ICBC form or score.</p></div></div>
        <div className="mt-4 grid gap-4">{courseSummaries.map((course) => { const completedCount = course.finished?.completed_lessons ?? course.done.length; const expectedCount = course.finished?.expected_lessons ?? course.expected; return <article key={course.key} className="rounded-xl border border-line p-4 print:break-inside-avoid"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-ink">{course.sessions[0]?.lessonName ?? "Driving course"}</h3><p className="mt-1 text-xs text-soft">{completedCount} of {expectedCount} lessons completed · {course.finished ? (course.finished.ended_early ? "Ended early" : "Course complete") : "In progress"}{course.finished ? ` · Closed ${formatSlotDay(course.finished.finished_at)}` : ""}</p></div>{!course.finished && course.done.length > 0 && <div className="flex flex-wrap gap-2"><form action={finishStudentCourseAction}><input type="hidden" name="studentId" value={profile.id}/><input type="hidden" name="anchorId" value={anchor.id}/><input type="hidden" name="courseKey" value={course.key}/><input type="hidden" name="endedEarly" value="false"/><button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" disabled={course.done.length < course.expected}>Finish course</button></form>{course.done.length < course.expected && <form action={finishStudentCourseAction}><input type="hidden" name="studentId" value={profile.id}/><input type="hidden" name="anchorId" value={anchor.id}/><input type="hidden" name="courseKey" value={course.key}/><input type="hidden" name="endedEarly" value="true"/><button className="rounded-lg border border-[#eadcb1] bg-[#fff9e9] px-3 py-2 text-xs font-bold text-[#735c1e]">End course early</button></form>}</div>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{TUTOR_REPORT_RUBRIC.map((section,index)=><p key={section.key} className="rounded bg-mist px-2.5 py-2 text-soft">{section.title}: <strong className="text-ink">{course.averages[index]} / 10</strong></p>)}</div><ol className="mt-3 grid gap-1">{course.sessions.map((session) => { const report = reportByBooking.get(session.id); return <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs"><span className="text-ink">{formatSlotDay(session.startsAt)} · {session.lessonName}</span><span className="text-soft">{session.status === "completed" ? `Completed${report ? ` · Report ${report.assessment_date}` : " · Report missing"}` : session.status}</span></li>; })}</ol></article>; })}</div>
      </section>

      <section className="mt-6 grid gap-5 print:hidden">
        <div><h2 className="mb-3 text-[16px] font-extrabold text-ink">Completed lessons</h2>{completedLessons.length ? <div className="grid gap-3">{completedLessons.map(renderLesson)}</div> : <p className="rounded-xl border border-line bg-white p-4 text-sm text-soft">No completed lessons yet.</p>}</div>
        {pastIncompleteLessons.length > 0 && <div><h2 className="mb-3 text-[16px] font-extrabold text-ink">Past lessons awaiting completion</h2><div className="grid gap-3">{pastIncompleteLessons.map(renderLesson)}</div></div>}
        <div><h2 className="mb-3 text-[16px] font-extrabold text-ink">Upcoming lessons</h2>{upcomingLessons.length ? <div className="grid gap-3">{upcomingLessons.map(renderLesson)}</div> : <p className="rounded-xl border border-line bg-white p-4 text-sm text-soft">No upcoming lessons.</p>}</div>
        {otherLessons.length > 0 && <details><summary className="cursor-pointer text-sm font-bold text-soft">Cancelled or missed lessons ({otherLessons.length})</summary><div className="mt-3 grid gap-3">{otherLessons.map(renderLesson)}</div></details>}
      </section>
    </div>
  );
}
