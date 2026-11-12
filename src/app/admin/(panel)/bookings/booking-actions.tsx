"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { dayKeyOf, formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { toVancouverParts, zonedToUtc } from "@/lib/booking/slots";
import type { BookingStatus } from "@/lib/booking/types";
import {
  rescheduleBookingAction,
  setBookingStatusAction,
  type RescheduleState,
} from "./actions";

export interface BookingActionsProps {
  bookingId: string;
  status: BookingStatus;
  startsAt: string;
  durationMin: number;
  paymentStatus: string;
  nowMs: number;
}

const buttonBase =
  "inline-flex h-8 items-center rounded-[8px] px-3 text-[11.5px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50";

export function BookingActions({ bookingId, status, startsAt, durationMin, nowMs }: BookingActionsProps) {
  const [currentNowMs, setCurrentNowMs] = useState(nowMs);
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [pendingLocal, setPendingLocal] = useState(() => vancouverDateTimeLocal(startsAt));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closed = status === "cancelled" || status === "completed";
  const canMarkNoShow = status !== "no_show" && Date.parse(startsAt) <= currentNowMs;
  const canComplete = Date.parse(startsAt) + durationMin * 60_000 <= currentNowMs;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submitReschedule() {
    if (!pendingStart) return;
    if (!window.confirm(`Move this lesson to ${formatSlotDay(pendingStart)} at ${formatSlotTime(pendingStart)} Pacific Time? The student will receive an email.`)) return;
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
          disabled={!canComplete}
          title={canComplete ? "Mark this lesson complete" : "Available after the scheduled lesson ends"}
          className={`${buttonBase} border border-line bg-white text-ink hover:border-[#8fb8ff] hover:text-[#2f5590] disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {canComplete ? "Mark complete" : "Complete after lesson"}
        </button>
      </form>}
      {canMarkNoShow && (
        <form action={async () => {
          if (!confirm("Mark this student as a no-show? You can still reschedule the class afterward.")) return;
          await setBookingStatusAction(bookingId, "no_show");
        }}>
          <button type="submit" title="Records a missed lesson; it does not charge or cancel the student." className={`${buttonBase} border border-[#e6d2e8] bg-[#fbf4fc] text-[#7d3c85] hover:bg-[#f3e8f5]`}>
            Student didn’t attend
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
          Cancel lesson
        </button>
      </form>}

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
                  Move lesson
                </p>
                <h3 className="mt-1.5 font-display text-lg font-extrabold text-ink">
                  Choose a new date and time
                </h3>
                <p className="mt-1 text-xs text-soft">Currently {formatSlotDay(startsAt)} at {formatSlotTime(startsAt)} Pacific</p>
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[12px] font-bold text-ink">New date<input type="date" value={pendingLocal.slice(0, 10)} min={dayKeyOf(new Date(currentNowMs).toISOString())} onChange={(event) => updatePending(event.target.value, pendingLocal.slice(11, 16), setPendingLocal, setPendingStart)} className="h-10 rounded-lg border border-line bg-white px-3 text-sm" /></label>
              <label className="grid gap-1.5 text-[12px] font-bold text-ink">New start time<input type="time" step={60} min={pendingLocal.slice(0, 10) === dayKeyOf(new Date(currentNowMs).toISOString()) ? minutesAsTime(toVancouverParts(new Date(currentNowMs + 60_000)).minutesOfDay) : undefined} value={pendingLocal.slice(11, 16)} onChange={(event) => updatePending(pendingLocal.slice(0, 10), event.target.value, setPendingLocal, setPendingStart)} className="h-10 rounded-lg border border-line bg-white px-3 text-sm" /></label>
            </div>
            <p className="mt-2 text-[11px] text-soft">Choose a future date and time. Past times are unavailable; we’ll check for conflicts before saving.</p>

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3 border-t border-line pt-4">
              <Button onClick={() => void submitReschedule()} disabled={!pendingStart || busy}>
                {busy ? "Moving…" : "Confirm new time"}
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

function vancouverDateTimeLocal(iso: string): string {
  const parts = toVancouverParts(new Date(iso));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${minutesAsTime(parts.minutesOfDay)}`;
}

function updatePending(day: string, time: string, setLocal: (value: string) => void, setStart: (value: string | null) => void): void {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !date || Number.isNaN(hour) || Number.isNaN(minute)) {
    setLocal(`${day}T${time}`);
    setStart(null);
    return;
  }
  setLocal(`${day}T${time}`);
  const startsAt = zonedToUtc(year, month, date, hour * 60 + minute);
  setStart(startsAt.getTime() > Date.now() ? startsAt.toISOString() : null);
}

function minutesAsTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
