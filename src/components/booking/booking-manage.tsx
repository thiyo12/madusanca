"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookingSummary } from "@/components/booking/booking-summary";
import { BookingFind } from "@/components/booking/booking-find";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import { StripeUpgradeButton } from "@/components/booking/stripe-upgrade-button";
import { StripePackagePurchaseButton } from "@/components/booking/stripe-package-purchase-button";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { addMonthsToKey, dayKeyOf, formatSlotFull } from "@/lib/booking/format";
import { consumeManageSessionStripeReturn, hasPendingManageSessionStripeReturn } from "@/lib/booking/manage-session-client";

export interface BookingManageProps {
  paymentReturn?: string;
  packagePurchaseAdded?: boolean;
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
  addOnOptions?: Array<{ id: string; name: string; priceCad: number; sessionCount: number }>;
}

interface ManageResponse {
  ok?: boolean;
  error?: string;
  httpStatus?: number;
  booking?: BookingView;
  sessions?: BookingView[];
  purchase?: PurchaseView;
  manageUrl?: string;
  emailSent?: boolean;
}

interface PurchaseView {
  id: string;
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  creditsPurchased: number;
  creditsAvailable: number;
  amountCad: number;
  paymentStatus: string;
  purchasedAt?: string;
  validUntil?: string;
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

export function BookingManage({ paymentReturn, packagePurchaseAdded = false }: BookingManageProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [purchase, setPurchase] = useState<PurchaseView | null>(null);
  const [sessions, setSessions] = useState<BookingView[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [upgradeLessonId, setUpgradeLessonId] = useState("");
  const [addOnLessonId, setAddOnLessonId] = useState("");
  const [addOnQuantity, setAddOnQuantity] = useState(1);
  const [upgradeSessions, setUpgradeSessions] = useState<string[]>([]);
  const [upgradeSessionIndex, setUpgradeSessionIndex] = useState(0);
  const [creditStart, setCreditStart] = useState<string | null>(null);

  useEffect(() => {
    // Checkout is the sole navigation that temporarily retains a verified
    // session. Consume its marker as soon as Stripe returns to this page.
    consumeManageSessionStripeReturn();
    const clearSession = async () => {
      if (hasPendingManageSessionStripeReturn()) return;
      await fetch("/api/bookings/session", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
    };
    const reloadRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    const clearOnLeavingLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!link) return;
      const target = (link as HTMLAnchorElement).target;
      if (event.defaultPrevented || (target && target !== "_self")) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if ((link as HTMLAnchorElement).hasAttribute("download")) return;
      const destination = new URL((link as HTMLAnchorElement).href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === "/booking/manage") return;
      // Complete cookie deletion before navigating. Fire-and-forget alone can
      // lose the Set-Cookie response during an App Router transition.
      event.preventDefault();
      void clearSession().finally(() => window.location.assign(destination.href));
    };
    const clearOnHistoryNavigation = () => {
      void clearSession().finally(() => window.location.reload());
    };
    const clearOnPageHide = () => { void clearSession(); };
    window.addEventListener("pagehide", clearOnPageHide);
    window.addEventListener("pageshow", reloadRestoredPage);
    document.addEventListener("click", clearOnLeavingLink, true);
    window.addEventListener("popstate", clearOnHistoryNavigation);
    return () => {
      window.removeEventListener("pagehide", clearOnPageHide);
      window.removeEventListener("pageshow", reloadRestoredPage);
      document.removeEventListener("click", clearOnLeavingLink, true);
      window.removeEventListener("popstate", clearOnHistoryNavigation);
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
      return { ...((await response.json()) as ManageResponse), httpStatus: response.status };
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    callManage({ action: "get" })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || (!result.booking && !result.purchase)) {
          setStatus("error");
          setError(result.error ?? "This booking link is invalid or has expired.");
          return;
        }
        setPurchase(result.purchase ?? null);
        setBooking(result.booking ?? null);
        setSessions(result.sessions ?? (result.booking ? [result.booking] : []));
        setActiveSessionId(result.booking?.id ?? null);
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

  async function scheduleCredit() {
    if (!purchase || !creditStart) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/package-purchases/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: purchase.id, startsAt: creditStart }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setActionError(result.error ?? "Could not schedule this session.");
        if (response.status === 409) {
          setCreditStart(null);
          setAvailabilityRevision((revision) => revision + 1);
        }
        return;
      }
      const updated = await callManage({ action: "get" });
      if (!updated.ok || (!updated.booking && !updated.purchase)) {
        setActionError(updated.error ?? "Session was saved, but the updated purchase view could not load. Refresh the page.");
        return;
      }
      setPurchase(updated.purchase ?? null);
      setBooking(updated.booking ?? null);
      setSessions(updated.sessions ?? (updated.booking ? [updated.booking] : []));
      setActiveSessionId(updated.booking?.id ?? null);
      setCreditStart(null);
      setNow(Date.now());
    } catch {
      setActionError("Network error. Your lesson was not scheduled unless the appointment appears here; refresh to check.");
    } finally {
      setBusy(false);
    }
  }

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

