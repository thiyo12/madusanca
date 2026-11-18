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
    { text: `Across ${bookings.length} booked lesson${bookings.length === 1 ? "" : "s"}: ${savedReports.length} saved report${savedReports.length === 1 ? "" : "s"} and ${scores.length} marked skill${scores.length === 1 ? "" : "s"}.`, kind: "muted" },
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
    if (!courseBookings.length) continue;
    courseNumber += 1;
    const savedCourseReports = courseBookings.filter((booking) => reportLookup.has(booking.id));
    const dates = courseBookings.map((booking) => formatSlotDay(booking.startsAt));
    lines.push({ text: `COURSE ${courseNumber}  |  ${courseBookings[0]!.lessonName}`, kind: "subheading" });
    lines.push({
      text: `${courseBookings.length} booked lesson${courseBookings.length === 1 ? "" : "s"} · ${savedCourseReports.length} report${savedCourseReports.length === 1 ? "" : "s"} saved · ${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}`,
      kind: "muted",
    });
    for (const booking of courseBookings) {
      const report = reportLookup.get(booking.id);
      lines.push({
        text: `Class ${booking.sessionIndex ?? 1}  |  ${booking.lessonName}  |  ${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific  |  ${bookingStatusLabel(booking.status)}`,
        kind: "muted",
      });
      if (report) {
        lines.push({ text: `Assessed: ${report.assessment_date}`, kind: "muted", indent: 10 });
        appendReportLines(lines, report);
      } else {
        lines.push({ text: "Assessment not yet recorded.", kind: "muted", indent: 10 });
      }
    }
  }
  lines.push({ text: "Ratings use WDA's instructional assessment scale (1–10). This is not an official Canadian or ICBC standard or road-test score.", kind: "muted" });
  lines.push({ kind: "pageBreak" });
  lines.push({ text: "FINAL OVERALL SCORE", kind: "section" });
  lines.push({ text: `${average}${scores.length ? "/10" : ""}`, kind: "finalScore" });
  lines.push({
    text: `Calculated from ${scores.length} saved skill rating${scores.length === 1 ? "" : "s"} across ${savedReports.length} lesson report${savedReports.length === 1 ? "" : "s"}.`,
    kind: "muted",
  });
  return renderDocumentPdf("OVERALL STUDENT REPORT", studentName, generatedAt, lines);
}

interface DocumentLine {
  text?: string;
  kind?: "section" | "subheading" | "body" | "score" | "muted" | "tableHeader" | "tableRow" | "spacer" | "pageBreak" | "finalScore";
  indent?: number;
  cells?: string[];
  table?: "details" | "scores";
  gap?: number;
}

