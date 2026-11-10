import type { BookingStatus } from "@/lib/booking/types";

/** Customers may view booking history; server mutation rules still block closed lessons. */
export function customerCanAccessBooking(_status: BookingStatus): boolean {
  void _status;
  return true;
}
