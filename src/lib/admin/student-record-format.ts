import type { BookingRecord } from "../booking/types";

export function pickupLocation(notes: string): string | null {
  const line = notes.split(/\r?\n/).find((item) => /^Pickup address:\s*/i.test(item));
  return line?.replace(/^Pickup address:\s*/i, "").trim() || null;
}

/** Only offer the overall report after at least one lesson is completed and every remaining booking is closed. */
export function studentSessionsComplete(bookings: BookingRecord[]): boolean {
  return bookings.some((booking) => booking.status === "completed")
    && bookings.every((booking) => booking.status === "completed" || booking.status === "cancelled");
}