function bookingStatusLabel(status: string): string {
  return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
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
    { kind: "tableRow", table: "details", cells: ["Email", profile.email] },
    { kind: "tableRow", table: "details", cells: ["Phone", profile.phone || "Not recorded"] },
    { kind: "tableRow", table: "details", cells: ["Date of birth", profile.date_of_birth || "Not recorded"] },
    { kind: "tableRow", table: "details", cells: ["Gender", profile.gender?.replaceAll("_", " ") || "Not recorded"] },
    { kind: "tableRow", table: "details", cells: ["Driver licence", profile.license_number || "Not recorded"] },
    { kind: "tableRow", table: "details", cells: ["Licence class", profile.license_class || "Not recorded"] },
    { kind: "tableRow", table: "details", cells: ["Address", [profile.street, profile.city, profile.province, profile.postal_code].filter(Boolean).join(", ") || "Not recorded"] },
    { kind: "spacer", gap: 20 },
    { text: "OVERALL ASSESSMENT", kind: "section" },
    { text: `Overall skill rating: ${overall}${markedScores.length ? "/10" : ""}`, kind: "subheading" },
    { text: `Across ${bookings.length} booked lesson${bookings.length === 1 ? "" : "s"}: ${reports.length} saved report${reports.length === 1 ? "" : "s"} and ${markedScores.length} marked skill${markedScores.length === 1 ? "" : "s"}.`, kind: "muted" },
    { text: "Category averages", kind: "subheading" },
  ];
  if (markedScores.length) {
    lines.push({ kind: "tableHeader", table: "details", cells: ["Category", "Average rating"] });
  }
  for (const section of TUTOR_REPORT_RUBRIC) {
    const scores = reports.flatMap(({ report }) =>
      section.items.map((item) => report.rubric_scores?.[item.key]).filter((score): score is number => typeof score === "number"),
    );
    if (scores.length) {
      const average = (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1);
      lines.push({ kind: "tableRow", table: "details", cells: [section.title, `${average}/10`] });
    }
  }
  if (!markedScores.length) {
    lines.push({ text: "No skill ratings have been saved yet.", kind: "muted" });
  }

  lines.push({ text: "COURSE-BY-COURSE LESSON REPORTS", kind: "section" });
  const reportLookup = new Map(reports.map(({ booking, report }) => [booking.id, report]));
  let courseNumber = 0;
  for (const courseBookings of bookingsByCourse(bookings).values()) {
    if (!courseBookings.length) continue;
    courseNumber += 1;
    const savedCourseReports = courseBookings.filter((booking) => reportLookup.has(booking.id));
    const dates = courseBookings.map((booking) => formatSlotDay(booking.startsAt));
    lines.push({ text: `COURSE ${courseNumber}  |  ${courseBookings[0]!.lessonName}`, kind: "subheading" });
    lines.push({
      text: `${courseBookings.length} booked lesson${courseBookings.length === 1 ? "" : "s"} · ${savedCourseReports.length} report${savedCourseReports.length === 1 ? "" : "s"} saved · ${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}`,
      kind: "muted",
    });
    for (const booking of courseBookings) {
      const report = reportLookup.get(booking.id);
      lines.push({ kind: "tableRow", table: "details", cells: ["Lesson", booking.lessonName] });
      lines.push({ kind: "tableRow", table: "details", cells: ["Class", String(booking.sessionIndex ?? 1)] });
      lines.push({ kind: "tableRow", table: "details", cells: ["Lesson date and time", `${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific`] });
      lines.push({ kind: "tableRow", table: "details", cells: ["Booking status", bookingStatusLabel(booking.status)] });
      if (report) {
        lines.push({ kind: "tableRow", table: "details", cells: ["Assessed", report.assessment_date] });
        appendReportLines(lines, report);
      } else {
        lines.push({ text: "Assessment not yet recorded.", kind: "muted" });
      }
    }
  }
  if (!reports.length) lines.push({ text: "No lesson reports have been saved yet.", kind: "muted" });
  lines.push({ text: "Ratings use WDA's instructional assessment scale (1–10). This is not an official Canadian or ICBC standard or road-test score.", kind: "muted" });
  lines.push({ kind: "pageBreak" });
  lines.push({ text: "FINAL OVERALL SCORE", kind: "section" });
  lines.push({ text: `${overall}${markedScores.length ? "/10" : ""}`, kind: "finalScore" });
  lines.push({
    text: `Calculated from ${markedScores.length} saved skill rating${markedScores.length === 1 ? "" : "s"} across ${reports.length} lesson report${reports.length === 1 ? "" : "s"}.`,
    kind: "muted",
  });
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
    { kind: "tableRow", table: "details", cells: ["Email", profile.email] },
    { kind: "tableRow", table: "details", cells: ["Phone", profile.phone || "No phone recorded"] },
    { kind: "spacer", gap: 20 },
    { text: "LESSON INFORMATION", kind: "section" },
    { kind: "tableRow", table: "details", cells: ["Lesson", booking.lessonName] },
    { kind: "tableRow", table: "details", cells: ["Class", String(booking.sessionIndex ?? 1)] },
    { kind: "tableRow", table: "details", cells: ["Lesson date and time", `${formatSlotDay(booking.startsAt)} at ${formatSlotTime(booking.startsAt)} Pacific`] },
    { kind: "tableRow", table: "details", cells: ["Assessment date", report.assessment_date] },
    { kind: "spacer", gap: 20 },
    { text: "LESSON ASSESSMENT", kind: "section" },
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
      if (markedItems.length) {
        lines.push({ kind: "tableHeader", table: "scores", cells: ["Skill", "Rating", "Assessment focus"] });
      }
      foundDetail = true;
    }
    for (const item of markedItems) {
      const score = report.rubric_scores?.[item.key];
      lines.push({ kind: "tableRow", table: "scores", cells: [item.label, `${score}/10`, item.description] });
    }
    if (comment) lines.push({ kind: "tableRow", table: "details", cells: ["Instructor comment", comment] });
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
      lines.push({ kind: "tableHeader", table: "details", cells: ["Category", "Rating"] });
      for (const [label, score] of legacy) lines.push({ kind: "tableRow", table: "details", cells: [label, `${score}/5`] });
      foundDetail = true;
    }
  }
  if (!foundDetail) lines.push({ text: "No skill ratings or section comments were recorded for this lesson.", kind: "muted" });
  if (report.road_test_date || report.road_test_location || report.road_test_outcome) {
    lines.push({ text: "ROAD TEST", kind: "subheading" });
    lines.push({ kind: "tableRow", table: "details", cells: ["Outcome", report.road_test_outcome?.replaceAll("_", " ") ?? "Not recorded"] });
    if (report.road_test_date) lines.push({ kind: "tableRow", table: "details", cells: ["Test date", report.road_test_date] });
    if (report.road_test_location) lines.push({ kind: "tableRow", table: "details", cells: ["Location", report.road_test_location] });
  }
  if (report.notes.trim()) {
    lines.push({ text: "INSTRUCTOR NOTES", kind: "subheading" });
    lines.push({ kind: "tableRow", table: "details", cells: ["Notes", report.notes.trim()] });
  }
}

