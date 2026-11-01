"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookingSummary } from "@/components/booking/booking-summary";
import { BookingFind } from "@/components/booking/booking-find";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import { StripeUpgradeButton } from "@/components/booking/stripe-upgrade-button";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { addMonthsToKey, dayKeyOf, formatSlotFull } from "@/lib/booking/format";

export interface BookingManageProps {
  paymentReturn?: string;
}

interface BookingView {
  id: string;
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
  sessionIndex: number;
  sessionCount: number;
  packagePriceCad: number;
  packageWindowStart: string;
  upgradeOptions?: Array<{ id: string; name: string; priceCad: number; sessionCount: number; balanceCad: number }>;
}

interface ManageResponse {
  ok?: boolean;
  error?: string;
  booking?: BookingView;
  sessions?: BookingView[];
  manageUrl?: string;
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

export function BookingManage({ paymentReturn }: BookingManageProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [sessions, setSessions] = useState<BookingView[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [upgradeLessonId, setUpgradeLessonId] = useState("");
  const [upgradeSessions, setUpgradeSessions] = useState<string[]>([]);
  const [upgradeSessionIndex, setUpgradeSessionIndex] = useState(0);

  useEffect(() => {
    const clearSession = () => {
      void fetch("/api/bookings/session", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
    };
    const reloadRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", clearSession);
    window.addEventListener("pageshow", reloadRestoredPage);
    return () => {
      window.removeEventListener("pagehide", clearSession);
      window.removeEventListener("pageshow", reloadRestoredPage);
    };
  }, []);

  async function leaveToHome() {
    await fetch("/api/bookings/session", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    router.replace("/");
  }

  const callManage = useCallback(
    async (payload: Record<string, unknown>): Promise<ManageResponse> => {
      const response = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return (await response.json()) as ManageResponse;
    },
    [],
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
        setSessions(result.sessions ?? [result.booking]);
        setActiveSessionId(result.booking.id);
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

  useEffect(() => {
    if (paymentReturn !== "success") return;
    let cancelled = false;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void callManage({ action: "get" }).then((result) => {
        if (!cancelled && result.ok && result.booking) {
          setBooking(result.booking);
          setSessions(result.sessions ?? [result.booking]);
          setActiveSessionId(result.booking.id);
        }
      }).catch(() => undefined);
      if (attempts >= 6) window.clearInterval(timer);
    }, 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [paymentReturn, callManage]);

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
      setSessions(result.sessions ?? [{ ...result.booking, status: "cancelled" }, ...sessions.filter((session) => session.id !== result.booking!.id).map((session) => ({ ...session, status: "cancelled" }))]);
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
      const result = await callManage({ action: "reschedule", startsAt: pendingStart, sessionId: activeSessionId ?? booking?.id });
      if (!result.ok || !result.booking) {
        setActionError(result.error ?? "Could not reschedule the booking.");
        return;
      }
      setBooking(result.booking);
      setSessions(result.sessions ?? sessions.map((session) => session.id === result.booking!.id ? result.booking! : session));
      setPendingStart(null);
      setMode("view");
      setEmailNotice(
        result.emailSent === false
          ? "Your new time is saved, but the update email could not be delivered. This page now has your updated booking link."
          : "Your new time is saved and an update email has been sent.",
      );
      router.refresh();
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

  const closed = sessions.every((session) => session.status === "completed") ||
    (sessions.length === 1 && booking.status === "cancelled");
  const selectedSession = sessions.find((session) => session.id === activeSessionId) ?? booking;
  const selectedSessionOpen = !["cancelled", "completed"].includes(selectedSession.status);
  const rescheduleLimitReached = selectedSession.studentRescheduleCount >= 2;
  const withinCancellationWindow =
    now !== null && Date.parse(selectedSession.startsAt) - now < 48 * 60 * 60 * 1000;

  if (paymentReturn === "success") {
    return (
      <div className="rounded-[25px] border border-[#d3e9c5] bg-[#f5fbed] p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold text-ink">Payment complete</h2>
        <p role="status" className="mt-2 text-[15px] leading-relaxed text-[#4b525e]">
          {booking.paymentStatus === "paid" ? "Your payment has been received." : "We’re confirming your payment. Please refresh this page shortly if it has not updated."}
        </p>
        <p className="mt-4 text-sm font-bold text-ink">Questions or changes? Contact your tutor:</p>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          <a className="font-bold underline" href="tel:+12362343229">+1 236-234-3229</a><br />
          <a className="font-bold underline" href="mailto:info@wisdomdrivingacademy.com">info@wisdomdrivingacademy.com</a>
        </p>
        <button type="button" onClick={() => void leaveToHome()} className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-[#83b657] hover:bg-[#f7fbed]">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf5df] text-[#426a2c]">←</span> Back to home
        </button>
      </div>
    );
  }

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

      {sessions.length > 1 && (
        <section className="mt-5 rounded-[16px] border border-line p-4">
          <h3 className="text-sm font-extrabold text-ink">Your {sessions.length} scheduled sessions</h3>
          <ol className="mt-3 grid gap-2">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap justify-between gap-2 rounded-[10px] bg-mist px-3 py-2 text-[12.5px]">
                <button type="button" onClick={() => setActiveSessionId(session.id)} aria-pressed={activeSessionId === session.id} className="text-left font-bold text-ink underline decoration-transparent underline-offset-2 hover:decoration-current aria-pressed:text-gold-deep">
                  Session {session.sessionIndex}: {formatSlotFull(session.startsAt)}
                </button>
                <span className="text-soft">{STATUS_LABEL[session.status] ?? session.status}{activeSessionId === session.id ? " · selected" : ""}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {paymentReturn === "success" && (
        <p role="status" className={`mt-4 rounded-[14px] border px-4 py-3 text-[13px] font-semibold leading-relaxed ${booking.paymentStatus === "paid" ? "border-[#cce6b1] bg-[#f1f9e9] text-[#385a22]" : "border-[#eadcb1] bg-[#fff9e9] text-[#735c1e]"}`}>
          {booking.paymentStatus === "paid"
            ? "Payment received. Your booking is up to date, and your paid invoice is available below."
            : "Checkout returned successfully. We’re confirming your payment now; refresh this page shortly if the status has not updated yet."}
        </p>
      )}
      {paymentReturn === "cancelled" && (
        <p role="status" className="mt-4 rounded-[14px] border border-line bg-white px-4 py-3 text-[13px] font-semibold leading-relaxed text-soft">
          Checkout was cancelled. Your booking and current payment status are unchanged; you can try again below if you wish.
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
          <StripeCheckoutButton />
        </div>
      )}
      {booking.paymentStatus === "paid" && !closed && (booking.upgradeOptions?.length ?? 0) > 0 && (() => {
        const option = booking.upgradeOptions!.find((item) => item.id === upgradeLessonId);
        return <section className="mt-5 rounded-[14px] border border-line p-4">
          <h3 className="text-sm font-extrabold text-ink">Upgrade package</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-soft">Choose a new date and time for every session. Your current booking stays unchanged unless the upgrade payment succeeds.</p>
          <label className="mt-3 grid gap-1.5 text-xs font-bold text-ink">New package
            <select value={upgradeLessonId} onChange={(event) => { setUpgradeLessonId(event.target.value); setUpgradeSessions([]); setUpgradeSessionIndex(0); }} className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm">
              <option value="">Select a package</option>
              {booking.upgradeOptions!.map((item) => <option key={item.id} value={item.id}>{item.name} · pay ${item.balanceCad.toFixed(2)} CAD + GST</option>)}
            </select>
          </label>
          {option && <>
            <div className="mt-4 flex flex-wrap gap-2">{Array.from({ length: option.sessionCount }, (_, index) => <button key={index} type="button" onClick={() => setUpgradeSessionIndex(index)} aria-pressed={upgradeSessionIndex === index} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${upgradeSessionIndex === index ? "border-ink bg-ink text-white" : "border-line text-ink"}`}>Session {index + 1}{upgradeSessions[index] ? " ✓" : ""}</button>)}</div>
            <div className="mt-3"><DateTimeStep lessonId={option.id} selectedStart={upgradeSessions[upgradeSessionIndex] ?? null} maxDate={upgradeSessions[0] ? addMonthsToKey(dayKeyOf(upgradeSessions[0]), 2) : undefined} minDate={upgradeSessionIndex > 0 && upgradeSessions[0] ? dayKeyOf(upgradeSessions[0]) : undefined} horizonDays={150} onSelect={(slot) => { setUpgradeSessions((current) => { const next = [...current]; next[upgradeSessionIndex] = slot; return next; }); setUpgradeSessionIndex((index) => Math.min(index + 1, option.sessionCount - 1)); }} /></div>
            <div className="mt-3"><StripeUpgradeButton targetLessonId={option.id} amountCad={option.balanceCad} sessions={upgradeSessions} disabled={upgradeSessions.length !== option.sessionCount || upgradeSessions.some((slot) => !slot)} /></div>
          </>}
        </section>;
      })()}
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

      {mode === "view" && !closed && selectedSessionOpen && !withinCancellationWindow && (
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
              Reschedule ({2 - selectedSession.studentRescheduleCount} left)
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
            {busy ? "Working…" : sessions.length > 1 ? "Cancel package" : "Cancel lesson"}
          </Button>
        </div>
      )}

      {mode === "view" && !closed && selectedSessionOpen && withinCancellationWindow && (
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

      {mode === "view" && !closed && !selectedSessionOpen && sessions.length > 1 && (
        <p className="mt-5 border-t border-line pt-4 text-[13px] text-soft">This session is {STATUS_LABEL[selectedSession.status]?.toLowerCase() ?? "closed"}. Select another session above to manage its time.</p>
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
              <strong className="text-ink">{formatSlotFull(selectedSession.startsAt)}</strong>.
            Choose a new time below — your current slot stays held until you confirm.
          </p>
          <DateTimeStep
            key={selectedSession.id}
            lessonId={selectedSession.lessonId}
            selectedStart={pendingStart}
            minDate={selectedSession.packageWindowStart}
            maxDate={addMonthsToKey(selectedSession.packageWindowStart, 2)}
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
      <div className="mt-7 border-t border-line pt-5">
        <button type="button" onClick={() => void leaveToHome()} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-[#83b657] hover:bg-[#f7fbed]">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf5df] text-[#426a2c]">←</span> Back to home
        </button>
      </div>
    </div>
  );
}
