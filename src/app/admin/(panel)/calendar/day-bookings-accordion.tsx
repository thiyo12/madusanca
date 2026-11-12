"use client";

import { useState } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { BookingActions } from "../bookings/booking-actions";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import type { BookingStatus, PaymentStatus } from "@/lib/booking/types";
import { saveTutorLessonReportAction } from "./actions";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";
import type { TutorRubricScores, TutorSectionComments } from "@/lib/admin/tutor-report-rubric";

interface BookingItem {
  id: string;
  reference: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  sessionIndex: number;
  sessionCount: number;
  packagePriceCad: number;
  report: { assessment_date: string; vehicle_control: number | null; observation: number | null; intersections: number | null; lane_changes: number | null; speed_space: number | null; parking: number | null; hazard_awareness: number | null; notes: string; road_test_date: string | null; road_test_location: string | null; road_test_outcome: string | null; rubric_scores?: TutorRubricScores | null; section_comments?: TutorSectionComments | null } | null;
}

interface PackagePlan {
  lessonName: string;
  totalClasses: number;
  completedClasses: number;
  remainingClasses: number;
  nextLessonAt: string | null;
}

interface StudentDetails {
  dateOfBirth: string | null;
  gender: string | null;
  licenseNumber: string | null;
  licenseClass: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface DayBookingAccordionEntry {
  booking: BookingItem;
  packagePlan: PackagePlan;
  studentDetails: StudentDetails | null;
}

export function DayBookingsAccordion({
  entries,
  nowMs,
  initialOpenId = "",
  day,
  view,
}: {
  entries: DayBookingAccordionEntry[];
  nowMs: number;
  initialOpenId?: string;
  day: string;
  view: "week" | "month";
}) {
  const [openId, setOpenId] = useState(initialOpenId);

  if (entries.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-soft">Nothing booked on this day.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {entries.map(({ booking, packagePlan, studentDetails }) => {
        const expanded = openId === booking.id;
        return (
          <li key={booking.id} id={`booking-${booking.id}`} className="scroll-mt-6 px-3 py-2 sm:px-4">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`booking-details-${booking.id}`}
              onClick={() => setOpenId((current) => current === booking.id ? "" : booking.id)}
              className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors sm:px-4 ${expanded ? "bg-[#fff9e9]" : "hover:bg-mist"}`}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="text-[14px] font-extrabold text-ink">{formatSlotTime(booking.startsAt)}</span>
                <span className="truncate text-[14px] font-bold text-ink">{booking.studentName}</span>
                <span className="text-[12px] text-soft">{booking.lessonName} · Class {booking.sessionIndex} of {booking.sessionCount}</span>
                <StatusChip status={booking.status} />
              </span>
              <span className="shrink-0 text-[12px] font-extrabold text-gold-deep">{expanded ? "Close −" : "Open details +"}</span>
            </button>

            {expanded && (
              <section id={`booking-details-${booking.id}`} className="grid gap-4 px-3 pb-4 pt-2 sm:px-4">
                <div>
                  <div>
                    <h3 className="text-[14px] font-extrabold text-ink">{booking.studentName} · {booking.lessonName}</h3>
                    <p className="mt-1 text-[12px] font-semibold text-soft">{formatSlotDay(booking.startsAt)} at {formatSlotTime(booking.startsAt)} Pacific · {booking.durationMin} minutes</p>
                    <p className="mt-1 text-[12px] text-soft"><a href={`mailto:${booking.email}`} className="underline underline-offset-2">{booking.email}</a>{booking.phone ? ` · ${booking.phone}` : ""}</p>
                  </div>
                  {studentDetails && <dl className="mt-3 grid gap-x-5 gap-y-2 rounded-lg bg-mist p-3 text-[11.5px] sm:grid-cols-2 lg:grid-cols-3">
                    <div><dt className="text-soft">Date of birth</dt><dd className="font-semibold text-ink">{studentDetails.dateOfBirth || "Not recorded"}</dd></div>
                    <div><dt className="text-soft">Gender</dt><dd className="font-semibold capitalize text-ink">{studentDetails.gender?.replaceAll("_", " ") || "Not recorded"}</dd></div>
                    <div><dt className="text-soft">Driver’s licence</dt><dd className="font-semibold text-ink">{studentDetails.licenseNumber || "Not recorded"}{studentDetails.licenseClass ? ` · Class ${studentDetails.licenseClass}` : ""}</dd></div>
                    <div><dt className="text-soft">Address</dt><dd className="font-semibold text-ink">{[studentDetails.street, studentDetails.city, studentDetails.postalCode].some(Boolean) ? [studentDetails.street, studentDetails.city, studentDetails.province, studentDetails.postalCode].filter(Boolean).join(", ") : "Not recorded"}</dd></div>
                  </dl>}
                </div>
                {booking.notes && <details className="text-[12px] text-soft"><summary className="cursor-pointer font-bold text-ink">Notes</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans leading-relaxed">{booking.notes}</pre></details>}

                <section className="rounded-xl border border-line bg-white p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><h4 className="text-[13px] font-extrabold text-ink">Selected package</h4><p className="mt-0.5 text-[12px] text-soft">{packagePlan.lessonName}</p></div>
                    <p className="rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-extrabold text-gold-deep">{packagePlan.completedClasses} completed · {packagePlan.remainingClasses} remaining of {packagePlan.totalClasses}</p>
                  </div>
                  <p className="mt-2 text-[11.5px] text-soft"><strong className="text-ink">Next lesson:</strong> {packagePlan.nextLessonAt ? `${formatSlotDay(packagePlan.nextLessonAt)} · ${formatSlotTime(packagePlan.nextLessonAt)} Pacific` : "No next lesson scheduled"}</p>
                </section>

                <div className="border-t border-line pt-3">
                   <details className="rounded-xl border border-line bg-white" open={booking.status === "completed" || Boolean(booking.report && !booking.report.rubric_scores)}>
                     <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 sm:px-4">
                       <span><span className="block text-[12.5px] font-extrabold text-ink">Lesson report · Class {booking.sessionIndex} of {booking.sessionCount}</span><span className="mt-0.5 block text-[10.5px] text-soft">{booking.report?.rubric_scores ? "Saved" : "Not saved yet"}</span></span>
                       <span className="text-[11px] font-bold text-gold-deep">Open / close</span>
                     </summary>
                     <div className="border-t border-line p-3 sm:p-4">
                     <p className="mb-3 text-[11px] text-soft">Rate the skills practiced today from 1–10. Section comments and extra notes are optional. This is a school progress report, not an official road-test score.</p>
                     {booking.report && !booking.report.rubric_scores && <p className="mb-3 rounded-lg bg-[#fff9e9] px-3 py-2 text-[11px] font-semibold text-[#735c1e]">This older report can be updated with skill ratings; its saved information will be kept.</p>}
                     <form action={saveTutorLessonReportAction} className="grid gap-3">
                     <input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="view" value={view} />
                     <label className="grid max-w-xs gap-1 text-[11px] font-semibold text-soft">Report date<input required type="date" name="reportDate" defaultValue={booking.report?.assessment_date ?? day} className="rounded border p-2 text-ink" /></label>
                      {TUTOR_REPORT_RUBRIC.map((section) => (
                        <details key={section.key} className="rounded-xl border border-line bg-white">
                          <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-extrabold text-ink">{section.title} <span className="ml-1 text-[10px] font-normal text-soft">{section.items.length} skills</span></summary>
                          <div className="border-t border-line p-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                           {section.items.map((item) => <label key={item.key} className="grid gap-1 text-[11px] font-semibold text-soft">{item.label}<select required name={`score_${item.key}`} defaultValue={booking.report?.rubric_scores?.[item.key] ?? ""} className="min-h-10 rounded-lg border border-line bg-white px-2 text-ink"><option value="" disabled>Select 1–10</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score}</option>)}</select></label>)}
                         </div>
                         <label className="mt-3 grid gap-1 text-[11px] font-semibold text-soft">Comment · {section.title}<textarea name={`comment_${section.key}`} maxLength={2000} rows={2} defaultValue={booking.report?.section_comments?.[section.key] ?? ""} placeholder={`Comment on ${section.title.toLowerCase()}…`} className="rounded-lg border border-line p-2 text-ink" /></label>
                          </div>
                        </details>
                      ))}
                     <div className="grid gap-2 sm:grid-cols-3">
                       <label className="grid gap-1 text-[11px] font-semibold text-soft">Road-test date<input type="date" name="roadTestDate" defaultValue={booking.report?.road_test_date ?? ""} className="rounded border p-2 text-ink" /></label>
                       <label className="grid gap-1 text-[11px] font-semibold text-soft">Test location<input name="location" maxLength={120} defaultValue={booking.report?.road_test_location ?? ""} className="rounded border p-2 text-ink" /></label>
                       <label className="grid gap-1 text-[11px] font-semibold text-soft">Road-test outcome<select name="outcome" defaultValue={booking.report?.road_test_outcome ?? ""} className="rounded border bg-white p-2 text-ink"><option value="">Not recorded</option><option value="passed">Passed</option><option value="not_passed">Not passed</option><option value="not_taken">Not taken</option></select></label>
                     </div>
                     <label className="grid gap-1 text-[11px] font-semibold text-soft">Additional tutor notes<textarea name="notes" maxLength={4000} rows={3} defaultValue={booking.report?.notes ?? ""} className="rounded border p-2 text-ink" /></label>
                      <div className="flex flex-wrap items-center gap-2"><button formNoValidate className="btn-gold rounded-lg px-4 py-2 text-xs font-extrabold">{booking.report ? "Save report" : "Save lesson report"}</button>{booking.report?.rubric_scores && <span className="text-[11px] font-bold text-[#385a22]">Saved · ready to mark complete</span>}</div>
                    </form>
                     </div>
                   </details>
                    <BookingActions
                    bookingId={booking.id}
                     status={booking.status}
                     startsAt={booking.startsAt}
                     durationMin={booking.durationMin}
                     paymentStatus={booking.paymentStatus}
                    nowMs={nowMs}
                   />
                </div>
              </section>
            )}
          </li>
        );
      })}
    </ul>
  );
}
