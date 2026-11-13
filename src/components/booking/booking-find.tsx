"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSlotFull } from "@/lib/booking/format";
import { markManageSessionVerified } from "@/lib/booking/manage-session-client";

type Step = "email" | "code" | "list";

interface FoundBooking {
  studentName: string;
  reference: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  status: "pending_payment" | "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";
  paymentStatus: "due" | "paid" | "refunded" | "waived";
  canOpen: boolean;
}

interface FoundPurchase {
  studentName: string;
  reference: string;
  lessonName: string;
  creditsPurchased: number;
  creditsAvailable: number;
  paymentStatus: string;
  purchasedAt?: string;
  validUntil?: string;
  canOpen: boolean;
}

interface OtpResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  bookings?: FoundBooking[];
  purchases?: FoundPurchase[];
  retryAfterSeconds?: number;
  expiresAt?: string;
  sendLimitReason?: "cooldown" | "daily_limit";
  studentName?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

const PENDING_OTP_KEY = "wda_pending_booking_otp";
const OTP_TTL_MS = 10 * 60 * 1000;

function readPendingOtp(email: string): number | null {
  if (typeof window === "undefined" || !email.trim()) return null;
  try {
    const pending = JSON.parse(window.localStorage.getItem(PENDING_OTP_KEY) ?? "null") as { email?: string; expiresAt?: string } | null;
    if (pending?.email !== email.trim().toLowerCase() || !pending.expiresAt) return null;
    const expiry = Date.parse(pending.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry - Date.now() > OTP_TTL_MS) {
      window.localStorage.removeItem(PENDING_OTP_KEY);
      return null;
    }
    return expiry;
  } catch {
    return null;
  }
}

