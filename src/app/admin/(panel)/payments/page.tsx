import type { Metadata } from "next";
import { getStore } from "@/lib/booking/store";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { updateBookingChequeAction } from "../bookings/actions";
import { BookingPaymentActions } from "./booking-payment-actions";
import { listPaidCheckoutSessions, paymentReportRange } from "@/lib/stripe/payment-report";
import { stripeMode } from "@/lib/stripe/server";
import { logSafeError } from "@/lib/server/safe-log";
import { PaymentStatusFilter } from "./payment-status-filter";

export const metadata: Metadata = {
  title: "Payments — Wisdom Driving Academy Admin",
};

interface PaymentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAYMENT_STATUSES: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "due", label: "Due" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
];

export default async function AdminPaymentsPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;
  const actionError = typeof params.error === "string" ? params.error.slice(0, 300) : "";

  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const paymentStatusParam = typeof params.payment === "string" ? params.payment : "";
  const paymentStatus = PAYMENT_STATUSES.some((s) => s.value === paymentStatusParam)
    ? paymentStatusParam
    : undefined;

  const store = getStore();
  const bookings = await store.listBookings({
    search: q || undefined,
  });
  const mode = stripeMode();
  let reportSessions: Awaited<ReturnType<typeof listPaidCheckoutSessions>> | null = null;
  if (mode !== "unconfigured") {
    try {
      reportSessions = await listPaidCheckoutSessions(paymentReportRange("month"));
    } catch (error) {
      logSafeError("[admin/payments] monthly Stripe summary unavailable", error);
    }
  }

  const filtered = paymentStatus
    ? bookings.filter((b) => b.paymentStatus === paymentStatus)
    : bookings;

  const totals = filtered.reduce(
    (acc, b) => {
      if (b.paymentStatus === "due") {
        acc.dueCount += 1;
        acc.dueTotal += b.priceCad;
      }
      return acc;
    },
    { dueCount: 0, dueTotal: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
            Admin
          </p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            Payments
          </h1>
          <p className="mt-1 text-[12.5px] text-soft">
            Review booking payments, find amounts due, and record verified offline payments.
          </p>
        </div>
      </div>

      <section aria-labelledby="payments-howto" className="mt-4 rounded-[14px] border border-[#eadcb1] bg-[#fff9e9] p-4 sm:p-5">
        <h2 id="payments-howto" className="text-[13px] font-extrabold text-ink">How to use this page</h2>
        <ul className="mt-2 grid gap-2 text-[12px] leading-relaxed text-soft sm:grid-cols-2">
          <li><strong className="text-ink">Card payment:</strong> Stripe records it automatically. You do not need to press a payment button.</li>
          <li><strong className="text-ink">Offline payment:</strong> use Actions only after receiving cash, cheque, or another offline payment. Other lessons in the package stay due.</li>
          <li><strong className="text-ink">Stripe unavailable:</strong> the offline action is available for due lessons after any active Checkout window expires. Do not use it if a card payment may still complete.</li>
          <li><strong className="text-ink">Cheque:</strong> choose its status and press <strong className="text-ink">Save cheque details</strong> to keep a record. This tracks the cheque; it does not mark the booking paid.</li>
          <li><strong className="text-ink">Refund:</strong> issue the refund manually in Stripe first, then use the refund action here to record it.</li>
        </ul>
      </section>
      {actionError && <p role="alert" className="mt-3 rounded-lg border border-[#f3d1c9] bg-[#fff5f2] px-4 py-3 text-sm font-semibold text-[#bc4633]">{actionError}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[16px] border border-line bg-white p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-soft">
            Collected this month
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            {reportSessions === null
              ? "Unavailable"
              : (reportSessions.reduce((sum, session) => sum + (session.amount_total ?? 0), 0) / 100)
                .toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
          </p>
          <p className="mt-2 text-[12px] text-soft">
            {reportSessions === null ? "Stripe report could not be loaded" : `${reportSessions.length} successful Stripe Checkout payments`}
          </p>
        </div>
        <div className="rounded-[16px] border border-line bg-white p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-soft">
            Outstanding
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            {totals.dueTotal.toLocaleString("en-CA", {
              style: "currency",
              currency: "CAD",
            })}
          </p>
          <p className="mt-2 text-[12px] text-soft">{totals.dueCount} due</p>
        </div>
        <div className="rounded-[16px] border border-line bg-white p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-soft">
            Total bookings
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            {filtered.length}
          </p>
          <p className="mt-2 text-[12px] text-soft">
            {filtered.filter((b) => b.paymentStatus === "paid").length} paid ·{" "}
            {filtered.filter((b) => b.paymentStatus === "due").length} due
          </p>
        </div>
      </div>

      <section className="mt-6 rounded-[16px] border border-line bg-white p-5 sm:p-6" aria-labelledby="payment-reports-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="payment-reports-title" className="font-display text-lg font-extrabold text-ink">Download payment reports</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-soft">
              Download a list of successful card payments for this week or month. The total includes tax and is before Stripe fees; it is not your bank payout or refund total.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide ${mode === "live" ? "bg-[#e6f6ec] text-[#1f7a45]" : "bg-[#fff9e9] text-[#735c1e]"}`}>
            Stripe {mode === "live" ? "Live" : mode === "test" ? "Test mode" : mode === "unconfigured" ? "Not configured" : "Mode unknown"}
          </span>
        </div>
        {mode === "test" && (
          <p className="mt-3 rounded-[10px] bg-[#fff9e9] px-3.5 py-2.5 text-[12px] font-semibold text-[#735c1e]">
            Test mode only: these are sandbox payments. Customers will not be charged real money.
          </p>
        )}
        {mode === "unconfigured" || reportSessions === null ? (
          <p className="mt-4 rounded-[10px] bg-mist px-3.5 py-3 text-[12px] leading-relaxed text-soft">
            {mode === "unconfigured"
              ? "Stripe is not configured in this environment, so online payment CSV downloads are unavailable. Booking, cash, and cheque records remain available below."
              : "The Stripe payment report could not be reached, so CSV downloads are temporarily unavailable. Booking, cash, and cheque records remain available below; check the Stripe connection and try again."}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/admin/payments/report?period=week" className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-extrabold">
              Download this week (CSV)
            </a>
            <a href="/admin/payments/report?period=month" className="inline-flex h-10 items-center rounded-[10px] border border-line px-4 text-[13px] font-extrabold text-ink hover:bg-mist">
              Download this month (CSV)
            </a>
          </div>
        )}
      </section>

      <form method="GET" className="mt-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value="upcoming" />
        <label className="grid gap-1.5 text-[12px] font-bold text-[#282c33]">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, email, phone or reference"
            className="h-10 w-full min-w-[220px] rounded-[10px] border border-[#dce0e4] bg-white px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-[#9aa1a9] focus:border-gold focus:ring-[3px] focus:ring-gold/25 sm:w-[300px]"
          />
        </label>
        <label className="grid gap-1.5 text-[12px] font-bold text-[#282c33]">
          Payment status
          <PaymentStatusFilter defaultValue={paymentStatus ?? ""} />
        </label>
        <button
          type="submit"
          className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-extrabold"
        >
          Filter
        </button>
      </form>

      <div className="mt-5 overflow-hidden rounded-[18px] border border-line bg-white">
        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-soft">
            No bookings match this view.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-mist text-[11px] font-extrabold uppercase tracking-wide text-soft">
                  <th scope="col" className="px-4 py-3">When</th>
                  <th scope="col" className="px-4 py-3">Student</th>
                  <th scope="col" className="px-4 py-3">Lesson</th>
                  <th scope="col" className="px-4 py-3">Ref</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Payment</th>
                  <th scope="col" className="px-4 py-3 text-right">Package price</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((booking) => (
                  <tr key={booking.id} className="align-top hover:bg-[#fcfcfd]">
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-extrabold text-ink">
                        {formatSlotDay(booking.startsAt)}
                      </p>
                      <p className="text-[12.5px] text-soft">
                        {formatSlotTime(booking.startsAt)} · {booking.durationMin} min
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-bold text-ink">{booking.studentName}</p>
                      <p className="text-[12px] text-soft">{booking.email}</p>
                      <p className="text-[12px] text-soft">{booking.phone}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-semibold text-ink">{booking.lessonName}</p>
                      <p className="text-[12px] text-soft">{booking.durationMin} min</p>
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] font-bold text-soft">
                      {booking.reference}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusChip status={booking.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-[8px] px-2 py-1 text-[11px] font-extrabold ${
                        booking.paymentStatus === "paid"
                          ? "border-[#cce6b1] bg-[#f1f9e9] text-[#385a22]"
                          : booking.paymentStatus === "refunded"
                          ? "border-[#eadcb1] bg-[#fff9e9] text-[#735c1e]"
                          : "border border-line bg-white text-soft"
                      }`}>
                        {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : "Due"}
                      </span>
                      {booking.stripeInvoiceUrl && (
                        <a
                          href={booking.stripeInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-block block text-[10px] font-extrabold text-[#426a2c] underline underline-offset-2 hover:text-[#1f7a45]"
                        >
                          View Stripe invoice
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[13px] font-extrabold text-ink">
                        {booking.priceCad.toLocaleString("en-CA", {
                          style: "currency",
                          currency: "CAD",
                        })}
                      </p>
                      <p className="text-[11px] text-soft">before GST</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-[150px] flex-col items-end gap-2">
                        <BookingPaymentActions bookingId={booking.id} paymentStatus={booking.paymentStatus} />
                        <details className="text-left">
                          <summary className="cursor-pointer text-[10px] font-bold text-soft hover:text-ink">Cheque tracking</summary>
                          <form action={updateBookingChequeAction} className="mt-1.5 grid gap-1.5">
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <select name="status" defaultValue={booking.chequeStatus ?? "none"} aria-label={`Cheque status for ${booking.reference}`} className="h-8 rounded border border-line bg-white px-2 text-[11px]">
                              <option value="none">No cheque</option><option value="received">Received</option><option value="cleared">Cleared</option><option value="returned">Returned</option>
                            </select>
                            <input name="reference" defaultValue={booking.chequeReference ?? ""} maxLength={80} aria-label={`Cheque reference for ${booking.reference}`} placeholder="Cheque ref (optional)" className="h-8 w-32 rounded border border-line px-2 text-[10px]" />
                            <button type="submit" className="h-7 rounded bg-mist px-2 text-[10px] font-bold text-ink hover:bg-line">Save cheque details</button>
                          </form>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
