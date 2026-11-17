import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import type { BookingRecord } from "@/lib/booking/types";
import type { StudentAssessment, StudentCourseCompletion, StudentProfile } from "@/lib/admin/student-profiles";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";

const W = 612;
const H = 792;
const INK = [0.12, 0.16, 0.19] as const;
const GOLD = [0.83, 0.65, 0.19] as const;
const MUTED = [0.37, 0.41, 0.44] as const;
const GREEN = [0.31, 0.47, 0.20] as const;

function safe(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
}
function esc(value: string): string { return safe(value).replace(/[\\()]/g, "\\$&"); }
function rgb(values: readonly number[]): string { return values.map((value) => value.toFixed(3)).join(" "); }
function wrap(value: string, limit: number): string[] {
  const words = safe(value).split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > limit) { result.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  return result.length ? result : [""];
}

interface Canvas { commands: string[] }

export function createStudentAssessmentPdf(
  studentName: string,
  generatedAt: Date,
  bookings: BookingRecord[],
  assessments: StudentAssessment[],
): Uint8Array {
  const scoresByBooking = new Map(assessments.filter((item) => item.booking_id).map((item) => [item.booking_id!, item]));
  const completed = bookings.filter((booking) => booking.status === "completed");
  const completedReports = completed.map((booking) => scoresByBooking.get(booking.id)).filter((item): item is StudentAssessment => Boolean(item));
  const allScores = completedReports.flatMap((report) => Object.values(report.rubric_scores ?? {}).filter((score): score is number => typeof score === "number"));
  const overall = allScores.length ? (allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(1) : "—";
  const pages: Canvas[] = [{ commands: [] }, { commands: [] }];
  drawHeader(pages[0]!, "OVERALL RATING", studentName, generatedAt, 1, 2);
  drawHeader(pages[1]!, "DETAILED RATINGS", studentName, generatedAt, 2, 2);

  const p1 = pages[0]!.commands;
  p1.push(`${rgb(INK)} rg 48 550 516 112 re f`);
  p1.push(`BT /F2 11 Tf 1 1 1 rg 1 0 0 1 70 630 Tm (OVERALL COURSE RATING) Tj ET`);
  p1.push(`BT /F2 45 Tf 1 1 1 rg 1 0 0 1 70 572 Tm (${esc(overall)} / 10) Tj ET`);
  p1.push(`BT /F1 9 Tf 1 1 1 rg 1 0 0 1 350 590 Tm (${completedReports.length} completed lesson reports) Tj ET`);
  p1.push(`BT /F1 8 Tf 1 1 1 rg 1 0 0 1 350 574 Tm (Report generated ${generatedAt.toISOString().slice(0, 10)}) Tj ET`);
  p1.push(`BT /F2 10 Tf ${rgb(INK)} rg 1 0 0 1 48 516 Tm (Skill category averages) Tj ET`);
  p1.push(`${rgb(GOLD)} RG 0.8 w 48 507 m 564 507 l S`);
  let y = 485;
  for (const section of TUTOR_REPORT_RUBRIC) {
    const values = completedReports.flatMap((report) => section.items.map((item) => report.rubric_scores?.[item.key]).filter((score): score is number => typeof score === "number"));
    const average = values.length ? (values.reduce((sum, score) => sum + score, 0) / values.length).toFixed(1) : "—";
    p1.push(`BT /F1 9 Tf ${rgb(MUTED)} rg 1 0 0 1 54 ${y} Tm (${esc(section.title)}) Tj ET`);
    p1.push(`BT /F2 10 Tf ${rgb(INK)} rg 1 0 0 1 515 ${y} Tm (${average}/10) Tj ET`);
    y -= 22;
  }
  const summary = completed.length
    ? `${completed.length} completed lesson${completed.length === 1 ? "" : "s"}; average is based only on saved ratings from completed lessons.`
    : "No completed lesson reports are available for an overall rating yet.";
  p1.push(`BT /F1 8 Tf ${rgb(MUTED)} rg 1 0 0 1 48 74 Tm (${esc(summary)}) Tj ET`);

  const p2 = pages[1]!.commands;
  const detailLines: Array<{ text: string; bold?: boolean; indent?: number }> = [];
  const orderedReports = bookings.map((booking) => ({ booking, report: scoresByBooking.get(booking.id) })).filter((item): item is { booking: BookingRecord; report: StudentAssessment } => Boolean(item.report));
  for (const { booking, report } of orderedReports) {
    detailLines.push({ text: `${booking.lessonName} · ${formatSlotDay(booking.startsAt)} ${formatSlotTime(booking.startsAt)} Pacific · Assessed ${report.assessment_date}`, bold: true });
    for (const section of TUTOR_REPORT_RUBRIC) {
      const marks = section.items.flatMap((item) => {
        const score = report.rubric_scores?.[item.key];
        return typeof score === "number" ? [`${item.label} ${score}/10 — ${item.description}`] : [];
      });
      const comment = report.section_comments?.[section.key]?.trim();
      if (marks.length) detailLines.push({ text: `${section.title}: ${marks.join(" · ")}`, indent: 10 });
      if (comment) detailLines.push({ text: `${section.title} instructor comment: ${comment}`, indent: 10 });
    }
    if (report.road_test_date || report.road_test_outcome || report.road_test_location) {
      detailLines.push({ text: `Road test: ${report.road_test_outcome?.replaceAll("_", " ") ?? "Not recorded"}${report.road_test_date ? ` · ${report.road_test_date}` : ""}${report.road_test_location ? ` · ${report.road_test_location}` : ""}`, indent: 10 });
    }
    if (report.notes.trim()) detailLines.push({ text: `Instructor notes: ${report.notes.trim()}`, indent: 10 });
  }
  if (!detailLines.length) detailLines.push({ text: "No saved lesson ratings are available yet." });

  const wrapped = detailLines.map((line) => ({ ...line, lines: wrap(line.text, line.bold ? 91 : 99) }));
  const available = 620;
  const totalLines = wrapped.reduce((sum, item) => sum + item.lines.length, 0);
  const leading = Math.max(5, Math.min(10, available / totalLines));
  let detailY = 680;
  for (const item of wrapped) {
    for (const text of item.lines) {
      p2.push(`BT /${item.bold ? "F2" : "F1"} ${item.bold ? 8 : 6.8} Tf ${rgb(item.bold ? GREEN : MUTED)} rg 1 0 0 1 ${48 + (item.indent ?? 0)} ${detailY.toFixed(2)} Tm (${esc(text)}) Tj ET`);
      detailY -= leading;
    }
    if (item.bold) detailY -= leading * 0.4;
  }
  return assemble(pages);
}

interface DocumentLine { text: string; bold?: boolean; indent?: number }

/** Full private admin export: student profile, bookings, every lesson report, and overall ratings. */
export function createFullStudentRecordPdf(
  profile: StudentProfile,
  generatedAt: Date,
  bookings: BookingRecord[],
  assessments: StudentAssessment[],
  completions: StudentCourseCompletion[] = [],
): Uint8Array {
  const reportByBooking = latestReportsByBooking(assessments);
  const completedReports = bookings
    .filter((booking) => booking.status === "completed")
    .map((booking) => reportByBooking.get(booking.id))
    .filter((report): report is StudentAssessment => Boolean(report));
  const allCompletedScores = completedReports.flatMap((report) =>
    Object.values(report.rubric_scores ?? {}).filter((score): score is number => typeof score === "number"),
  );
  const overall = allCompletedScores.length
    ? (allCompletedScores.reduce((sum, score) => sum + score, 0) / allCompletedScores.length).toFixed(1)
    : "Not available yet";
  const lines: DocumentLine[] = [
    { text: "STUDENT DETAILS", bold: true },
    { text: `Full legal name: ${profile.full_name}` },
    { text: `First name: ${profile.first_name || "Not recorded"} · Last name: ${profile.last_name || "Not recorded"}` },
    { text: `Email: ${profile.email} · Phone: ${profile.phone || "Not recorded"}` },
    { text: `Date of birth: ${profile.date_of_birth || "Not recorded"} · Gender: ${profile.gender?.replaceAll("_", " ") || "Not recorded"}` },
    { text: `Driver licence: ${profile.license_number || "Not recorded"} · Class: ${profile.license_class || "Not recorded"}` },
    { text: `Address: ${[profile.street, profile.city, profile.province, profile.postal_code].filter(Boolean).join(", ") || "Not recorded"}` },
    { text: "OVERALL PROGRESS", bold: true },
    { text: `Overall rating: ${overall}/10 · Based on ${completedReports.length} completed lesson report${completedReports.length === 1 ? "" : "s"}.` },
    { text: "Category averages (completed lessons only):" },
  ];
  for (const section of TUTOR_REPORT_RUBRIC) {
    const scores = completedReports.flatMap((report) =>
      section.items.map((item) => report.rubric_scores?.[item.key]).filter((score): score is number => typeof score === "number"),
    );
    const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "—";
    lines.push({ text: `${section.title}: ${average}/10`, indent: 10 });
  }
  if (!completedReports.length) {
    lines.push({ text: "No completed lesson reports with saved skill ratings yet.", indent: 10 });
  }

  const courseGroups = new Map<string, BookingRecord[]>();
  for (const booking of bookings) {
    const key = booking.packageId ?? booking.id;
    courseGroups.set(key, [...(courseGroups.get(key) ?? []), booking]);
  }
  if (courseGroups.size) lines.push({ text: "COURSE COMPLETION", bold: true });
  for (const [key, sessions] of courseGroups) {
    const completion = completions.find((item) => item.course_key === key);
    const completedCount = completion?.completed_lessons ?? sessions.filter((item) => item.status === "completed").length;
    const expectedCount = completion?.expected_lessons ?? Math.max(...sessions.map((item) => item.sessionCount ?? sessions.length));
    lines.push({
      text: `${sessions[0]?.lessonName ?? "Driving course"}: ${completedCount} of ${expectedCount} lessons completed${completion ? ` · ${completion.ended_early ? "ended early" : "course complete"} · closed ${completion.finished_at}` : " · in progress"}`,
      indent: 10,
    });
  }
  lines.push({ text: "BOOKING HISTORY", bold: true });
  for (const booking of [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    lines.push({ text: `${booking.reference} · ${booking.lessonName} · Class ${booking.sessionIndex ?? 1} of ${booking.sessionCount ?? 1}`, bold: true });
    lines.push({ text: `${formatSlotDay(booking.startsAt)} ${formatSlotTime(booking.startsAt)}–${formatSlotTime(booking.endsAt)} Pacific · ${booking.durationMin} minutes · ${booking.status.replaceAll("_", " ")}`, indent: 10 });
    lines.push({ text: `Payment: ${booking.paymentStatus ?? "due"} · $${booking.packagePriceCad ?? booking.priceCad} CAD${booking.stripeSubtotalCad != null ? ` · subtotal $${booking.stripeSubtotalCad} · tax $${booking.stripeTaxCad ?? 0} · total $${booking.stripeTotalCad ?? booking.priceCad} ${booking.stripeCurrency ?? "CAD"}` : ""}`, indent: 10 });
    if (booking.chequeStatus && booking.chequeStatus !== "none") {
      lines.push({ text: `Cheque: ${booking.chequeStatus}${booking.chequeReference ? ` · ${booking.chequeReference}` : ""}${booking.chequeReceivedAt ? ` · received ${booking.chequeReceivedAt}` : ""}`, indent: 10 });
    }
    if (booking.stripePaymentIntentId) lines.push({ text: `Payment reference: ${booking.stripePaymentIntentId}`, indent: 10 });
    if (booking.stripeInvoiceId) lines.push({ text: `Invoice reference: ${booking.stripeInvoiceId}`, indent: 10 });
    if (booking.cancellationReason) lines.push({ text: `Cancellation reason: ${booking.cancellationReason}`, indent: 10 });
    if (booking.notes.trim()) lines.push({ text: `Booking notes: ${booking.notes.trim()}`, indent: 10 });
    const report = reportByBooking.get(booking.id);
    if (report) {
      lines.push({ text: `LESSON REPORT · Assessed ${report.assessment_date}`, bold: true, indent: 10 });
      appendReportLines(lines, report, 20);
    } else if (booking.status === "completed") {
      lines.push({ text: "No lesson report saved.", indent: 10 });
    }
  }
  if (!bookings.length) lines.push({ text: "No bookings on record." });
  lines.push({ text: "School teaching assessment only; not an official ICBC form or score." });
  return renderDocumentPdf("FULL STUDENT RECORD", profile.full_name, generatedAt, lines);
}

/** Standalone, printable PDF for one saved lesson report. */
export function createTutorLessonReportPdf(
  profile: StudentProfile,
  booking: BookingRecord,
  report: StudentAssessment,
  generatedAt: Date,
): Uint8Array {
  const scores = Object.values(report.rubric_scores ?? {}).filter((score): score is number => typeof score === "number");
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "Not rated";
  const lines: DocumentLine[] = [
    { text: "STUDENT", bold: true },
    { text: `${profile.full_name} · ${profile.email} · ${profile.phone || "No phone recorded"}` },
    { text: "LESSON", bold: true },
    { text: `${booking.reference} · ${booking.lessonName} · Class ${booking.sessionIndex ?? 1} of ${booking.sessionCount ?? 1}` },
    { text: `${formatSlotDay(booking.startsAt)} ${formatSlotTime(booking.startsAt)} Pacific · ${booking.durationMin} minutes · ${booking.status.replaceAll("_", " ")}` },
    { text: `Report date: ${report.assessment_date} · Overall lesson rating: ${average}/10` },
  ];
  appendReportLines(lines, report, 0);
  lines.push({ text: "School teaching assessment only; not an official ICBC form or score." });
  return renderDocumentPdf("LESSON REPORT", profile.full_name, generatedAt, lines);
}

function latestReportsByBooking(assessments: StudentAssessment[]): Map<string, StudentAssessment> {
  const reports = new Map<string, StudentAssessment>();
  for (const report of assessments) {
    if (!report.booking_id) continue;
    const current = reports.get(report.booking_id);
    const timestamp = (item: StudentAssessment) => item.updated_at ?? item.assessment_date;
    if (!current || timestamp(report).localeCompare(timestamp(current)) > 0) reports.set(report.booking_id, report);
  }
  return reports;
}

function appendReportLines(lines: DocumentLine[], report: StudentAssessment, indent: number): void {
  const hasDetailedRatings = Object.values(report.rubric_scores ?? {}).some((score) => typeof score === "number");
  for (const section of TUTOR_REPORT_RUBRIC) {
    lines.push({ text: section.title, bold: true, indent });
    for (const item of section.items) {
      const score = report.rubric_scores?.[item.key];
      lines.push({ text: `${item.label}: ${typeof score === "number" ? `${score}/10` : "Not marked"} — ${item.description}`, indent: indent + 10 });
    }
    const comment = report.section_comments?.[section.key]?.trim();
    if (comment) lines.push({ text: `Instructor comment: ${comment}`, indent: indent + 10 });
  }
  if (!hasDetailedRatings) {
    const legacy = [
      ["Vehicle control", report.vehicle_control], ["Observation", report.observation],
      ["Intersections", report.intersections], ["Lane changes", report.lane_changes],
      ["Speed and space", report.speed_space], ["Parking", report.parking],
      ["Hazard awareness", report.hazard_awareness],
    ].filter((item): item is [string, number] => typeof item[1] === "number");
    if (legacy.length) {
      lines.push({ text: "Previously recorded category ratings · 1–5", bold: true, indent });
      for (const [label, score] of legacy) lines.push({ text: `${label}: ${score}/5`, indent: indent + 10 });
    }
  }
  if (report.road_test_date || report.road_test_location || report.road_test_outcome) {
    lines.push({ text: `Road test: ${report.road_test_outcome?.replaceAll("_", " ") ?? "Not recorded"}${report.road_test_date ? ` · ${report.road_test_date}` : ""}${report.road_test_location ? ` · ${report.road_test_location}` : ""}`, indent });
  }
  if (report.notes.trim()) lines.push({ text: `Additional tutor notes: ${report.notes.trim()}`, indent });
}

function renderDocumentPdf(title: string, studentName: string, generatedAt: Date, lines: DocumentLine[]): Uint8Array {
  const pages: Canvas[] = [{ commands: [] }];
  let y = 666;
  for (const line of lines) {
    const fontSize = line.bold ? 9 : 7.5;
    const wrapped = wrap(line.text, line.bold ? 88 : 104);
    for (const text of wrapped) {
      if (y < 68) {
        pages.push({ commands: [] });
        y = 666;
      }
      pages.at(-1)!.commands.push(
        `BT /${line.bold ? "F2" : "F1"} ${fontSize} Tf ${rgb(line.bold ? INK : MUTED)} rg 1 0 0 1 ${48 + (line.indent ?? 0)} ${y.toFixed(2)} Tm (${esc(text)}) Tj ET`,
      );
      y -= line.bold ? 13 : 10;
    }
    if (line.bold) y -= 3;
  }
  pages.forEach((page, index) => drawHeader(page, title, studentName, generatedAt, index + 1, pages.length));
  return assemble(pages);
}

function drawHeader(page: Canvas, title: string, studentName: string, date: Date, number: number, total: number): void {
  page.commands.push(`${rgb(INK)} rg 0 700 ${W} 92 re f`);
  page.commands.push(`q 58 0 0 38 47 724 cm /Logo Do Q`);
  page.commands.push(`BT /F2 8 Tf 0.74 0.91 0.42 rg 1 0 0 1 116 760 Tm (WISDOM DRIVING ACADEMY) Tj ET`);
  page.commands.push(`BT /F2 17 Tf 1 1 1 rg 1 0 0 1 116 738 Tm (${esc(title)}) Tj ET`);
  page.commands.push(`BT /F1 8 Tf 0.88 0.90 0.91 rg 1 0 0 1 48 680 Tm (Student: ${esc(studentName)}  |  Report date: ${date.toISOString().slice(0, 10)}) Tj ET`);
  page.commands.push(`${rgb(GOLD)} rg 0 696 ${W} 4 re f`);
  page.commands.push(`${rgb(MUTED)} RG 0.6 w 48 48 m 564 48 l S`);
  page.commands.push(`BT /F1 7 Tf ${rgb(MUTED)} rg 1 0 0 1 48 34 Tm (School teaching assessment only; not an official ICBC score.) Tj ET`);
  page.commands.push(`BT /F1 7 Tf ${rgb(MUTED)} rg 1 0 0 1 500 34 Tm (PAGE ${number} OF ${total}) Tj ET`);
}

function assemble(pages: Canvas[]): Uint8Array {
  const logo = readFileSync(resolve(process.cwd(), "public/wisdom-logo-print.jpg"));
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"), Buffer.alloc(0),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 938 /Height 608 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`, "ascii"), logo, Buffer.from("\nendstream", "ascii")]),
  ];
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length + 1, contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = Buffer.from(page.commands.join("\n"), "ascii");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >> /Contents ${contentId} 0 R >>`, "ascii"));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"), stream, Buffer.from("\nendstream", "ascii")]));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii");
  const chunks = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "binary")];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "ascii"), object, Buffer.from("\nendobj\n", "ascii")]); chunks.push(chunk); length += chunk.length; });
  const xrefOffset = length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "ascii"));
  return new Uint8Array(Buffer.concat(chunks));
}