export function BookingFind({ onOpenManage }: { onOpenManage: (reference: string) => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [bookings, setBookings] = useState<FoundBooking[]>([]);
  const [purchases, setPurchases] = useState<FoundPurchase[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [requestAvailableAt, setRequestAvailableAt] = useState<number | null>(null);
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    const update = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      const codeRemaining = otpExpiresAt === null ? 0 : Math.max(0, Math.ceil((otpExpiresAt - currentTime) / 1000));
      const requestRemaining = requestAvailableAt === null ? 0 : Math.max(0, Math.ceil((requestAvailableAt - currentTime) / 1000));
      setRetryAfter(requestRemaining);
      if (otpExpiresAt !== null && codeRemaining === 0) {
        setOtpExpiresAt(null);
        try { window.localStorage.removeItem(PENDING_OTP_KEY); } catch { /* storage may be unavailable */ }
      }
      if (requestAvailableAt !== null && requestRemaining === 0) setRequestAvailableAt(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [otpExpiresAt, requestAvailableAt]);

  function formatRemaining(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
    if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
    return `${remainingSeconds}s`;
  }

  async function callOtp(payload: Record<string, unknown>): Promise<OtpResponse> {
    const response = await fetch("/api/bookings/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, ...payload }),
    });
    return (await response.json()) as OtpResponse;
  }

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    const existingExpiry = readPendingOtp(email);
    if (existingExpiry) {
      setOtpExpiresAt(existingExpiry);
      setRequestAvailableAt(existingExpiry);
      setMessage("Use the code already sent to this email. It remains valid until the countdown reaches zero.");
      setError(null);
      setStep("code");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await callOtp({ action: "send" });
      if (!result.ok) {
        setError(result.error ?? "Could not send the code. Please try again.");
        return;
      }
      if (result.sendLimitReason === "daily_limit" && result.retryAfterSeconds) {
        setOtpExpiresAt(null);
        setRequestAvailableAt(Date.now() + result.retryAfterSeconds * 1000);
        setCode("");
        setStep("email");
        try { window.localStorage.removeItem(PENDING_OTP_KEY); } catch { /* storage may be unavailable */ }
        setMessage("The daily email request limit has been reached. No new code was sent; the button below shows when you can request another.");
        return;
      }
      setMessage(result.message ?? null);
      setCode("");
      const expiry = Date.parse(result.expiresAt ?? "");
      if (Number.isFinite(expiry) && expiry > Date.now()) {
        setOtpExpiresAt(expiry);
        setRequestAvailableAt(expiry);
        try { window.localStorage.setItem(PENDING_OTP_KEY, JSON.stringify({ email: email.trim().toLowerCase(), expiresAt: new Date(expiry).toISOString() })); } catch { /* countdown still works for this visit */ }
      }
      setStep("code");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await callOtp({ action: "verify", code });
      if (!result.ok || !result.bookings) {
        setError(result.error ?? "That code doesn't match.");
        return;
      }
      setBookings(result.bookings);
      setPurchases(result.purchases ?? []);
      setStudentName(result.studentName?.trim().split(/\s+/)[0] ?? "");
      setStep("list");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function openBooking(reference: string) {
    setPending(true);
    setError(null);
    try {
      const result = await callOtp({ action: "token", code, reference });
      if (result.ok) {
        markManageSessionVerified();
        onOpenManage(reference);
        return;
      }
      setError(result.error ?? "Could not open that booking.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setStep("email");
    setEmail("");
    setCode("");
    setBookings([]);
    setPurchases([]);
    setMessage(null);
    setError(null);
    setRetryAfter(0);
    setOtpExpiresAt(null);
    setRequestAvailableAt(null);
    setStudentName("");
  }

  return (
    <div className="grid gap-3.5">
      <div>
        <h3 className="font-display text-[23px] font-extrabold tracking-[-0.04em] text-ink">
          Find my booking
        </h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-soft">
          Enter the email you booked with. If the code doesn’t arrive, check your spam/junk folder and confirm the address matches your booking. Online changes are available until
          48 hours before the lesson. To cancel, or for a later change, contact Shan at{" "}
          <a href="tel:+12362343229" className="font-bold text-gold-deep underline-offset-2 hover:underline">
            +1 236-234-3229
          </a>.
        </p>
      </div>

      {step === "email" && (
        <form onSubmit={requestCode} className="grid gap-3.5">
          <label className="grid gap-1.5 text-[12px] font-bold text-ink">
            Email address
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                const expiry = readPendingOtp(event.target.value);
                setOtpExpiresAt(expiry);
                setRequestAvailableAt(expiry);
                setMessage(expiry ? "A code is already active for this email. Enter the email and continue to use it." : null);
              }}
              placeholder="you@example.com"
              className="h-11 w-full rounded-[12px] border border-[#d7dfdc] bg-white px-3 text-[14px] text-ink outline-none focus:border-[#83b657]"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={pending || (retryAfter > 0 && !readPendingOtp(email))}
              className="btn-gold inline-flex h-11 items-center rounded-full px-6 text-[13px] font-extrabold disabled:opacity-60"
            >
              {pending ? "Sending…" : readPendingOtp(email) ? "Enter current code" : retryAfter > 0 ? `New code available in ${formatRemaining(retryAfter)}` : "Send my code"}
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="grid gap-3.5">
          <p className="text-[13px] leading-relaxed text-soft">
            If a booking or package purchase is linked to <strong className="text-ink">{email}</strong>, a code was sent. Use the same code until it expires. You can request a replacement when the countdown reaches zero. If you leave and return, enter this email again to continue with the active code. Check spam if it didn&rsquo;t arrive.
          </p>
          <p className="rounded-[12px] bg-[#eaf5df] px-3 py-2 text-[12px] leading-relaxed text-[#31543a]">
            You can still view or pay for your booking. Online date changes close 48 hours before the lesson; for a late change, call{" "}
            <a href="tel:+12362343229" className="font-extrabold underline underline-offset-2">Shan at +1 236-234-3229</a>.
          </p>
          <label className="grid gap-1.5 text-[12px] font-bold text-ink">
            Verification code
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="h-11 w-full rounded-[12px] border border-[#d7dfdc] bg-white px-3 text-center text-[19px] font-extrabold tracking-[0.35em] text-ink outline-none focus:border-[#83b657]"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={pending || code.length !== 6}
              className="btn-gold inline-flex h-10 items-center rounded-full px-5 text-[13px] font-extrabold disabled:opacity-60"
            >
              {pending ? "Checking…" : "Verify & show my bookings"}
            </button>
            <button
              type="button"
              onClick={() => requestCode()}
              disabled={pending || retryAfter > 0}
              className="inline-flex h-10 items-center rounded-full border border-line bg-white px-4 text-[13px] font-extrabold text-ink transition-colors hover:border-[#83b657] hover:text-[#426a2c] disabled:opacity-60"
            >
            {retryAfter > 0 ? `Code expires in ${formatRemaining(retryAfter)}` : "Request a new code"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center px-2 text-[13px] font-bold text-soft hover:text-gold-deep"
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      {step === "list" && (
        <div className="grid gap-3">
          {studentName && (
            <h3 className="font-display text-[23px] font-extrabold tracking-[-0.04em] text-ink">
              Welcome back, {studentName}!
            </h3>
          )}
      {bookings.length === 0 && purchases.length === 0 ? (
            <p className="rounded-[10px] bg-mist px-3.5 py-2.5 text-[13px] font-bold text-soft">
              We verified this email, but couldn’t find a booking or package purchase linked to it. Check that you entered the same email used at checkout, or contact the school and we’ll help locate it.
            </p>
          ) : bookings.length > 0 && (
            bookings.map((booking) => (
              <div
                key={booking.reference}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[17px] border border-line bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-extrabold text-ink">
                    {booking.lessonName}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                        booking.status === "cancelled" || booking.status === "completed" || booking.status === "no_show" || (now !== null && Date.parse(booking.startsAt) <= now)
                          ? "bg-mist text-soft"
                          : booking.status === "rescheduled"
                            ? "bg-[#eaf5df] text-[#426a2c]"
                            : "bg-[#e6f6ec] text-[#1f7a45]"
                      }`}
                    >
                      {booking.status === "no_show" || (now !== null && Date.parse(booking.startsAt) <= now) ? "Expired" : STATUS_LABEL[booking.status] ?? booking.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-soft">
                    {formatSlotFull(booking.startsAt)} · {booking.reference} · {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "due" ? "Awaiting payment" : booking.paymentStatus}
                  </p>
                </div>
                {booking.canOpen || booking.status === "cancelled" || booking.status === "completed" || booking.status === "no_show" ? (
                  <button
                    type="button"
                    onClick={() => openBooking(booking.reference)}
                    disabled={pending}
                    className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-4 text-[12.5px] font-extrabold text-white transition-colors hover:bg-[#183c37] disabled:opacity-60"
                  >
                    {booking.status === "no_show" || (now !== null && Date.parse(booking.startsAt) <= now) ? "View lesson" : "View booking"}
                  </button>
                ) : (
                  <div className="text-right">
                    <p className="text-[11px] font-semibold text-[#9a4d25]">
                      Less than 48 hours
                    </p>
                    <a
                      href="tel:+12362343229"
                      className="text-[12px] font-extrabold text-gold-deep underline-offset-2 hover:underline"
                    >
                      Call Shan
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
          {purchases.length > 0 && (
            <div className="mt-2 grid gap-2 border-t border-line pt-4">
              <h4 className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-[#426a2c]">Package purchases</h4>
              {purchases.map((purchase) => (
                <div key={purchase.reference} className="flex flex-wrap items-center justify-between gap-3 rounded-[17px] border border-line bg-white px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-extrabold text-ink">{purchase.lessonName}</p>
                    <p className="mt-0.5 text-[12.5px] text-soft">{purchase.creditsAvailable} of {purchase.creditsPurchased} lessons remaining to schedule · {purchase.paymentStatus === "paid" ? "Paid" : purchase.paymentStatus}</p>
                    {purchase.purchasedAt && <p className="mt-0.5 text-[11px] text-soft">Purchased {new Date(purchase.purchasedAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })} · {purchase.reference}</p>}
                    {purchase.validUntil && <p className="mt-0.5 text-[11px] text-soft">Valid through {new Date(purchase.validUntil).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}</p>}
                  </div>
                  {purchase.canOpen && (
                    <button type="button" onClick={() => openBooking(purchase.reference)} disabled={pending} className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-4 text-[12.5px] font-extrabold text-white transition-colors hover:bg-[#183c37] disabled:opacity-60">
                      View package
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center px-2 text-[13px] font-bold text-soft hover:text-gold-deep"
            >
              Use a different email
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="rounded-[10px] bg-[#e6f6ec] px-3.5 py-2.5 text-[13px] font-bold text-[#1f7a45]">
          {message}
        </p>
      )}
      {error && (
        error === "That code has expired. Send a new one." ? (
          <div role="alert" className="grid gap-1.5 rounded-[10px] bg-[#fff0ed] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#8f3429]">
            <p className="font-semibold">Your verification code expired. Select <strong>Resend code</strong> to get a new one.</p>
            <p>If your lesson is today or within 48 hours, online rescheduling is closed. Please call Shan at <a href="tel:+12362343229" className="font-extrabold underline underline-offset-2">+1 236-234-3229</a> to request a change.</p>
          </div>
        ) : (
          <p role="alert" className="rounded-[10px] bg-[#fff0ed] px-3.5 py-2.5 text-[13px] font-semibold text-[#bc4633]">
            {error}
          </p>
        )
      )}
      {step === "email" ? (
        <button type="button" onClick={() => router.back()} className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-[#83b657] hover:bg-[#f7fbed]">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf5df] text-[#426a2c]">←</span>
          Back
        </button>
      ) : (
        <button type="button" onClick={() => { setError(null); setMessage(null); setStep(step === "list" ? "code" : "email"); }} className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-[#83b657] hover:bg-[#f7fbed]">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf5df] text-[#426a2c]">←</span>
          {step === "list" ? "Back to verification" : "Back to email"}
        </button>
      )}
    </div>
  );
}
