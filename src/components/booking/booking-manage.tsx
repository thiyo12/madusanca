"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookingSummary } from "@/components/booking/booking-summary";
import { BookingFind } from "@/components/booking/booking-find";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { formatSlotFull } from "@/lib/booking/format";

export interface BookingManageProps {
  token: string;
  paymentReturn?: string;
}

interface BookingView {
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  emailMasked: string;
  status: string;
  studentRescheduleCount: number;
  paymentStatus: "due" | "paid" | "refunded" | "waived";
  invoiceUrl?: string;
}

interface ManageResponse {
  ok?: boolean;
  error?: string;
  booking?: BookingView;
  manageUrl?: string;
  token?: string;
  emailSent?: boolean;
}

type Mode = "view" | "reschedule";
type Status = "loading" | "ready" | "error";

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function BookingManage({ token, paymentReturn }: BookingManageProps) {
  const router = useRouter();
  const [activeToken, setActiveToken] = useState(token);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  const callManage = useCallback(
    async (payload: Record<string, unknown>): Promise<ManageResponse> => {
      const response = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: activeToken, ...payload }),
      });
      return (await response.json()) as ManageResponse;
    },
    [activeToken],
  );

  useEffect(() => {
    let cancelled = false;
    callManage({ action: "get" })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.booking) {
          setStatus("error");
          setError(result.error ?? "This booking link is invalid or has expired.");
          return;
        }
        setBooking(result.booking);
        setNow(Date.now());
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setError("Could not load your booking. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [callManage]);

  async function cancelBooking() {
    if (!confirm("Cancel this lesson? This cannot be undone.")) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await callManage({ action: "cancel" });
      if (!result.ok || !result.booking) {
        setActionError(result.error ?? "Could not cancel the booking.");
        return;
      }
      setBooking(result.booking);
      setMode("view");
      setEmailNotice(
        result.emailSent === false
          ? "Your cancellation is saved, but the email could not be delivered. Please contact the school if you need written confirmation."
          : "Cancellation confirmation sent to your booking email.",
      );
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleBooking() {
    if (!pendingStart) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await callManage({ action: "reschedule", startsAt: pendingStart });
      if (!result.ok || !result.booking) {
        setActionError(result.error ?? "Could not reschedule the booking.");
        return;
      }
      setBooking(result.booking);
      setPendingStart(null);
      setMode("view");
      setEmailNotice(
        result.emailSent === false
          ? "Your new time is saved, but the update email could not be delivered. This page now has your updated booking link."
          : "Your new time is saved and an update email has been sent.",
      );
      if (result.token) {
        setActiveToken(result.token);
        router.replace(`/booking/manage?token=${encodeURIComponent(result.token)}`);
      }
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <div role="status" className="grid min-h-[240px] place-items-center rounded-[25px] border border-line bg-white text-sm font-bold text-soft">
        Loading your booking…
      </div>
    );
  }

  if (status === "error" || !booking) {
    return (
      <div role="alert" className="rounded-[25px] border border-[#f3d1c9] bg-[#fff5f2] p-6 sm:p-8">
        <h2 className="font-display text-xl font-extrabold text-ink">Booking link not found</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#4b525e]">{error}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button href="/booking" variant="dark">Book a lesson</Button>
          <Button href="/contact" variant="outline">Contact us</Button>
        </div>
        <div className="mt-6 rounded-[18px] border border-line bg-white p-5">
          <BookingFind />
        </div>
      </div>
    );
  }

  const closed = booking.status === "cancelled" || booking.status === "completed";
  const rescheduleLimitReached = booking.studentRescheduleCount >= 2;
  const withinCancellationWindow =
    now !== null && Date.parse(booking.startsAt) - now < 48 * 60 * 60 * 1000;

  return (
    <div className="rounded-[25px] border border-line bg-white p-5 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
            Manage your booking
          </p>
          <h2 className="mt-2 font-display text-2xl font-extrabold text-ink">
            {booking.lessonName}
          </h2>
        </div>
        <span
          className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide ${
            closed
              ? "bg-mist text-soft"
              : booking.status === "rescheduled"
             ? "bg-[#eaf5df] text-[#426a2c]"
                : "bg-[#e6f6ec] text-[#1f7a45]"
          }`}
        >
          {STATUS_LABEL[booking.status] ?? booking.status}
        </span>
      </div>

      <BookingSummary
        className="mt-5"
        reference={booking.reference}
        data={{
          lessonName: booking.lessonName,
          durationMin: booking.durationMin,
          priceCad: booking.priceCad,
          startsAt: booking.startsAt,
          studentName: booking.studentName,
          email: booking.emailMasked,
        }}
      />

      {paymentReturn === "success" && (
        <p role="status" className={`mt-4 rounded-[14px] border px-4 py-3 text-[13px] font-semibold leading-relaxed ${booking.paymentStatus === "paid" ? "border-[#cce6b1] bg-[#f1f9e9] text-[#385a22]" : "border-[#eadcb1] bg-[#fff9e9] text-[#735c1e]"}`}>
          {booking.paymentStatus === "paid"
            ? "Payment received. Your booking is up to date, and your paid invoice is available below."
            : "Checkout returned successfully. We’re confirming your payment now; refresh this page shortly if the status has not updated yet."}
        </p>
      )}
      {paymentReturn === "cancelled" && (
        <p role="status" className="mt-4 rounded-[14px] border border-line bg-white px-4 py-3 text-[13px] font-semibold leading-relaxed text-soft">
          Checkout was cancelled. Your booking is still saved and payment is due; you can try again below.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-[#f7f7f3] px-4 py-3">
        <p className="text-[12.5px] font-bold text-ink">
          Payment: {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : booking.paymentStatus === "waived" ? "Waived" : "Due"}
        </p>
        {booking.invoiceUrl && (
          <a href={booking.invoiceUrl} target="_blank" rel="noreferrer" className="text-[12px] font-extrabold text-[#426a2c] underline underline-offset-2">
            View Stripe invoice
          </a>
        )}
      </div>
      {booking.paymentStatus === "due" && !closed && (
        <div className="mt-4">
          <StripeCheckoutButton token={activeToken} />
        </div>
      )}

      {emailNotice && (
        <p className={`mt-4 rounded-lg px-4 py-3 text-[13px] leading-relaxed ${
          emailNotice.includes("could not be delivered")
            ? "bg-[#eaf5df] text-[#31543a]"
            : "bg-[#e6f6ec] text-[#1f7a45]"
        }`}>
          {emailNotice}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
          {actionError}
        </p>
      )}

      {mode === "view" && !closed && !withinCancellationWindow && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          {!rescheduleLimitReached ? (
            <Button
              variant="dark"
              onClick={() => {
                setMode("reschedule");
                setPendingStart(null);
                setActionError(null);
              }}
              disabled={busy}
            >
              Reschedule ({2 - booking.studentRescheduleCount} left)
            </Button>
          ) : (
            <p className="max-w-md text-[13px] leading-relaxed text-soft">
              You&rsquo;ve used both online reschedules for this booking. Call{" "}
              <a href="tel:+12362343229" className="font-extrabold text-gold-deep underline-offset-2 hover:underline">
                Shan at +1 236-234-3229
              </a>{" "}
              for help.
            </p>
          )}
          <Button variant="outline" onClick={cancelBooking} disabled={busy}>
            {busy ? "Working…" : "Cancel lesson"}
          </Button>
        </div>
      )}

      {mode === "view" && !closed && withinCancellationWindow && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-[13px] leading-relaxed text-soft">
            Online changes close 48 hours before the lesson. Please call{" "}
            <a href="tel:+12362343229" className="font-extrabold text-gold-deep underline-offset-2 hover:underline">
              Shan at +1 236-234-3229
            </a>{" "}
            for help with a late change.
          </p>
        </div>
      )}

      {mode === "view" && closed && (
        <div className="mt-6 border-t border-line pt-5">
          <Button href="/booking">Book another lesson</Button>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="mb-4 text-[13.5px] leading-relaxed text-soft">
            Currently booked for{" "}
            <strong className="text-ink">{formatSlotFull(booking.startsAt)}</strong>.
            Choose a new time below — your current slot stays held until you confirm.
          </p>
          <DateTimeStep
            key={booking.reference}
            lessonId={booking.lessonId}
            selectedStart={pendingStart}
            onSelect={setPendingStart}
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={rescheduleBooking} disabled={!pendingStart || busy}>
              {busy ? "Updating…" : "Confirm new time"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMode("view");
                setPendingStart(null);
                setActionError(null);
              }}
              disabled={busy}
            >
              Keep current time
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
