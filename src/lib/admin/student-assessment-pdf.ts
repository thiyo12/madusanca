import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import type { BookingRecord } from "@/lib/booking/types";
import type { StudentAssessment, StudentProfile } from "@/lib/admin/student-profiles";
import { TUTOR_REPORT_RUBRIC } from "@/lib/admin/tutor-report-rubric";
import { bookingsByCourse } from "@/lib/admin/course-groups";

const W = 612;
const H = 792;
const INK = [0.12, 0.16, 0.19] as const;
const GOLD = [0.83, 0.65, 0.19] as const;
const MUTED = [0.37, 0.41, 0.44] as const;
const GREEN = [0.31, 0.47, 0.20] as const;

function safe(value: string): string {
  const normalized = value
    .replaceAll("\u00a0", " ")
    .replaceAll("·", " | ")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replaceAll("…", "...");
  return normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, " ");
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
  const reportByBooking = latestReportsByBooking(assessments);
  const savedReports = bookings.flatMap((booking) => {
    const report = reportByBooking.get(booking.id);
    return report ? [{ booking, report }] : [];
  });
  const scores = savedReports.flatMap(({ report }) =>
    Object.values(report.rubric_scores ?? {}).filter((score): score is number => typeof score === "number"),
  );
  const average = scores.length
    ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)
    : "Not rated yet";
  const lines: DocumentLine[] = [
    { text: "OVERALL PERFORMANCE", kind: "section" },
    { text: `Overall WDA skill rating: ${average}${scores.length ? "/10" : ""}`, kind: "subheading" },
    { text: `Based on ${savedReports.length} saved lesson report${savedReports.length === 1 ? "" : "s"} and ${scores.length} marked skill${scores.length === 1 ? "" : "s"}.`, kind: "muted" },
    { text: "Category averages", kind: "subheading" },
  ];
  for (const section of TUTOR_REPORT_RUBRIC) {
    const values = savedReports.flatMap(({ report }) =>
      section.items.map((item) => report.rubric_scores?.[item.key]).filter((value): value is number => typeof value === "number"),
    );
    if (values.length) {
      lines.push({
        text: `${section.title}: ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}/10`,
        kind: "score",
        indent: 10,
      });
    }
  }
  if (!scores.length) lines.push({ text: "No skill ratings have been saved yet.", kind: "muted" });

  lines.push({ text: "COURSE-BY-COURSE REPORTS", kind: "section" });
  const reportLookup = new Map(savedReports.map(({ booking, report }) => [booking.id, report]));
  let courseNumber = 0;
  for (const courseBookings of bookingsByCourse(bookings).values()) {
    const courseReports = courseBookings.flatMap((booking) => {
      const report = reportLookup.get(booking.id);
      return report ? [{ booking, report }] : [];
    });
    if (!courseReports.length) continue;
    courseNumber += 1;
    const dates = courseReports.map(({ booking }) => formatSlotDay(booking.startsAt));
    lines.push({ text: `COURSE ${courseNumber}  |  ${courseReports[0]!.booking.lessonName}`, kind: "subheading" });
    lines.push({ text: `${courseReports.length} saved lesson report${courseReports.length === 1 ? "" : "s"}  |  ${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}`, kind: "muted" });
    for (const { booking, report } of courseReports) {
      lines.push({
        text: `Class ${booking.sessionIndex ?? 1}  |  ${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific  |  Assessed: ${report.assessment_date}`,
        kind: "muted",
      });
      appendReportLines(lines, report);
    }
  }
  lines.push({ text: "Ratings use WDA's instructional assessment scale (1–10). This is not an official Canadian or ICBC standard or road-test score.", kind: "muted" });
  return renderDocumentPdf("OVERALL STUDENT REPORT", studentName, generatedAt, lines);
}

interface DocumentLine {
  text: string;
  kind?: "section" | "subheading" | "body" | "score" | "muted";
  indent?: number;
}

