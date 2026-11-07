export function adminStudentHref(bookingId: string): string {
  return `/admin/students/${encodeURIComponent(bookingId)}`;
}

export function adminStudentPdfHref(bookingId: string): string {
  return `${adminStudentHref(bookingId)}/pdf`;
}

export function adminStudentCsvHref(bookingId: string): string {
  return `${adminStudentHref(bookingId)}/csv`;
}
