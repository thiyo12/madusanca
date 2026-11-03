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
  nowMs: number;
}

const buttonBase =
  "inline-flex h-8 items-center rounded-[8px] px-3 text-[11.5px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50";

export function BookingActions({ bookingId, lessonId, status, startsAt, paymentStatus, nowMs }: BookingActionsProps) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closed = status === "cancelled" || status === "completed";
  const canMarkNoShow = status !== "no_show" && Date.parse(startsAt) <= nowMs;

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
      {status !== "no_show" && <form
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
      </form>}
      {canMarkNoShow && (
        <form action={async () => {
          if (!confirm("Mark this student as a no-show? You can still reschedule the class afterward.")) return;
          await setBookingStatusAction(bookingId, "no_show");
        }}>
          <button type="submit" className={`${buttonBase} border border-[#e6d2e8] bg-[#fbf4fc] text-[#7d3c85] hover:bg-[#f3e8f5]`}>
            No-show
          </button>
        </form>
      )}
      {status !== "no_show" && <form
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
      </form>}

      {status !== "no_show" && <div className="flex flex-wrap items-center gap-2 border-l border-line pl-2">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-soft">
          Payment: {paymentStatus === "paid" ? "Paid" : paymentStatus === "refunded" ? "Refunded" : "Due"}
        </p>
        {paymentStatus === "due" && (
          <form
            action={async () => {
              if (!confirm("Confirm cash was received and mark this booking paid?")) return;
              await setBookingPaymentAction(bookingId, "paid");
            }}
          >
            <button
              type="submit"
              className={`${buttonBase} border border-[#cce6b1] bg-[#f1f9e9] text-[#385a22] hover:bg-[#cce6b1]`}
            >
              Mark Paid by Cash
            </button>
          </form>
        )}
      </div>}

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