/** Professional student assessment report: profile, overall results, and complete saved lesson reports. */
export function createFullStudentRecordPdf(
  profile: StudentProfile,
  generatedAt: Date,
  bookings: BookingRecord[],
  assessments: StudentAssessment[],
): Uint8Array {
  const reportByBooking = latestReportsByBooking(assessments);
  const reports = bookings
    .map((booking) => ({ booking, report: reportByBooking.get(booking.id) }))
    .filter((item): item is { booking: BookingRecord; report: StudentAssessment } => Boolean(item.report));
  const markedScores = reports
    .flatMap(({ report }) => Object.values(report.rubric_scores ?? {}))
    .filter((score): score is number => typeof score === "number");
  const overall = markedScores.length
    ? (markedScores.reduce((sum, score) => sum + score, 0) / markedScores.length).toFixed(1)
    : "Not rated yet";
  const lines: DocumentLine[] = [
    { text: "STUDENT INFORMATION", kind: "section" },
    { text: profile.full_name, kind: "subheading" },
    { text: `Email: ${profile.email}  |  Phone: ${profile.phone || "Not recorded"}` },
    { text: `Date of birth: ${profile.date_of_birth || "Not recorded"}  |  Gender: ${profile.gender?.replaceAll("_", " ") || "Not recorded"}` },
    { text: `Driver licence: ${profile.license_number || "Not recorded"}  |  Class: ${profile.license_class || "Not recorded"}` },
    { text: `Address: ${[profile.street, profile.city, profile.province, profile.postal_code].filter(Boolean).join(", ") || "Not recorded"}` },
    { text: "OVERALL ASSESSMENT", kind: "section" },
    { text: `Overall skill rating: ${overall}${markedScores.length ? "/10" : ""}`, kind: "subheading" },
    { text: `Based on ${reports.length} saved lesson report${reports.length === 1 ? "" : "s"} and ${markedScores.length} marked skill${markedScores.length === 1 ? "" : "s"}.`, kind: "muted" },
    { text: "Category averages", kind: "subheading" },
  ];
  for (const section of TUTOR_REPORT_RUBRIC) {
    const scores = reports.flatMap(({ report }) =>
      section.items.map((item) => report.rubric_scores?.[item.key]).filter((score): score is number => typeof score === "number"),
    );
    if (scores.length) {
      const average = (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1);
      lines.push({ text: `${section.title}: ${average}/10`, kind: "score", indent: 10 });
    }
  }
  if (!markedScores.length) {
    lines.push({ text: "No skill ratings have been saved yet.", kind: "muted" });
  }

  lines.push({ text: "COURSE-BY-COURSE LESSON REPORTS", kind: "section" });
  const reportLookup = new Map(reports.map(({ booking, report }) => [booking.id, report]));
  let courseNumber = 0;
  for (const courseBookings of bookingsByCourse(bookings).values()) {
    const courseReports = courseBookings.flatMap((booking) => {
      const report = reportLookup.get(booking.id);
      return report ? [{ booking, report }] : [];
    });
    if (!courseReports.length) continue;
    courseNumber += 1;
    const dates = courseReports.map(({ booking }) => formatSlotDay(booking.startsAt));
    lines.push({ text: `COURSE ${courseNumber}  |  ${courseReports[0]!.booking.lessonName}`, kind: "subheading" });
    lines.push({ text: `${courseReports.length} saved lesson report${courseReports.length === 1 ? "" : "s"}  |  ${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}`, kind: "muted" });
    for (const { booking, report } of courseReports) {
      lines.push({ text: `Class ${booking.sessionIndex ?? 1}  |  ${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific  |  Assessed: ${report.assessment_date}`, kind: "muted" });
      appendReportLines(lines, report);
    }
  }
  if (!reports.length) lines.push({ text: "No lesson reports have been saved yet.", kind: "muted" });
  lines.push({ text: "Ratings use WDA's instructional assessment scale (1–10). This is not an official Canadian or ICBC standard or road-test score.", kind: "muted" });
  return renderDocumentPdf("LESSON PROGRESS REPORT", profile.full_name, generatedAt, lines);
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
    { text: "STUDENT", kind: "section" },
    { text: profile.full_name, kind: "subheading" },
    { text: `${profile.email}  |  ${profile.phone || "No phone recorded"}` },
    { text: "LESSON ASSESSMENT", kind: "section" },
    { text: booking.lessonName, kind: "subheading" },
    { text: `Class ${booking.sessionIndex ?? 1}  |  Lesson: ${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific  |  Assessed: ${report.assessment_date}`, kind: "muted" },
    { text: `Overall lesson rating: ${average}${scores.length ? "/10" : ""}`, kind: "subheading" },
  ];
  appendReportLines(lines, report);
  lines.push({ text: "Ratings use WDA's instructional assessment scale (1–10). This is not an official Canadian or ICBC standard or road-test score.", kind: "muted" });
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

