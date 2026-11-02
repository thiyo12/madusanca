import type { Metadata } from "next";
import { getStore } from "@/lib/booking/store";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { setBookingPaymentAction, updateBookingChequeAction, updatePackageChequeAction } from "../bookings/actions";
import { listPaidCheckoutSessions, paymentReportRange } from "@/lib/stripe/payment-report";
import { stripeMode } from "@/lib/stripe/server";
import { logSafeError } from "@/lib/server/safe-log";

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
  { value: "waived", label: "Waived" },
];

export default async function AdminPaymentsPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const paymentStatusParam = typeof params.payment === "string" ? params.payment : "";
  const paymentStatus = PAYMENT_STATUSES.some((s) => s.value === paymentStatusParam)
    ? paymentStatusParam
    : undefined;

  const store = getStore();
  const bookings = await store.listBookings({
    search: q || undefined,
  });
  const packagePurchases = await store.listPackagePurchases(200);
  const filteredPurchases = q
    ? packagePurchases.filter((purchase) =>
        `${purchase.reference} ${purchase.studentName} ${purchase.email} ${purchase.lessonName}`
          .toLowerCase().includes(q.toLowerCase()),
      )
    : packagePurchases;
  const creditEvents = await store.listPackageCreditEvents(filteredPurchases.map((purchase) => purchase.id));
  const eventsByPurchase = new Map<string, typeof creditEvents>();
  for (const event of creditEvents) {
    const events = eventsByPurchase.get(event.purchaseId) ?? [];
    events.push(event);
    eventsByPurchase.set(event.purchaseId, events);
  }
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
            Stripe confirms Checkout payments. Use Stripe Dashboard for refunds; this page can waive or restore an unpaid balance.
          </p>
        </div>
      </div>

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
              Download successful Stripe Checkout payments for the current Pacific Time week or month. Reports show customer-paid gross totals and GST, before Stripe processing fees; they are not payout or refund reports.
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
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="/admin/payments/report?period=week" className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-extrabold">
            Download this week (CSV)
          </a>
          <a href="/admin/payments/report?period=month" className="inline-flex h-10 items-center rounded-[10px] border border-line px-4 text-[13px] font-extrabold text-ink hover:bg-mist">
            Download this month (CSV)
          </a>
        </div>
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
          <select
            name="payment"
            defaultValue={paymentStatus ?? ""}
            className="h-10 rounded-[10px] border border-[#dce0e4] bg-white px-3 text-sm text-ink outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/25"
          >
            {PAYMENT_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
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
                          : booking.paymentStatus === "waived"
                          ? "border-[#fdecea] bg-[#fff5f2] text-[#bc4633]"
                          : "border border-line bg-white text-soft"
                      }`}>
                        {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : booking.paymentStatus === "waived" ? "Waived" : "Due"}
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
                      <div className="flex justify-end gap-2">
                        {(booking.paymentStatus === "due" || booking.paymentStatus === "waived") && <form
                          action={async () => {
                            "use server";
                            await setBookingPaymentAction(
                              booking.id,
                              booking.paymentStatus === "waived" ? "due" : "waived",
                            );
                          }}
                        >
                          <button
                            type="submit"
                            className="inline-flex h-8 items-center rounded-[8px] px-3 text-[11.5px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50 border border-[#cce6b1] bg-[#f1f9e9] text-[#385a22] hover:bg-[#cce6b1]"
                          >
                            {booking.paymentStatus === "waived" ? "Restore Due" : "Waive Balance"}
                          </button>
                        </form>}
                        <form action={updateBookingChequeAction} className="mt-2 grid gap-1.5">
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <select name="status" defaultValue={booking.chequeStatus ?? "none"} aria-label={`Cheque status for ${booking.reference}`} className="h-8 rounded border border-line bg-white px-2 text-[11px]">
                            <option value="none">No cheque</option><option value="received">Received</option><option value="cleared">Cleared</option><option value="returned">Returned</option>
                          </select>
                          <input name="reference" defaultValue={booking.chequeReference ?? ""} maxLength={80} aria-label={`Cheque reference for ${booking.reference}`} placeholder="Cheque ref (optional)" className="h-8 w-32 rounded border border-line px-2 text-[10px]" />
                          <button type="submit" className="h-7 rounded bg-mist px-2 text-[10px] font-bold text-ink hover:bg-line">Save cheque</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="mt-8" aria-labelledby="package-purchases-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="package-purchases-title" className="font-display text-xl font-extrabold text-ink">Package purchases &amp; credit balances</h2>
            <p className="mt-1 text-[12.5px] text-soft">Recent purchase snapshots with credit totals derived from the append-only ledger. This view is read-only; refunds and credit corrections require review.</p>
          </div>
          <p className="text-[12px] font-bold text-soft">Showing up to 200 recent purchases</p>
        </div>
        <div className="mt-4 overflow-hidden rounded-[18px] border border-line bg-white">
          {filteredPurchases.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-soft">No package purchases match this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-mist text-[11px] font-extrabold uppercase tracking-wide text-soft">
                    <th scope="col" className="px-4 py-3">Purchased</th>
                    <th scope="col" className="px-4 py-3">Customer</th>
                    <th scope="col" className="px-4 py-3">Package</th>
                    <th scope="col" className="px-4 py-3">Reference / source</th>
                    <th scope="col" className="px-4 py-3">Payment</th>
                    <th scope="col" className="px-4 py-3 text-right">Credits</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredPurchases.map((purchase) => (
                    <tr key={purchase.id} className="align-top hover:bg-[#fcfcfd]">
                      <td className="px-4 py-3.5 text-[12.5px] text-ink">
                        {purchase.purchasedAt ? formatSlotDay(purchase.purchasedAt) : "Legacy date unavailable"}
                        {purchase.validUntil && <p className="mt-1 text-[11px] text-soft">Valid until {formatSlotDay(purchase.validUntil)}</p>}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-bold text-ink">{purchase.studentName}</p>
                        <p className="text-[12px] text-soft">{purchase.email}</p>
                        {purchase.phone && <p className="text-[12px] text-soft">{purchase.phone}</p>}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-semibold text-ink">{purchase.lessonName}</p>
                        <p className="text-[12px] text-soft">{purchase.durationMin} min/session · {purchase.creditsPurchased} purchased</p>
                      </td>
                      <td className="px-4 py-3.5 text-[12px]">
                        <p className="font-bold text-ink">{purchase.reference}</p>
                        <p className="mt-1 text-soft">{purchase.source === "legacy_backfill" ? "Legacy package" : "Independent purchase"}</p>
                        {purchase.stripeInvoiceUrl && <a href={purchase.stripeInvoiceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-bold text-[#426a2c] underline">Stripe invoice</a>}
                      </td>
                      <td className="px-4 py-3.5">
                        <PackagePaymentChip status={purchase.paymentStatus} />
                        <p className="mt-1 text-[10px] font-semibold text-soft">Cheque: {purchase.chequeStatus ?? "none"}{purchase.chequeReference ? ` · ${purchase.chequeReference}` : ""}</p>
                        <form action={updatePackageChequeAction} className="mt-2 grid gap-1.5">
                          <input type="hidden" name="purchaseId" value={purchase.id} />
                          <select name="status" defaultValue={purchase.chequeStatus ?? "none"} aria-label={`Cheque status for package ${purchase.reference}`} className="h-8 rounded border border-line bg-white px-2 text-[11px]">
                            <option value="none">No cheque</option><option value="received">Received</option><option value="cleared">Cleared</option><option value="returned">Returned</option>
                          </select>
                          <input name="reference" defaultValue={purchase.chequeReference ?? ""} maxLength={80} aria-label={`Cheque reference for package ${purchase.reference}`} placeholder="Cheque ref (optional)" className="h-8 w-32 rounded border border-line px-2 text-[10px]" />
                          <button type="submit" className="h-7 rounded bg-mist px-2 text-[10px] font-bold text-ink hover:bg-line">Save cheque</button>
                        </form>
                        {purchase.stripePaymentIntentId && <p className="mt-1 max-w-[150px] truncate text-[10px] text-soft" title={purchase.stripePaymentIntentId}>PI {purchase.stripePaymentIntentId}</p>}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <p className="text-[13px] font-extrabold text-ink">{purchase.creditsAvailable} available</p>
                        <p className="text-[11px] text-soft">of {purchase.creditsPurchased}</p>
                        <details className="mt-2 text-left">
                          <summary className="cursor-pointer text-[10.5px] font-bold text-[#426a2c] underline underline-offset-2">
                            Ledger ({eventsByPurchase.get(purchase.id)?.length ?? 0})
                          </summary>
                          <ol className="mt-2 grid min-w-[230px] gap-2">
                            {(eventsByPurchase.get(purchase.id) ?? []).map((event) => (
                              <li key={event.id} className="rounded-[9px] bg-mist p-2 text-[10.5px] leading-relaxed">
                                <p className="font-extrabold text-ink">{event.eventType.replaceAll("_", " ")} · {event.quantityDelta > 0 ? "+" : ""}{event.quantityDelta}</p>
                                <p className="text-soft">{new Date(event.createdAt).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}</p>
                                {event.bookingId && <p className="break-all text-soft">Booking {event.bookingId}</p>}
                                {event.note && <p className="text-soft">{event.note}</p>}
                                <p className="break-all text-[9px] text-soft">{event.sourceKey}</p>
                              </li>
                            ))}
                          </ol>
                        </details>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <p className="text-[13px] font-extrabold text-ink">{purchase.amountCad.toLocaleString("en-CA", { style: "currency", currency: "CAD" })}</p>
                        {purchase.stripeTotalCad !== undefined && <p className="text-[11px] text-soft">{purchase.stripeTotalCad.toLocaleString("en-CA", { style: "currency", currency: "CAD" })} incl. tax</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PackagePaymentChip({ status }: { status: string }) {
  const tone = status === "paid"
    ? "bg-[#e6f6ec] text-[#1f7a45]"
    : status === "refunded" || status === "failed"
      ? "bg-[#fdecea] text-[#bc4633]"
      : status === "waived"
        ? "bg-[#fff9e9] text-[#735c1e]"
        : "bg-mist text-soft";
  return <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide ${tone}`}>{status.replaceAll("_", " ")}</span>;
}
