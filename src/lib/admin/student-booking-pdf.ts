import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BookingRecord, BookingStudentDetails } from "../booking/types";
import { formatSlotDay, formatSlotTime } from "../booking/format.ts";
import { pickupLocation } from "./student-record-format.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 48;
const RIGHT = PAGE_W - 48;
const DARK = [0.12, 0.16, 0.19] as const;
const GOLD = [0.83, 0.65, 0.19] as const;
const GREEN = [0.31, 0.47, 0.20] as const;
const MUTED = [0.37, 0.41, 0.44] as const;
const PALE = [0.96, 0.97, 0.95] as const;

function pdfSafeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
}

function escapePdfString(value: string): string {
  return pdfSafeText(value).replace(/[\\()]/g, "\\$&");
}

function wrap(value: string, width: number): string[] {
  const words = pdfSafeText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function color(color: readonly number[]): string {
  return color.map((value) => value.toFixed(3)).join(" ");
}

function paymentLabel(booking: BookingRecord): string {
  const status = booking.paymentStatus ?? "due";
  const amount = booking.packagePriceCad ?? booking.priceCad;
  return `${status.toUpperCase()}  |  $${amount.toFixed(2)} CAD`;
}

function studentNotes(notes: string): string[] {
  return notes.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(first name|last name|licence class|license class|pickup address)\s*:/i.test(line))
    .filter((line) => !/^booking created by admin\b/i.test(line))
    .map((line) => line.replace(/^student notes\s*:\s*/i, "").trim())
    .filter(Boolean);
}

interface PageCanvas { commands: string[]; y: number; number: number }

