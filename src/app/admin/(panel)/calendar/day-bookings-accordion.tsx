"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/admin/status-chip";
import { BookingActions } from "../bookings/booking-actions";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { adminStudentHref } from "@/lib/admin/urls";
import { occupiedDurationMin } from "@/lib/booking/slots";
import type { BookingStatus, PaymentStatus } from "@/lib/booking/types";

interface AppointmentHistory {
  id: string;
  lessonName: string;
  startsAt: string;
  status: BookingStatus;
  sessionIndex?: number;
  reference: string;
}

interface BookingItem {
  id: string;
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  studentName: string;
  email: string;
  phone: string;
  notes: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  sessionIndex: number;
  sessionCount: number;
  packagePriceCad: number;
}

interface PackagePlan {
  lessonName: string;
  reference: string;
  totalClasses: number;
  remainingClasses: number;
  paymentStatus: PaymentStatus;
  sessions: AppointmentHistory[];
}

interface AdditionalPackage {
  id: string;
  reference: string;
  lessonName: string;
  creditsPurchased: number;
  creditsAvailable: number;
  paymentStatus: string;
  amountCad: number;
  purchasedAt?: string;
  sessions: AppointmentHistory[];
}

export interface DayBookingAccordionEntry {
  booking: BookingItem;
  packagePlan: PackagePlan;
  additionalPackages: AdditionalPackage[];
  bookingHistory: AppointmentHistory[];
}