function appendReportLines(lines: DocumentLine[], report: StudentAssessment): void {
  const hasDetailedRatings = Object.values(report.rubric_scores ?? {}).some((score) => typeof score === "number");
  let foundDetail = false;
  for (const section of TUTOR_REPORT_RUBRIC) {
    const markedItems = section.items.filter((item) => typeof report.rubric_scores?.[item.key] === "number");
    const comment = report.section_comments?.[section.key]?.trim();
    if (markedItems.length || comment) {
      lines.push({ text: section.title, kind: "subheading" });
      foundDetail = true;
    }
    for (const item of markedItems) {
      const score = report.rubric_scores?.[item.key];
      lines.push({ text: `${item.label}: ${score}/10  |  ${item.description}`, kind: "score", indent: 10 });
    }
    if (comment) lines.push({ text: `Instructor comment: ${comment}`, kind: "body", indent: 10 });
  }
  if (!hasDetailedRatings) {
    const legacy = [
      ["Vehicle control", report.vehicle_control], ["Observation", report.observation],
      ["Intersections", report.intersections], ["Lane changes", report.lane_changes],
      ["Speed and space", report.speed_space], ["Parking", report.parking],
      ["Hazard awareness", report.hazard_awareness],
    ].filter((item): item is [string, number] => typeof item[1] === "number");
    if (legacy.length) {
      lines.push({ text: "Previously recorded category ratings (1–5)", kind: "subheading" });
      for (const [label, score] of legacy) lines.push({ text: `${label}: ${score}/5`, kind: "score", indent: 10 });
      foundDetail = true;
    }
  }
  if (!foundDetail) lines.push({ text: "No skill ratings or section comments were recorded for this lesson.", kind: "muted" });
  if (report.road_test_date || report.road_test_location || report.road_test_outcome) {
    lines.push({ text: "ROAD TEST", kind: "subheading" });
    lines.push({ text: `${report.road_test_outcome?.replaceAll("_", " ") ?? "Not recorded"}${report.road_test_date ? `  |  ${report.road_test_date}` : ""}${report.road_test_location ? `  |  ${report.road_test_location}` : ""}`, kind: "body" });
  }
  if (report.notes.trim()) {
    lines.push({ text: "INSTRUCTOR NOTES", kind: "subheading" });
    lines.push({ text: report.notes.trim(), kind: "body" });
  }
}

function renderDocumentPdf(title: string, studentName: string, generatedAt: Date, lines: DocumentLine[]): Uint8Array {
  const pages: Canvas[] = [{ commands: [] }];
  let y = 645;
  for (const line of lines) {
    const kind = line.kind ?? "body";
    const fontSize = kind === "section" ? 11 : kind === "subheading" ? 9 : kind === "muted" ? 7.5 : 8.5;
    const lineGap = kind === "section" ? 18 : kind === "subheading" ? 14 : 11;
    const wrapped = wrap(line.text, kind === "section" ? 86 : 98);
    for (const text of wrapped) {
      if (y < 78) {
        pages.push({ commands: [] });
        y = 645;
      }
      const page = pages.at(-1)!;
      if (kind === "section") {
        page.commands.push(`q 0.96 0.95 0.91 rg 48 ${(y - 4).toFixed(2)} 516 18 re f Q`);
        page.commands.push(`q ${rgb(GOLD)} RG 2 w 48 ${(y - 4).toFixed(2)} m 48 ${(y + 14).toFixed(2)} l S Q`);
      }
      const color = kind === "section" ? INK : kind === "subheading" ? GREEN : MUTED;
      page.commands.push(`BT /${kind === "body" || kind === "muted" ? "F1" : "F2"} ${fontSize} Tf ${rgb(color)} rg 1 0 0 1 ${58 + (line.indent ?? 0)} ${y.toFixed(2)} Tm (${esc(text)}) Tj ET`);
      y -= lineGap;
    }
    if (kind === "section") y -= 4;
  }
  pages.forEach((page, index) => drawHeader(page, title, studentName, generatedAt, index + 1, pages.length));
  return assemble(pages);
}

function drawHeader(page: Canvas, title: string, studentName: string, date: Date, number: number, total: number): void {
  page.commands.push(`${rgb(INK)} rg 0 700 ${W} 92 re f`);
  page.commands.push(`q 76 0 0 49 40 721 cm /Logo Do Q`);
  page.commands.push(`BT /F2 8 Tf 0.74 0.91 0.42 rg 1 0 0 1 130 760 Tm (WISDOM DRIVING ACADEMY) Tj ET`);
  page.commands.push(`BT /F2 17 Tf 1 1 1 rg 1 0 0 1 130 738 Tm (${esc(title)}) Tj ET`);
  page.commands.push(`BT /F2 7 Tf 0.74 0.91 0.42 rg 1 0 0 1 48 680 Tm (STUDENT) Tj ET`);
  page.commands.push(`BT /F1 8 Tf 0.88 0.90 0.91 rg 1 0 0 1 98 680 Tm (${esc(wrap(studentName, 48)[0] ?? studentName)}) Tj ET`);
  page.commands.push(`BT /F2 7 Tf 0.74 0.91 0.42 rg 1 0 0 1 425 680 Tm (REPORT DATE) Tj ET`);
  page.commands.push(`BT /F1 8 Tf 0.88 0.90 0.91 rg 1 0 0 1 495 680 Tm (${esc(date.toISOString().slice(0, 10))}) Tj ET`);
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
