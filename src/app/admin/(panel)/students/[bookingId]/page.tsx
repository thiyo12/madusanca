import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "@/components/admin/status-chip";
import { formatLessonPrice } from "@/lib/data/lessons";
import { formatSlotDay, formatSlotTime } from "@/lib/booking/format";
import { getStudentBookingsByAnchor } from "@/lib/admin/student-record";
import { pickupLocation } from "@/lib/admin/student-record-format";
import { adminStudentPdfHref } from "@/lib/admin/urls";
import { BookingActions } from "../../bookings/booking-actions";

export const metadata: Metadata = {
  title: "Student bookings — Wisdom Driving Academy Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const bookings = await getStudentBookingsByAnchor(bookingId);
  const student = bookings?.[0];
  if (!student || !bookings) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/students" className="text-[12.5px] font-bold text-gold-deep hover:underline">
        ← Students
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">Admin · Student record</p>
          <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
            {student.studentName}
          </h1>
          <p className="mt-1 text-sm text-soft">{student.email} · {student.phone || "No phone recorded"}</p>
        </div>
        <a
          href={adminStudentPdfHref(bookingId)}
          className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[12px] font-extrabold"
        >
          Download student PDF
        </a>
      </div>

      <div className="mt-6 grid gap-4">
        {bookings.map((booking, index) => {
          const location = pickupLocation(booking.notes);
          return (
            <section key={booking.id} className="rounded-[16px] border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-extrabold text-ink">Session {index + 1} · {booking.lessonName}</h2>
                    <StatusChip status={booking.status} />
                  </div>
                  <p className="mt-2 text-[13px] font-semibold text-ink">
                    {formatSlotDay(booking.startsAt)} · {formatSlotTime(booking.startsAt)} Pacific Time
                  </p>
                  <p className="mt-1 text-[12.5px] text-soft">Duration: {booking.durationMin} minutes · Reference: {booking.reference}</p>
                  <p className="mt-1 text-[12.5px] text-soft">Location: {location ?? "Not recorded"}</p>
                  <p className="mt-1 text-[12.5px] text-soft">
                    {booking.paymentStatus === "paid" ? "Paid" : booking.paymentStatus === "refunded" ? "Refunded" : booking.paymentStatus === "waived" ? "Waived" : "Payment due"}
                    {" · Package total: "}{formatLessonPrice(booking.packagePriceCad ?? booking.priceCad)}
                  </p>
                  {booking.notes && (
                    <details className="mt-3 text-[12px] text-soft">
                      <summary className="cursor-pointer font-bold text-ink">Additional booking details</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-sans leading-relaxed">{booking.notes}</pre>
                    </details>
                  )}
                </div>
                <BookingActions
                  bookingId={booking.id}
                  lessonId={booking.lessonId}
                  status={booking.status}
                  startsAt={booking.startsAt}
                  paymentStatus={booking.paymentStatus ?? "due"}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
