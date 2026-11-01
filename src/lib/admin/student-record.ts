import "server-only";

import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import type { BookingRecord } from "@/lib/booking/types";

const bookingIdSchema = z.uuid();

/** Resolve a student from an opaque booking id, then load only that email's rows. */
export async function getStudentBookingsByAnchor(
  bookingId: string,
): Promise<BookingRecord[] | null> {
  if (!bookingIdSchema.safeParse(bookingId).success) return null;

  const store = getStore();
  const anchor = await store.getBookingById(bookingId);
  if (!anchor) return null;

  const bookings = await store.listBookings({ search: anchor.email });
  return bookings
    .filter((booking) => booking.email.trim().toLowerCase() === anchor.email.trim().toLowerCase())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
