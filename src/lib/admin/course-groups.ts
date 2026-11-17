import type { BookingRecord } from "@/lib/booking/types";

const ADDON_SOURCE_PREFIX = "Added from My Booking ";

/** Add-ons purchased from an active course remain in that course; rebookings do not. */
export function courseKeyForBooking(booking: BookingRecord, bookings: BookingRecord[]): string {
  let source = booking;
  const visited = new Set<string>();
  while (source.notes.startsWith(ADDON_SOURCE_PREFIX) && !visited.has(source.id)) {
    visited.add(source.id);
    const sourceReference = source.notes.slice(ADDON_SOURCE_PREFIX.length).trim();
    const parent = bookings.find((item) => item.reference === sourceReference);
    if (!parent || parent.id === source.id) break;
    source = parent;
  }
  return source.packageId ?? source.id;
}

export function bookingsByCourse(bookings: BookingRecord[]): Map<string, BookingRecord[]> {
  const grouped = new Map<string, BookingRecord[]>();
  for (const booking of bookings) {
    const key = courseKeyForBooking(booking, bookings);
    grouped.set(key, [...(grouped.get(key) ?? []), booking]);
  }
  return grouped;
}
