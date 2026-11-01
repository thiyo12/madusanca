import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import type { BookingStatus } from "@/lib/booking/types";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { StatusChip } from "@/components/admin/status-chip";
import { BookingActions } from "./booking-actions";
import { adminStudentHref } from "@/lib/admin/urls";

export const metadata: Metadata = {
  title: "Bookings — Wisdom Driving Academy Admin",
};

const STATUSES: BookingStatus[] = ["pending_payment", "confirmed", "rescheduled", "completed", "cancelled"];
type Range = "upcoming" | "past" | "all";

interface BookingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminBookingsPage({ searchParams }: BookingsPageProps) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const statusParam = typeof params.status === "string" ? params.status : "";
  const status = STATUSES.includes(statusParam as BookingStatus)
    ? (statusParam as BookingStatus)
    : undefined;
  const range: Range =
    params.range === "past" || params.range === "all"
      ? (params.range as Range)
      : "upcoming";
  const errorMessage = typeof params.error === "string" ? params.error : null;

  const nowIso = new Date().toISOString();
  const store = getStore();
  const bookings = await store.listBookings({
    search: q || undefined,
    status,
    fromIso: range === "upcoming" ? nowIso : undefined,
    toIso: range === "past" ? nowIso : undefined,
  });

  const rangeLinks: Array<{ key: Range; label: string }> = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "all", label: "All" },
  ];

  function rangeHref(key: Range): string {
    const search = new URLSearchParams();
    search.set("range", key);
    if (q) search.set("q", q);
    if (status) search.set("status", status);
    return `/admin/bookings?${search.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
            Admin
          </p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            Bookings
          </h1>
        </div>
        <div className="flex gap-2" role="group" aria-label="Date range">
          {rangeLinks.map((item) => (
            <Link
              key={item.key}
              href={rangeHref(item.key)}
              aria-pressed={range === item.key}
              className={`inline-flex h-9 items-center rounded-[9px] px-3.5 text-[12.5px] font-extrabold transition-colors ${
                range === item.key
                  ? "bg-ink text-white"
                  : "border border-line bg-white text-soft hover:border-gold hover:text-gold-deep"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-5 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
          {errorMessage}
        </p>
      )}

      <form method="GET" className="mt-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value={range} />
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
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-[10px] border border-[#dce0e4] bg-white px-3 text-sm text-ink outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/25"
          >
            <option value="">Any status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
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
        {bookings.length === 0 ? (
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
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bookings.map((booking) => (
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
                        <Link href={adminStudentHref(booking.id)} className="text-[13px] font-bold text-ink underline decoration-line underline-offset-2 hover:text-gold-deep">
                          {booking.studentName}
                        </Link>
                      <p className="text-[12px] text-soft">{booking.email}</p>
                      <p className="text-[12px] text-soft">{booking.phone}</p>
                      {booking.notes && (
                        <p className="mt-2 max-w-[280px] whitespace-pre-line text-[11.5px] leading-relaxed text-soft">
                          {booking.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-semibold text-ink">{booking.lessonName}</p>
                      <p className="text-[12px] text-soft">${booking.priceCad} CAD</p>
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
                        <a href={booking.stripeInvoiceUrl} target="_blank" rel="noreferrer" className="mt-block block text-[10px] font-extrabold text-[#426a2c] underline underline-offset-2 hover:text-[#1f7a45]">
                          View invoice
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end">
                        <BookingActions
                          bookingId={booking.id}
                          lessonId={booking.lessonId}
                          status={booking.status}
                          startsAt={booking.startsAt}
                          paymentStatus={booking.paymentStatus ?? "due"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-[12.5px] leading-relaxed text-soft">
        Status changes and reschedules email the student automatically. Payment
        status can be updated on the <Link href="/admin/payments">Payments</Link> page.
      </p>
    </div>
  );
}