export function DayBookingsAccordion({
  entries,
  nowMs,
  initialOpenId = "",
}: {
  entries: DayBookingAccordionEntry[];
  nowMs: number;
  initialOpenId?: string;
}) {
  const [openId, setOpenId] = useState(initialOpenId);

  if (entries.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-soft">Nothing booked on this day.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {entries.map(({ booking, packagePlan, additionalPackages, bookingHistory }) => {
        const expanded = openId === booking.id;
        return (
          <li key={booking.id} id={`booking-${booking.id}`} className="scroll-mt-6 px-3 py-2 sm:px-4">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`booking-details-${booking.id}`}
              onClick={() => setOpenId((current) => current === booking.id ? "" : booking.id)}
              className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors sm:px-4 ${expanded ? "bg-[#fff9e9]" : "hover:bg-mist"}`}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="text-[14px] font-extrabold text-ink">{formatSlotTime(booking.startsAt)}</span>
                <span className="truncate text-[14px] font-bold text-ink">{booking.studentName}</span>
                <span className="text-[12px] text-soft">{booking.lessonName}</span>
                <StatusChip status={booking.status} />
              </span>
              <span className="shrink-0 text-[12px] font-extrabold text-gold-deep">{expanded ? "Close −" : "Details +"}</span>
            </button>

            {expanded && (
              <section id={`booking-details-${booking.id}`} className="grid gap-4 px-3 pb-4 pt-2 sm:px-4">
                <div>
                  <h3 className="text-[14px] font-extrabold text-ink">Class and student details</h3>
                  <dl className="mt-2 grid gap-x-5 gap-y-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
                    <div><dt className="text-soft">Lesson</dt><dd className="font-bold text-ink">{booking.lessonName}</dd></div>
                    <div><dt className="text-soft">Date and time</dt><dd className="font-bold text-ink">{formatSlotDay(booking.startsAt)} · {formatSlotTime(booking.startsAt)} Pacific</dd></div>
                    <div><dt className="text-soft">Class / reserved time</dt><dd className="font-bold text-ink">{booking.durationMin} / {occupiedDurationMin(booking.durationMin)} minutes</dd></div>
                    <div><dt className="text-soft">Payment</dt><dd className="font-bold text-ink">{booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : "Due"} · ${booking.priceCad.toFixed(2)} CAD</dd></div>
                    <div><dt className="text-soft">Email</dt><dd className="break-all font-bold text-ink"><a href={`mailto:${booking.email}`} className="underline underline-offset-2">{booking.email}</a></dd></div>
                    <div><dt className="text-soft">Phone</dt><dd className="font-bold text-ink">{booking.phone ? <a href={`tel:${booking.phone}`} className="underline underline-offset-2">{booking.phone}</a> : "Not recorded"}</dd></div>
                    <div><dt className="text-soft">Reference</dt><dd className="font-bold text-ink">{booking.reference}</dd></div>
                  </dl>
                  {booking.notes && <details className="mt-3 text-[12px] text-soft"><summary className="cursor-pointer font-bold text-ink">Student notes / pickup details</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans leading-relaxed">{booking.notes}</pre></details>}
                  <Link href={adminStudentHref(booking.id)} className="mt-3 inline-flex text-[12px] font-extrabold text-gold-deep underline underline-offset-2">Open full student record</Link>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <section className="rounded-xl border border-line bg-white p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><h4 className="text-[13px] font-extrabold text-ink">Booked package</h4><p className="mt-0.5 text-[12px] text-soft">{packagePlan.lessonName} · Ref {packagePlan.reference}</p></div>
                      <p className="rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-extrabold text-gold-deep">{packagePlan.remainingClasses} of {packagePlan.totalClasses} classes remaining</p>
                    </div>
                    <p className="mt-1 text-[11.5px] text-soft">Payment: {packagePlan.paymentStatus === "paid" ? "Paid" : packagePlan.paymentStatus === "refunded" ? "Refunded" : "Due"}</p>
                    <ol className="mt-3 grid gap-1.5">
                      {packagePlan.sessions.map((session) => (
                        <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-2.5 py-2 text-[11.5px]">
                          <span className="font-bold text-ink">{session.sessionIndex ? `Class ${session.sessionIndex} · ` : ""}{formatSlotDay(session.startsAt)} · {formatSlotTime(session.startsAt)} · {session.lessonName}</span>
                          <StatusChip status={session.status} />
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="rounded-xl border border-line bg-white p-3 sm:p-4">
                    <h4 className="text-[13px] font-extrabold text-ink">Additional packages</h4>
                    {additionalPackages.length === 0 ? <p className="mt-2 text-[12px] text-soft">No separate package purchases on this student account.</p> : (
                      <ul className="mt-2 grid gap-2">
                        {additionalPackages.map((purchase) => (
                          <li key={purchase.id} className="rounded-lg bg-mist px-2.5 py-2">
                            <p className="text-[12px] font-bold text-ink">{purchase.lessonName} · {purchase.creditsAvailable} of {purchase.creditsPurchased} credits left</p>
                            <p className="mt-0.5 text-[11px] text-soft">{purchase.paymentStatus} · ${purchase.amountCad.toFixed(2)} CAD · {purchase.reference}{purchase.purchasedAt ? ` · bought ${formatSlotDay(purchase.purchasedAt)}` : ""}</p>
                            {purchase.sessions.length > 0 ? <ol className="mt-2 grid gap-1">{purchase.sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-1.5 text-[11px]"><span className="font-semibold text-ink">{formatSlotDay(session.startsAt)} · {formatSlotTime(session.startsAt)} · {session.lessonName}</span><StatusChip status={session.status} /></li>)}</ol> : <p className="mt-1 text-[11px] text-soft">No lessons scheduled from this package yet.</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <details className="rounded-xl border border-line bg-white px-3 py-2.5">
                  <summary className="cursor-pointer text-[12px] font-extrabold text-ink">Booking history · {bookingHistory.length} class{bookingHistory.length === 1 ? "" : "es"}</summary>
                  <ol className="mt-2 grid gap-1.5">
                    {bookingHistory.map((session) => (
                      <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-2.5 py-2 text-[11.5px]">
                        <span className="font-semibold text-ink">{session.lessonName} · {formatSlotDay(session.startsAt)} · {formatSlotTime(session.startsAt)} · Ref {session.reference}</span>
                        <StatusChip status={session.status} />
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[10.5px] text-soft">This lists recorded class dates and statuses. Earlier time changes are not stored in the booking record.</p>
                </details>

                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-soft">Manage this class</p>
                  <BookingActions
                    bookingId={booking.id}
                    lessonId={booking.lessonId}
                    status={booking.status}
                    startsAt={booking.startsAt}
                    paymentStatus={booking.paymentStatus}
                    nowMs={nowMs}
                  />
                </div>
              </section>
            )}
          </li>
        );
      })}
    </ul>
  );
}
