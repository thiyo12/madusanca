import type { BookingStatus } from "@/lib/booking/types";

/** Completed bookings are retained for administrators but hidden from customers. */
export function customerCanAccessBooking(status: BookingStatus): boolean {
  return status !== "completed";
}