function createStudentBookingPdf(
  bookings: BookingRecord[],
  generatedAt: Date,
  studentDetails?: BookingStudentDetails | null,
  progress: string[] = [],
): Uint8Array {
  const first = bookings[0];
  if (!first) return assemblePdf([makeEmptyPage()]);

  const pages: PageCanvas[] = [];
  let page = newPage();
  pages.push(page);

  function newPage(): PageCanvas {
    const result: PageCanvas = { commands: [], y: 680, number: pages.length + 1 };
    drawHeader(result, first, generatedAt);
    return result;
  }
  function ensureSpace(height: number): void {
    if (page.y - height < 62) {
      page = newPage();
      pages.push(page);
    }
  }
  function text(value: string, x: number, y: number, size = 9, font = "F1", fill: readonly number[] = MUTED): void {
    page.commands.push(`BT /${font} ${size} Tf ${color(fill)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(value)}) Tj ET`);
  }
  function rule(y: number, fill: readonly number[] = [0.87, 0.89, 0.88]): void {
    page.commands.push(`${color(fill)} RG 0.7 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
  }
  function rect(x: number, y: number, w: number, h: number, fill: readonly number[], stroke?: readonly number[]): void {
    page.commands.push(`${color(fill)} rg ${x} ${y} ${w} ${h} re f`);
    if (stroke) page.commands.push(`${color(stroke)} RG 0.7 w ${x} ${y} ${w} ${h} re S`);
  }
  function paragraph(value: string, x: number, size = 9, width = 88, leading = 13, font = "F1", fill: readonly number[] = MUTED): number {
    const lines = wrap(value, width);
    ensureSpace(lines.length * leading + 3);
    for (const line of lines) {
      text(line, x, page.y, size, font, fill);
      page.y -= leading;
    }
    return lines.length * leading;
  }
  function sectionTitle(title: string): void {
    ensureSpace(29);
    page.y -= 2;
    text(title.toUpperCase(), LEFT, page.y, 9, "F2", DARK);
    rule(page.y - 7, GOLD);
    page.y -= 20;
  }

  // Student identity card
  rect(LEFT, 603, RIGHT - LEFT, 61, PALE, [0.88, 0.90, 0.88]);
  text("STUDENT", LEFT + 13, 647, 7, "F2", GREEN);
  text(pdfSafeText(first.studentName), LEFT + 13, 629, 15, "F2", DARK);
  text(`${first.email}   |   ${first.phone || "Phone not recorded"}`, LEFT + 13, 613, 8, "F1", MUTED);
  page.y = 585;
  sectionTitle("Student details");
  const detailRows = studentDetails ? [
    ["Date of birth", studentDetails.dateOfBirth],
    ["Gender", studentDetails.gender.replaceAll("_", " ")],
    ["Driver's licence", studentDetails.licenseNumber],
  ] : [];
  detailRows.forEach(([label, value], index) => {
    const col = index % 3;
    const x = LEFT + col * 174;
    text(label.toUpperCase(), x, page.y, 6.5, "F2", MUTED);
    text(pdfSafeText(value), x, page.y - 13, 9, "F2", DARK);
    if (col === 2) page.y -= 31;
  });
  if (detailRows.length % 3 !== 0) page.y -= 31;

  sectionTitle("Lesson history");
  bookings.forEach((booking, index) => {
    ensureSpace(74);
    const top = page.y + 8;
    rect(LEFT, top - 59, RIGHT - LEFT, 63, [1, 1, 1], [0.87, 0.89, 0.88]);
    rect(LEFT, top - 59, 4, 63, booking.status === "completed" ? GREEN : GOLD);
    text(`SESSION ${String(index + 1).padStart(2, "0")}`, LEFT + 13, top - 10, 7, "F2", GREEN);
    text(pdfSafeText(booking.lessonName), LEFT + 13, top - 25, 11, "F2", DARK);
    text(`${formatSlotDay(booking.startsAt)}   |   ${formatSlotTime(booking.startsAt)} Pacific   |   ${booking.durationMin} min`, LEFT + 13, top - 40, 8, "F1", MUTED);
    text(`Ref ${booking.reference}   |   ${booking.status.replaceAll("_", " ").toUpperCase()}   |   ${paymentLabel(booking)}`, LEFT + 13, top - 53, 7, "F1", MUTED);
    const location = pickupLocation(booking.notes);
    page.y = top - 72;
    if (location) {
      ensureSpace(13);
      text(`Pickup: ${pdfSafeText(location)}`, LEFT + 4, page.y, 8, "F1", MUTED);
      page.y -= 13;
    }
    const notes = studentNotes(booking.notes);
    if (notes.length) {
      ensureSpace(15);
      for (const note of notes) {
        paragraph(`Student note: ${note}`, LEFT + 4, 8, 91, 11);
      }
      page.y -= 2;
    }
    page.y -= 2;
  });

  if (progress.length) {
    sectionTitle("Lesson progress & tutor reports");
    let currentReport = false;
    for (const item of progress) {
      if (/^Lesson report\s*[·-]/i.test(item)) {
        ensureSpace(27);
        page.y -= 1;
        rect(LEFT, page.y - 6, RIGHT - LEFT, 22, [0.96, 0.97, 0.93]);
        text(pdfSafeText(item), LEFT + 10, page.y + 1, 8, "F2", DARK);
        page.y -= 24;
        currentReport = true;
        continue;
      }
      if (/^Additional tutor notes:/i.test(item)) {
        const value = item.replace(/^Additional tutor notes:\s*/i, "");
        ensureSpace(22);
        text("TUTOR NOTES", LEFT + 3, page.y, 6.5, "F2", GREEN);
        page.y -= 11;
        paragraph(value, LEFT + 3, 8, 94, 11);
        page.y -= 3;
        continue;
      }
      if (/^Historical report/i.test(item)) {
        paragraph(item, LEFT + 3, 8, 96, 11);
        continue;
      }
      const colon = item.indexOf(":");
      if (colon > 0 && currentReport) {
        const label = item.slice(0, colon).trim();
        const detail = item.slice(colon + 1).trim();
        ensureSpace(22);
        text(pdfSafeText(label), LEFT + 3, page.y, 8, "F2", DARK);
        page.y -= 11;
        paragraph(detail, LEFT + 3, 7.5, 96, 10);
        page.y -= 3;
      } else paragraph(item, LEFT + 3, 8, 96, 11);
    }
  }

  return assemblePdf(pages);
}

function drawHeader(page: PageCanvas, booking: BookingRecord, generatedAt: Date): void {
  page.commands.push(`${color(DARK)} rg 0 700 ${PAGE_W} 92 re f`);
  page.commands.push(`q 58 0 0 38 47 724 cm /Logo Do Q`);
  page.commands.push(`BT /F2 8 Tf ${color([0.74, 0.91, 0.42])} rg 1 0 0 1 116 760 Tm (WISDOM DRIVING ACADEMY) Tj ET`);
  page.commands.push(`BT /F2 17 Tf 1 1 1 rg 1 0 0 1 116 738 Tm (STUDENT PROGRESS REPORT) Tj ET`);
  page.commands.push(`BT /F1 7 Tf ${color([0.88, 0.90, 0.91])} rg 1 0 0 1 116 720 Tm (Private school record  |  Generated ${generatedAt.toISOString().slice(0, 10)}  |  Ref ${escapePdfString(booking.reference)}) Tj ET`);
  page.commands.push(`${color(GOLD)} rg 0 696 ${PAGE_W} 4 re f`);
  page.commands.push(`${color([0.83, 0.86, 0.85])} RG 0.6 w ${LEFT} 48 m ${RIGHT} 48 l S`);
  page.commands.push(`BT /F1 7 Tf ${color(MUTED)} rg 1 0 0 1 ${LEFT} 34 Tm (CONFIDENTIAL - for authorized school administration only) Tj ET`);
  page.commands.push(`BT /F1 7 Tf ${color(MUTED)} rg 1 0 0 1 ${RIGHT - 70} 34 Tm (PAGE ${page.number}) Tj ET`);
}

function makeEmptyPage(): PageCanvas {
  const page: PageCanvas = { commands: [], y: 680, number: 1 };
  page.commands.push(`${color(DARK)} rg 0 700 ${PAGE_W} 92 re f`);
  page.commands.push(`BT /F2 16 Tf 1 1 1 rg 1 0 0 1 48 748 Tm (STUDENT PROGRESS REPORT) Tj ET`);
  page.commands.push(`BT /F1 10 Tf 0.2 0.2 0.2 rg 1 0 0 1 48 660 Tm (No student booking records found.) Tj ET`);
  return page;
}

function assemblePdf(pages: PageCanvas[]): Uint8Array {
  const logo = readFileSync(resolve(process.cwd(), "public/wisdom-logo-print.jpg"));
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.alloc(0),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 938 /Height 608 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`, "ascii"),
      logo,
      Buffer.from("\nendstream", "ascii"),
    ]),
  ];
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = Buffer.from(page.commands.join("\n"), "ascii");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >> /Contents ${contentId} 0 R >>`, "ascii"));
    objects.push(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
      stream,
      Buffer.from("\nendstream", "ascii"),
    ]));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%WDA\n", "ascii")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "ascii"), object, Buffer.from("\nendobj\n", "ascii")]);
    chunks.push(wrapped);
    length += wrapped.length;
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, "ascii"));
  return new Uint8Array(Buffer.concat(chunks));
}

export { createStudentBookingPdf };
