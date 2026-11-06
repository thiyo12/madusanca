import "server-only";

import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import type { BookingRecord } from "@/lib/booking/types";
import { bookingsForStudent, studentForBooking } from "@/lib/admin/student-profiles";

const bookingIdSchema = z.uuid();

/** Resolve a student from an opaque booking id, then load only that email's rows. */
export async function getStudentBookingsByAnchor(
  bookingId: string,
): Promise<BookingRecord[] | null> {
  if (!bookingIdSchema.safeParse(bookingId).success) return null;

  const store = getStore();
  const anchor = await store.getBookingById(bookingId);
  if (!anchor) return null;
  const profile = await studentForBooking(bookingId);
  if (profile) return bookingsForStudent(profile.id);
  return [anchor];
}
