"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import type { BookingStatus } from "@/lib/booking/types";
import {
  rescheduleBookingAction,
  setBookingStatusAction,
  setBookingPaymentAction,
  type RescheduleState,
} from "./actions";

export interface BookingActionsProps {
  bookingId: string;
  lessonId: string;
  status: BookingStatus;
  startsAt: string;
  paymentStatus: string;
}

const buttonBase =
  "inline-flex h-8 items-center rounded-[8px] px-3 text-[11.5px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50";

export function BookingActions({ bookingId, lessonId, status, startsAt, paymentStatus }: BookingActionsProps) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closed = status === "cancelled" || status === "completed";

  async function submitReschedule() {
    if (!pendingStart) return;
    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.set("bookingId", bookingId);
    formData.set("startsAt", pendingStart);

    const result: RescheduleState = await rescheduleBookingAction({ error: null }, formData);
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    setPendingStart(null);
  }

  if (closed) {
    return <span className="text-[12px] font-semibold text-soft">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`${buttonBase} border border-line bg-white text-ink hover:border-gold hover:text-gold-deep`}
      >
        Reschedule
      </button>
      <form
        action={async () => {
          await setBookingStatusAction(bookingId, "completed");
        }}
      >
        <button
          type="submit"
          className={`${buttonBase} border border-line bg-white text-ink hover:border-[#8fb8ff] hover:text-[#2f5590]`}
        >
          Complete
        </button>
      </form>
      <form
        action={async () => {
          if (!confirm("Cancel this booking? The student will be emailed.")) return;
          await setBookingStatusAction(bookingId, "cancelled");
        }}
      >
        <button
          type="submit"
          className={`${buttonBase} border border-[#f3d1c9] bg-white text-[#bc4633] hover:bg-[#fff5f2]`}
        >
          Cancel
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-l border-line pl-2">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-soft">
          Payment: {paymentStatus === "paid" ? "Paid" : paymentStatus === "refunded" ? "Refunded" : paymentStatus === "waived" ? "Waived" : "Due"}
        </p>
        {(paymentStatus === "due" || paymentStatus === "waived") && (
          <form
            action={async () => {
              if (!confirm(paymentStatus === "waived" ? "Restore this booking to due?" : "Waive this balance?")) return;
              await setBookingPaymentAction(bookingId, paymentStatus === "waived" ? "due" : "waived");
            }}
          >
            <button
              type="submit"
              className={`${buttonBase} border border-line bg-white text-soft hover:bg-[#fdecea] hover:text-[#bc4633]`}
            >
              {paymentStatus === "waived" ? "Restore Due" : "Waive Balance"}
            </button>
          </form>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reschedule booking"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-8 sm:py-14"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-[18px] bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
                  Reschedule
                </p>
                <h3 className="mt-1.5 font-display text-lg font-extrabold text-ink">
                  Currently {formatSlotDay(startsAt)} at {formatSlotTime(startsAt)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPendingStart(null);
                  setError(null);
                }}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full bg-mist text-soft hover:bg-line hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 max-h-[52vh] overflow-y-auto pr-1">
              <DateTimeStep
                lessonId={lessonId}
                selectedStart={pendingStart}
                onSelect={setPendingStart}
              />
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3 border-t border-line pt-4">
              <Button onClick={() => void submitReschedule()} disabled={!pendingStart || busy}>
                {busy ? "Moving…" : "Move booking"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setPendingStart(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Keep current time
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
