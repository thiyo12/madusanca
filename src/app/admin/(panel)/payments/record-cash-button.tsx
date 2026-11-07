"use client";
import { useTransition } from "react";
import { setBookingPaymentAction } from "../bookings/actions";

export function RecordCashButton({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => {
    if (!confirm("Confirm the cash has been received?")) return;
    startTransition(() => { void setBookingPaymentAction(bookingId, "paid", "/admin/payments"); });
  }} className="inline-flex h-8 items-center rounded-[8px] border border-[#cce6b1] bg-[#f1f9e9] px-3 text-[11.5px] font-extrabold text-[#385a22] transition-colors hover:bg-[#cce6b1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50">
    {pending ? "Saving…" : "Cash received · Mark paid"}
  </button>;
}
