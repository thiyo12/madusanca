import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/booking/store";
import type { BookingRecord } from "@/lib/booking/types";
import { formatSlotDay } from "@/lib/booking/format";
import { adminStudentHref } from "@/lib/admin/urls";

export const metadata: Metadata = {
  title: "Students — Wisdom Driving Academy Admin",
};

interface StudentRow {
  bookingId: string;
  name: string;
  email: string;
  phone: string;
  lessonCount: number;
  lastLesson: string | null;
  upcoming: string | null;
  spentCad: number;
}

function deriveStudents(bookings: BookingRecord[]): StudentRow[] {
  const byEmail = new Map<string, StudentRow>();

  for (const booking of bookings) {
    const key = booking.email.toLowerCase();
    const existing = byEmail.get(key);
    const counts =
      booking.status === "pending_payment" ||
      booking.status === "confirmed" ||
      booking.status === "rescheduled" ||
      booking.status === "completed";

    if (!existing) {
      byEmail.set(key, {
        bookingId: booking.id,
        name: booking.studentName,
        email: booking.email,
        phone: booking.phone,
        lessonCount: counts ? 1 : 0,
        lastLesson: counts ? booking.startsAt : null,
        upcoming: null,
        spentCad: counts ? booking.priceCad : 0,
      });
      continue;
    }

    if (counts) {
      existing.lessonCount += 1;
      existing.spentCad += booking.priceCad;
      if (!existing.lastLesson || booking.startsAt > existing.lastLesson) {
        existing.lastLesson = booking.startsAt;
      }
    }
    if (booking.phone && !existing.phone) existing.phone = booking.phone;
  }

  const nowIso = new Date().toISOString();
  for (const booking of bookings) {
    if (
      (booking.status === "pending_payment" || booking.status === "confirmed" || booking.status === "rescheduled") &&
      booking.startsAt >= nowIso
    ) {
      const row = byEmail.get(booking.email.toLowerCase());
      if (row && (!row.upcoming || booking.startsAt < row.upcoming)) {
        row.upcoming = booking.startsAt;
      }
    }
  }

  return [...byEmail.values()].sort((a, b) => {
    if (b.lastLesson && a.lastLesson) return b.lastLesson.localeCompare(a.lastLesson);
    if (b.lastLesson) return 1;
    if (a.lastLesson) return -1;
    return a.name.localeCompare(b.name);
  });
}

export default async function AdminStudentsPage() {
  const store = getStore();
  const bookings = await store.listBookings();
  const students = deriveStudents(bookings);

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
        Admin
      </p>
      <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
        Students
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
        Derived from bookings — no separate account or profile is created for
        students. {students.length} {students.length === 1 ? "student" : "students"} on record.
      </p>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-white">
        {students.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-soft">
            No students yet — bookings will appear here automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-mist text-[11px] font-extrabold uppercase tracking-wide text-soft">
                  <th scope="col" className="px-4 py-3">Student</th>
                  <th scope="col" className="px-4 py-3">Contact</th>
                  <th scope="col" className="px-4 py-3">Lessons</th>
                  <th scope="col" className="px-4 py-3">Last lesson</th>
                  <th scope="col" className="px-4 py-3">Next lesson</th>
                  <th scope="col" className="px-4 py-3 text-right">Booked value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {students.map((student) => (
                  <tr key={student.email.toLowerCase()} className="hover:bg-[#fcfcfd]">
                    <td className="px-4 py-3.5">
                      <Link
                        href={adminStudentHref(student.bookingId)}
                        className="text-[13.5px] font-bold text-ink underline decoration-line underline-offset-2 hover:text-gold-deep"
                      >
                        {student.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[12.5px] text-soft">{student.email}</p>
                      <p className="text-[12.5px] text-soft">{student.phone || "—"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-[13px] font-semibold text-ink">
                      {student.lessonCount}
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] text-soft">
                      {student.lastLesson ? formatSlotDay(student.lastLesson) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] text-soft">
                      {student.upcoming ? formatSlotDay(student.upcoming) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[13px] font-extrabold text-ink">
                      ${student.spentCad} CAD
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
