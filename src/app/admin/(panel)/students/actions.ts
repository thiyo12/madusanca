"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { finishStudentCourse, linkBookingToStudent, updateStudentProfile } from "@/lib/admin/student-profiles";

const uuid = z.uuid();
const gender = z.enum(["woman","man","non_binary","another_identity","prefer_not_to_say"]).nullable();
export async function saveStudentDetailsAction(form: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/students");
  const parsed = z.object({ studentId: uuid, bookingId: uuid, name: z.string().trim().min(1).max(160), email: z.email().max(160), phone: z.string().max(25), dob: z.iso.date().nullable(), gender, license: z.string().trim().min(4).max(32).nullable() }).safeParse({
    studentId: form.get("studentId"), bookingId: form.get("bookingId"), name: form.get("name"), email: form.get("email"), phone: form.get("phone"), dob: String(form.get("dob") ?? "") || null, gender: String(form.get("gender") ?? "") || null, license: String(form.get("license") ?? "") || null,
  });
  if (!parsed.success) redirect(`/admin/students/${encodeURIComponent(String(form.get("bookingId") ?? ""))}?error=details`);
  await updateStudentProfile(parsed.data.studentId, admin.userId, { full_name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone, date_of_birth: parsed.data.dob, gender: parsed.data.gender, license_number: parsed.data.license });
  revalidatePath("/admin/students"); revalidatePath(`/admin/students/${parsed.data.bookingId}`);
}
export async function linkStudentBookingAction(form: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/students");
  const parsed = z.object({ studentId: uuid, bookingId: uuid, anchorId: uuid }).safeParse({ studentId: form.get("studentId"), bookingId: form.get("bookingId"), anchorId: form.get("anchorId") });
  if (!parsed.success) return;
  await linkBookingToStudent(parsed.data.studentId, parsed.data.bookingId, admin.userId);
  revalidatePath(`/admin/students/${parsed.data.anchorId}`);
}
export async function finishStudentCourseAction(form: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/students");
  const parsed = z.object({ studentId: uuid, anchorId: uuid, courseKey: uuid, endedEarly: z.enum(["true", "false"]) }).safeParse({ studentId: form.get("studentId"), anchorId: form.get("anchorId"), courseKey: form.get("courseKey"), endedEarly: form.get("endedEarly") });
  if (!parsed.success) redirect(`/admin/students/${encodeURIComponent(String(form.get("anchorId") ?? ""))}?courseError=invalid`);
  const result = await finishStudentCourse(parsed.data.studentId, parsed.data.courseKey, admin.userId, parsed.data.endedEarly === "true");
  if (!result.ok) redirect(`/admin/students/${parsed.data.anchorId}?courseError=${encodeURIComponent(result.error ?? "failed")}`);
  revalidatePath(`/admin/students/${parsed.data.anchorId}`);
  redirect(`/admin/students/${parsed.data.anchorId}`);
}
