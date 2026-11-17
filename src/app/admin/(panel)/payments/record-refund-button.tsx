"use client";

import { useTransition } from "react";
import { setBookingPaymentAction } from "../bookings/actions";

export function RecordRefundButton({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Confirm you already issued this refund manually. This only updates the app record.")) return;
        startTransition(() => { void setBookingPaymentAction(bookingId, "refunded", "/admin/payments"); });
      }}
      className="h-7 rounded border border-[#eadcb1] bg-[#fff9e9] px-2 text-[10px] font-bold text-[#735c1e] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Mark refunded"}
    </button>
  );
}
