export function adminStudentHref(bookingId: string): string {
  return `/admin/students/${encodeURIComponent(bookingId)}`;
}

export function adminStudentPdfHref(bookingId: string): string {
  return `${adminStudentHref(bookingId)}/pdf`;
}

export function adminStudentLessonPdfHref(studentBookingId: string, lessonBookingId: string): string {
  return `${adminStudentHref(studentBookingId)}/reports/${encodeURIComponent(lessonBookingId)}/pdf`;
}
