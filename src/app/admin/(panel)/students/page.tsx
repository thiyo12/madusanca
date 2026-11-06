import type { Metadata } from "next";
import Link from "next/link";
import { formatSlotDay } from "@/lib/booking/format";
import { adminStudentHref } from "@/lib/admin/urls";
import { allStudentProfiles, bookingsForStudent } from "@/lib/admin/student-profiles";

export const metadata: Metadata = {
  title: "Students — Wisdom Driving Academy Admin",
};

export default async function AdminStudentsPage() {
  const nowIso = new Date().toISOString();
  const profiles = await allStudentProfiles();
  const students = await Promise.all(profiles.map(async (profile) => {
    const bookings = await bookingsForStudent(profile.id);
    const included = bookings.filter((booking) => ["pending_payment","confirmed","rescheduled","completed"].includes(booking.status));
    const sorted = [...included].sort((a,b) => a.startsAt.localeCompare(b.startsAt));
    return { bookingId: bookings[0]?.id, profile, lessonCount: included.length,
      lastLesson: sorted.at(-1)?.startsAt ?? null,
      upcoming: bookings.filter((b) => ["pending_payment","confirmed","rescheduled"].includes(b.status) && b.startsAt >= nowIso).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null,
      spentCad: included.reduce((sum,b) => sum+b.priceCad,0) };
  }));
  students.sort((a,b) => (b.lastLesson ?? "").localeCompare(a.lastLesson ?? "") || a.profile.full_name.localeCompare(b.profile.full_name));

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
        Admin
      </p>
      <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
        Students
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
        Student profiles stay separate unless an administrator explicitly links bookings. {students.length} {students.length === 1 ? "student" : "students"} on record.
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
                  <tr key={student.profile.id} className="hover:bg-[#fcfcfd]">
                    <td className="px-4 py-3.5">
                      <Link
                        href={adminStudentHref(student.bookingId ?? "")}
                        className="text-[13.5px] font-bold text-ink underline decoration-line underline-offset-2 hover:text-gold-deep"
                      >
                        {student.profile.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[12.5px] text-soft">{student.profile.email}</p>
                      <p className="text-[12.5px] text-soft">{student.profile.phone || "—"}</p>
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