  async function rescheduleBooking() {
    if (!pendingStart) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await callManage({ action: "reschedule", startsAt: pendingStart, sessionId: activeSessionId ?? booking?.id });
      if (!result.ok || !result.booking) {
        setActionError(result.error ?? "Could not reschedule the booking.");
        if (result.httpStatus === 409) {
          setPendingStart(null);
          setAvailabilityRevision((revision) => revision + 1);
        }
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

  if (status === "error" || (!booking && !purchase)) {
    return (
      <div className="rounded-[25px] border border-line bg-white p-5 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">My Booking · Email verification</p>
        <h2 className="mt-2 font-display text-xl font-extrabold text-ink">Find your booking</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#4b525e]">
          Your secure session may have expired. You don’t need a booking link—enter the email address used for your booking below and verify it with the one-time code.
        </p>
        {error && <p role="status" className="mt-3 text-[12px] text-soft">{error}</p>}
        <div className="mt-5 rounded-[18px] border border-line bg-[#fbfbf8] p-4 sm:p-5">
          <BookingFind />
        </div>
        <p className="mt-5 text-[12.5px] text-soft">Can’t access that email? <a href="/contact" className="font-bold text-gold-deep underline underline-offset-2">Contact the school</a>.</p>
      </div>
    );
  }

  const creditPanel = purchase ? (
    <section className="mt-5 rounded-[16px] border border-line p-4">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#426a2c]">Package purchase</p>
      <h3 className="mt-1 text-sm font-extrabold text-ink">{purchase.lessonName}</h3>
      <p className="mt-1 text-[12.5px] text-soft">{purchase.creditsAvailable} of {purchase.creditsPurchased} lessons available · {purchase.paymentStatus === "paid" ? "Paid" : purchase.paymentStatus}</p>
      {purchase.validUntil && <p className="mt-1 text-[12px] text-soft">Schedule before {new Date(purchase.validUntil).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}.</p>}
      {purchase.paymentStatus === "paid" && purchase.creditsAvailable > 0 && (!purchase.validUntil || (now !== null && Date.parse(purchase.validUntil) > now)) && (
        <div className="mt-3">
          <p className="mb-2 text-[12px] font-bold text-ink">Choose a time for one available lesson</p>
          <DateTimeStep
            key={`${purchase.id}-${availabilityRevision}`}
            lessonId={purchase.lessonId}
            selectedStart={creditStart}
            maxDate={purchase.validUntil ? dayKeyOf(purchase.validUntil) : undefined}
            horizonDays={185}
            onSelect={(slot) => { setCreditStart(slot); setActionError(null); }}
          />
          {creditStart && <button type="button" onClick={() => void scheduleCredit()} disabled={busy} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full bg-ink px-5 text-[12px] font-extrabold text-white disabled:opacity-60">{busy ? "Scheduling…" : "Schedule this session"}</button>}
        </div>
      )}
      {purchase.paymentStatus === "pending" && <p className="mt-2 text-[12px] text-soft">Lessons become available after Stripe confirms payment.</p>}
    </section>
  ) : null;

  if (!booking && purchase) {
    return (
      <div className="rounded-[25px] border border-line bg-white p-5 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">My Booking</p>
        <h2 className="mt-2 font-display text-2xl font-extrabold text-ink">Your purchase</h2>
        <p className="mt-1 text-[12.5px] text-soft">Reference {purchase.reference} · ${purchase.amountCad.toFixed(2)} CAD before GST</p>
        {creditPanel}
        {sessions.length > 0 && (
          <section className="mt-5 rounded-[16px] border border-line p-4">
            <h3 className="text-sm font-extrabold text-ink">Scheduled lessons</h3>
            <ol className="mt-3 grid gap-2">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap justify-between gap-2 rounded-[10px] bg-mist px-3 py-2 text-[12.5px]">
                  <span className="font-bold text-ink">Lesson {session.sessionIndex}: {formatSlotFull(session.startsAt)}</span>
                  <span className="text-soft">{STATUS_LABEL[session.status] ?? session.status}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {actionError && <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">{actionError}</p>}
        <Button href="/lessons" variant="dark" className="mt-5">Add More Lessons</Button>
        <Button href="/contact" variant="outline" className="mt-5">Contact the school</Button>
      </div>
    );
  }

  if (!booking) return null;

  const closed = sessions.every((session) => session.status === "completed") ||
    (sessions.length === 1 && booking.status === "cancelled");
  const selectedSession = sessions.find((session) => session.id === activeSessionId) ?? booking;
  const selectedSessionOpen = !["cancelled", "completed"].includes(selectedSession.status);
  const rescheduleLimitReached = selectedSession.studentRescheduleCount >= 2;
  const withinCancellationWindow =
    now !== null && Date.parse(selectedSession.startsAt) - now < 48 * 60 * 60 * 1000;

  if (paymentReturn === "success" && packagePurchaseAdded) {
    return (
      <div className="rounded-[25px] border border-[#d3e9c5] bg-[#f5fbed] p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold text-ink">Package checkout returned</h2>
        <p role="status" className="mt-2 text-[15px] leading-relaxed text-[#4b525e]">
          Stripe returned you from checkout. Your package is separate from your current booking and will not replace or downgrade it. Verify your email in My Booking to see the package once payment is confirmed and schedule its lessons.
        </p>
        <Button href="/booking/manage" variant="dark" className="mt-5">Return to My Booking</Button>
      </div>
    );
  }

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

      {creditPanel}
      {purchase && <Button href="/lessons" variant="dark" className="mt-5">Add More Lessons</Button>}

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
            <div className="mt-3"><DateTimeStep lessonId={option.id} selectedStart={upgradeSessions[upgradeSessionIndex] ?? null} maxDate={upgradeSessions[0] ? addMonthsToKey(dayKeyOf(upgradeSessions[0]), 6) : undefined} minDate={upgradeSessionIndex > 0 && upgradeSessions[0] ? dayKeyOf(upgradeSessions[0]) : undefined} horizonDays={370} onSelect={(slot) => { setUpgradeSessions((current) => { const next = [...current]; next[upgradeSessionIndex] = slot; return next; }); setUpgradeSessionIndex((index) => Math.min(index + 1, option.sessionCount - 1)); }} /></div>
            <div className="mt-3"><StripeUpgradeButton targetLessonId={option.id} amountCad={option.balanceCad} sessions={upgradeSessions} disabled={upgradeSessions.length !== option.sessionCount || upgradeSessions.some((slot) => !slot)} /></div>
          </>}
        </section>;
      })()}
      {booking.paymentStatus === "paid" && !closed && (booking.addOnOptions?.length ?? 0) > 0 && (() => {
        const option = booking.addOnOptions!.find((item) => item.id === addOnLessonId);
        return <section className="mt-5 rounded-[14px] border border-line p-4">
          <h3 className="text-sm font-extrabold text-ink">Add another package</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-soft">This adds a separate package to your account. It will not change, cancel, or downgrade your current booking. After payment, verify your email in My Booking to schedule the extra lessons.</p>
          <label className="mt-3 grid gap-1.5 text-xs font-bold text-ink">Package to add
            <select value={addOnLessonId} onChange={(event) => setAddOnLessonId(event.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm">
              <option value="">Select a package</option>
              {booking.addOnOptions!.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sessionCount} lesson{item.sessionCount === 1 ? "" : "s"} · ${item.priceCad.toFixed(2)} CAD</option>)}
            </select>
          </label>
          {option && <>
            <label className="mt-3 grid max-w-xs gap-1.5 text-xs font-bold text-ink">Number of packages
              <select value={addOnQuantity} onChange={(event) => setAddOnQuantity(Number(event.target.value))} className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm">
                {[1, 2, 3, 4, 5].map((quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
              </select>
            </label>
            <p className="mt-3 text-[12px] font-bold text-soft">Total: ${(option.priceCad * addOnQuantity).toFixed(2)} CAD + applicable taxes</p>
            <div className="mt-3"><StripePackagePurchaseButton lessonId={option.id} quantity={addOnQuantity} disabled={busy} /></div>
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
          <p className="max-w-md text-[13px] leading-relaxed text-soft">
            Need to cancel a session? Please contact your driving instructor; sessions cannot be cancelled online.
          </p>
        </div>
      )}

      {mode === "view" && !closed && selectedSessionOpen && withinCancellationWindow && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-[13px] leading-relaxed text-soft">
            This appointment is within 48 hours. Please contact your driving instructor to request a change. For assistance, call{" "}
            <a href="tel:+12362343229" className="font-extrabold text-gold-deep underline-offset-2 hover:underline">
              Shan at +1 236-234-3229
            </a>.
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
            key={`${selectedSession.id}-${availabilityRevision}`}
            lessonId={selectedSession.lessonId}
            selectedStart={pendingStart}
            minDate={selectedSession.packageWindowStart}
            maxDate={addMonthsToKey(selectedSession.packageWindowStart, 6)}
            horizonDays={370}
            onSelect={(slot) => {
              setPendingStart(slot);
              setActionError(null);
            }}
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
