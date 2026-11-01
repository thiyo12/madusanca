import type { BookingRecord } from "../booking/types";
import { formatSlotDay, formatSlotTime } from "../booking/format.ts";
import { pickupLocation } from "./student-record-format.ts";

const PAGE_LINE_LIMIT = 48;
const PAGE_LINE_WIDTH = 92;

function pdfSafeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

function wrap(value: string, width = PAGE_LINE_WIDTH): string[] {
  const text = pdfSafeText(value);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      line = "";
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function escapePdfString(value: string): string {
  return pdfSafeText(value).replace(/[\\()]/g, "\\$&");
}

function paymentLabel(booking: BookingRecord): string {
  const status = booking.paymentStatus ?? "due";
  const amount = booking.packagePriceCad ?? booking.priceCad;
  return `${status.toUpperCase()} · $${amount.toFixed(2)} CAD`;
}

function recordLines(bookings: BookingRecord[], generatedAt: Date): string[] {
  const first = bookings[0];
  if (!first) return [];
  const lines = [
    "WISDOM DRIVING ACADEMY - PRIVATE STUDENT RECORD",
    `Generated: ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Student: ${first.studentName}`,
    `Email: ${first.email}`,
    `Phone: ${first.phone || "Not provided"}`,
    `Booking records: ${bookings.length}`,
    "",
  ];

  bookings.forEach((booking, index) => {
    const location = pickupLocation(booking.notes);
    lines.push(
      `SESSION ${index + 1}`,
      `Reference: ${booking.reference}`,
      `Lesson: ${booking.lessonName} (${booking.durationMin} minutes)`,
      `Date: ${formatSlotDay(booking.startsAt)} · Time: ${formatSlotTime(booking.startsAt)} Pacific Time`,
      `Location: ${location ?? "Not recorded"}`,
      `Status: ${booking.status.replaceAll("_", " ")} · Payment: ${paymentLabel(booking)}`,
    );
    const notes = booking.notes
      .split(/\r?\n/)
      .filter((line) => !/^Pickup address:\s*/i.test(line))
      .join(" ")
      .trim();
    if (notes) lines.push(...wrap(`Notes: ${notes}`));
    lines.push("");
  });

  lines.push("CONFIDENTIAL - for authorized school administration only.");
  return lines.flatMap((line) => wrap(line));
}

/** Builds a text-only PDF without adding a client-side PDF dependency. */
export function createStudentBookingPdf(bookings: BookingRecord[], generatedAt = new Date()): Uint8Array {
  const lines = recordLines(bookings, generatedAt);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += PAGE_LINE_LIMIT) {
    pages.push(lines.slice(index, index + PAGE_LINE_LIMIT));
  }
  if (pages.length === 0) pages.push(["No student booking records found."]);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const pageIds: number[] = [];
  pages.forEach((pageLines) => {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const commands = ["BT", "/F1 10 Tf", "50 748 Td", "14 TL"];
    pageLines.forEach((line, index) => {
      if (index > 0) commands.push("T*");
      commands.push(`(${escapePdfString(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let document = "%PDF-1.4\n%WDA\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    document += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(document, "ascii"));
}
