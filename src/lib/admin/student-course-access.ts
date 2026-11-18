import "server-only";
import { bookingsByCourse } from "@/lib/admin/course-groups";
import {
  bookingsForStudent,
  courseCompletionsForStudent,
  studentForBooking,
  type StudentCourseCompletion,
} from "@/lib/admin/student-profiles";
import type { BookingRecord } from "@/lib/booking/types";

export const COURSE_REPORT_RETENTION_DAYS = 45;

export interface BookingCourseAccess {
  completion: StudentCourseCompletion | null;
  reportAccessExpiresAt: string | null;
  isReadOnly: boolean;
  canViewReports: boolean;
}

export async function courseAccessForBooking(booking: BookingRecord): Promise<BookingCourseAccess> {
  const profile = await studentForBooking(booking.id);
  if (!profile) {
    return { completion: null, reportAccessExpiresAt: null, isReadOnly: false, canViewReports: true };
  }
  const [bookings, completions] = await Promise.all([
    bookingsForStudent(profile.id),
    courseCompletionsForStudent(profile.id),
  ]);
  const course = [...bookingsByCourse(bookings)].find(([, sessions]) => sessions.some((item) => item.id === booking.id));
  const completion = course ? completions.find((item) => item.course_key === course[0]) ?? null : null;
  if (!completion) {
    return { completion: null, reportAccessExpiresAt: null, isReadOnly: false, canViewReports: true };
  }
  const expiresAt = new Date(Date.parse(completion.finished_at) + COURSE_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const canViewReports = Date.now() < expiresAt.getTime();
  return {
    completion,
    reportAccessExpiresAt: expiresAt.toISOString(),
    isReadOnly: true,
    canViewReports,
  };
}
