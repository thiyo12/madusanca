import type { Metadata } from "next";
import { getStore } from "@/lib/booking/store";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { setBookingPaymentAction } from "../bookings/actions";

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

  const nowIso = new Date().toISOString();
  const store = getStore();
  const bookings = await store.listBookings({
    search: q || undefined,
    fromIso: nowIso,
  });

  const filtered = paymentStatus
    ? bookings.filter((b) => b.paymentStatus === paymentStatus)
    : bookings;

  const totals = filtered.reduce(
    (acc, b) => {
      if (b.paymentStatus === "paid") {
        acc.paidCount += 1;
        acc.paidTotal += b.stripeTotalCad ?? b.priceCad;
      } else if (b.paymentStatus === "due") {
        acc.dueCount += 1;
        acc.dueTotal += b.priceCad;
      }
      return acc;
    },
    { paidCount: 0, paidTotal: 0, dueCount: 0, dueTotal: 0 },
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
            Stripe confirms successful payments and refunds automatically.
            Admin actions here can waive a balance or restore it to due status.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[16px] border border-line bg-white p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-soft">
            Collected
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            ${totals.paidTotal.toLocaleString("en-CA", {
              style: "currency",
              currency: "CAD",
            })}
          </p>
          <p className="mt-2 text-[12px] text-soft">{totals.paidCount} paid</p>
        </div>
        <div className="rounded-[16px] border border-line bg-white p-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-soft">
            Outstanding
          </p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink">
            ${totals.dueTotal.toLocaleString("en-CA", {
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
                  <th scope="col" className="px-4 py-3 text-right">Amount</th>
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
                        ${booking.priceCad.toLocaleString("en-CA", {
                          style: "currency",
                          currency: "CAD",
                        })}
                      </p>
                      {booking.stripeTotalCad &&
                        booking.stripeTotalCad !== booking.priceCad && (
                          <p className="text-[11px] text-soft">
                            incl. GST
                          </p>
                        )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end gap-2">
                        <form
                          action={async () => {
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
                        </form>
                        <form
                          action={async () => {
                            await setBookingPaymentAction(
                              booking.id,
                              booking.paymentStatus === "waived" ? "due" : "waived",
                            );
                          }}
                        >
                          <button
                            type="submit"
                            className="inline-flex h-8 items-center rounded-[8px] px-3 text-[11.5px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50 border border-[#fdecea] bg-[#fff5f2] text-[#bc4633] hover:bg-[#fdecea]"
                          >
                            {booking.paymentStatus === "waived" ? "Restore Due" : "Waive Balance"}
                          </button>
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
    </div>
  );
}
