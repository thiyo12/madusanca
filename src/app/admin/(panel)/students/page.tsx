import type { Metadata } from "next";
import Link from "next/link";
import { formatSlotDay } from "@/lib/booking/format";
import { adminStudentHref } from "@/lib/admin/urls";
import { allStudentProfiles, bookingsForStudent } from "@/lib/admin/student-profiles";

export const metadata: Metadata = {
  title: "Students — Wisdom Driving Academy Admin",
};

export default async function AdminStudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const nowIso = new Date().toISOString();
  const profiles = await allStudentProfiles();
  const students = await Promise.all(profiles.map(async (profile) => {
    const bookings = await bookingsForStudent(profile.id);
    const included = bookings.filter((booking) => ["pending_payment","confirmed","rescheduled","completed"].includes(booking.status));
    const sorted = [...included].sort((a,b) => a.startsAt.localeCompare(b.startsAt));
    return { bookingId: bookings[0]?.id, profile, lessonCount: included.length,
      lastLesson: sorted.at(-1)?.startsAt ?? null,
      upcoming: bookings.filter((b) => ["pending_payment","confirmed","rescheduled"].includes(b.status) && b.startsAt >= nowIso).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null,
      spentCad: included.reduce((sum,b) => sum+b.priceCad,0),
      bookings };
  }));
  const filteredStudents = query ? students.filter(({ profile, bookings }) => {
    const normalized = query.toLowerCase();
    return [profile.full_name, profile.email, profile.license_number, ...bookings.map((booking) => booking.reference)]
      .some((value) => value?.toLowerCase().includes(normalized));
  }) : students;
  filteredStudents.sort((a,b) => (b.lastLesson ?? "").localeCompare(a.lastLesson ?? "") || a.profile.full_name.localeCompare(b.profile.full_name));
  const today = new Date().toISOString().slice(0, 10);
  const fiveYearsAgo = new Date(Date.UTC(new Date().getUTCFullYear() - 5, new Date().getUTCMonth(), new Date().getUTCDate())).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
        Admin
      </p>
      <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
        Students
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
        Repeat bookings link to an existing student only when email and full name match one profile. Email alone never merges students. {filteredStudents.length} of {students.length} {students.length === 1 ? "student" : "students"} shown.
      </p>

      <div className="mt-5 grid gap-3 rounded-[16px] border border-line bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <form action="/admin/students" className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-[220px] flex-1 gap-1 text-[11px] font-bold text-soft">Search students
            <input name="q" type="search" maxLength={160} defaultValue={query} placeholder="Name, email, licence number, or booking reference" className="h-10 rounded-lg border border-line px-3 text-sm text-ink" />
          </label>
          <button className="h-10 rounded-lg bg-ink px-4 text-xs font-extrabold text-white">Search</button>
          {query && <Link href="/admin/students" className="h-10 content-center px-2 text-xs font-bold text-gold-deep">Clear</Link>}
        </form>
        <form action="/admin/students/export" className="flex flex-wrap items-end gap-2 border-t border-line pt-3 md:border-l md:border-t-0 md:pl-3 md:pt-0">
          <label className="grid gap-1 text-[10px] font-bold text-soft">From<input type="date" name="start" required defaultValue={fiveYearsAgo} className="h-10 rounded-lg border border-line px-2 text-xs text-ink" /></label>
          <label className="grid gap-1 text-[10px] font-bold text-soft">To<input type="date" name="end" required defaultValue={today} className="h-10 rounded-lg border border-line px-2 text-xs text-ink" /></label>
          <button className="h-10 rounded-lg border border-line px-3 text-xs font-extrabold text-ink hover:border-gold">Download student data CSV</button>
        </form>
        <p className="text-[11px] leading-relaxed text-soft md:col-span-2">Admin-only export by lesson date. Student records are retained for five years; credentials and verification codes are never included.</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-white">
        {filteredStudents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-soft">
            {query ? "No students match that name, email, licence number, or booking reference." : "No students yet — bookings will appear here automatically."}
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
                {filteredStudents.map((student) => (
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
