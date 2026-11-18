"use client";

import { useState, useTransition } from "react";
import { markBookingPaidManuallyAction } from "../bookings/actions";
import { RecordRefundButton } from "./record-refund-button";

export function BookingPaymentActions({
  bookingId,
  paymentStatus,
}: {
  bookingId: string;
  paymentStatus: string | undefined;
}) {
  const [action, setAction] = useState("");
  const [pending, startTransition] = useTransition();
  const isDue = paymentStatus === "due";

  return (
    <div className="flex min-w-[150px] flex-col items-end gap-2">
      {isDue ? (
        <form
          className="grid w-full gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (action !== "offline_paid") return;
            if (!window.confirm("Confirm you received payment outside Stripe. Do not use this while the customer may still complete an online checkout.")) return;
            startTransition(() => {
              void markBookingPaidManuallyAction(bookingId);
            });
          }}
        >
          <select
            aria-label={`Payment action for booking ${bookingId}`}
            value={action}
            onChange={(event) => setAction(event.currentTarget.value)}
            className="h-8 rounded border border-line bg-white px-2 text-[11px]"
            disabled={pending}
          >
            <option value="">Choose action</option>
            <option value="offline_paid">Mark paid — offline payment received</option>
          </select>
          <button
            type="submit"
            disabled={pending || action !== "offline_paid"}
            className="h-7 rounded bg-mist px-2 text-[10px] font-bold text-ink hover:bg-line disabled:opacity-50"
          >
            {pending ? "Saving…" : "Apply"}
          </button>
          <p className="text-[9px] leading-relaxed text-soft">
            Use only after receiving cash, cheque, or another offline payment.
          </p>
        </form>
      ) : paymentStatus === "paid" ? (
        <RecordRefundButton bookingId={bookingId} />
      ) : (
        <span className="text-[10px] text-soft">No payment action</span>
      )}
    </div>
  );
}