function renderDocumentPdf(title: string, studentName: string, generatedAt: Date, lines: DocumentLine[]): Uint8Array {
  const pages: Canvas[] = [{ commands: [] }];
  let y = 645;
  let tableRowNumber = 0;
  let afterTable = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const kind = line.kind ?? "body";
    if (kind === "spacer") {
      if (afterTable) y -= 10;
      afterTable = false;
      y -= line.gap ?? 14;
      continue;
    }
    if (kind === "pageBreak") {
      if (pages.at(-1)!.commands.length) pages.push({ commands: [] });
      y = 645;
      afterTable = false;
      continue;
    }
    if (kind === "tableHeader" || kind === "tableRow") {
      y = drawTableLine(pages, y, line, kind === "tableHeader", tableRowNumber);
      if (kind === "tableRow") tableRowNumber += 1;
      afterTable = true;
      continue;
    }
    if (afterTable) y -= 10;
    afterTable = false;
    const nextLine = lines[lineIndex + 1];
    if (
      (kind === "section" || kind === "subheading")
      && (nextLine?.kind === "tableHeader" || nextLine?.kind === "tableRow")
      && y - 38 < 78
    ) {
      pages.push({ commands: [] });
      y = 645;
    }
    if (kind === "finalScore") {
      if (y - 52 < 78) {
        pages.push({ commands: [] });
        y = 645;
      }
      const page = pages.at(-1)!;
      const bottom = y - 48;
      page.commands.push(`q 0.94 0.97 0.91 rg 48 ${bottom.toFixed(2)} 516 48 re f Q`);
      page.commands.push(`q ${rgb(GREEN)} RG 1 w 48 ${bottom.toFixed(2)} 516 48 re S Q`);
      page.commands.push(`BT /F2 8 Tf ${rgb(INK)} rg 1 0 0 1 62 ${(y - 16).toFixed(2)} Tm (Overall WDA skill rating) Tj ET`);
      page.commands.push(`BT /F2 21 Tf ${rgb(GREEN)} rg 1 0 0 1 62 ${(y - 39).toFixed(2)} Tm (${esc(line.text ?? "")}) Tj ET`);
      y = bottom - 10;
      continue;
    }
    const fontSize = kind === "section" ? 11 : kind === "subheading" ? 9 : kind === "muted" ? 7.5 : 8.5;
    const lineGap = kind === "section" ? 20 : kind === "subheading" ? 16 : kind === "muted" ? 13 : 14;
    const wrapped = wrap(line.text ?? "", kind === "section" ? 86 : 98);
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

function drawTableLine(pages: Canvas[], startY: number, line: DocumentLine, header: boolean, rowNumber: number): number {
  const cells = line.cells ?? [];
  const widths = line.table === "scores" ? [154, 64, 298] : [124, 392];
  const fontSize = header ? 7.5 : 8;
  const lineHeight = 10.5;
  const padding = 6;
  const wrapped = cells.map((cell, index) =>
    wrap(cell, Math.max(10, Math.floor((widths[index]! - padding * 2) / (fontSize * 0.52)))),
  );
  const maxLines = Math.max(1, ...wrapped.map((cellLines) => cellLines.length));
  let offset = 0;
  let y = startY;
  while (offset < maxLines) {
    if (y - lineHeight - padding * 2 < 78) {
      pages.push({ commands: [] });
      y = 645;
    }
    const pageLineCapacity = Math.max(1, Math.floor((y - 78 - padding * 2) / lineHeight));
    const chunkLines = Math.min(maxLines - offset, pageLineCapacity);
    const height = chunkLines * lineHeight + padding * 2;
    const page = pages.at(-1)!;
    const bottom = y - height;
    const fill = header ? INK : rowNumber % 2 === 0 ? [0.95, 0.96, 0.97] as const : [1, 1, 1] as const;
    page.commands.push(`q ${rgb(fill)} rg 48 ${bottom.toFixed(2)} 516 ${height.toFixed(2)} re f Q`);
    page.commands.push(`q 0.82 0.85 0.86 RG 0.45 w 48 ${bottom.toFixed(2)} 516 ${height.toFixed(2)} re S Q`);
    let x = 48;
    for (let column = 0; column < widths.length; column += 1) {
      const columnWidth = widths[column]!;
      if (column > 0) {
        page.commands.push(`q 0.82 0.85 0.86 RG 0.45 w ${x.toFixed(2)} ${bottom.toFixed(2)} m ${x.toFixed(2)} ${y.toFixed(2)} l S Q`);
      }
      const cellLines = wrapped[column] ?? [""];
      const continuedLabel = offset > 0 && column === 0 && line.table === "details" && cellLines.length <= offset
        ? [`${cells[0] ?? ""} (continued)`]
        : null;
      const visibleLines = continuedLabel ?? cellLines.slice(offset, offset + chunkLines);
      const color = header ? "1 1 1" : rgb(column === 0 ? INK : MUTED);
      const font = header || column === 0 ? "F2" : "F1";
      for (let index = 0; index < visibleLines.length; index += 1) {
        const value = visibleLines[index]!;
        const textX = line.table === "scores" && column === 1
          ? x + Math.max(padding, (columnWidth - value.length * fontSize * 0.5) / 2)
          : x + padding;
        const baseline = y - padding - fontSize - index * lineHeight;
        page.commands.push(`BT /${font} ${fontSize} Tf ${color} rg 1 0 0 1 ${textX.toFixed(2)} ${baseline.toFixed(2)} Tm (${esc(value)}) Tj ET`);
      }
      x += columnWidth;
    }
    y = bottom - 1;
    offset += chunkLines;
    if (offset < maxLines) {
      pages.push({ commands: [] });
      y = 645;
    }
  }
  return y - 3;
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
