"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { addStudentAssessment, linkBookingToStudent, updateStudentProfile } from "@/lib/admin/student-profiles";

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
export async function addStudentAssessmentAction(form: FormData): Promise<void> {
  const admin = await requireAdmin("/admin/students");
  const score = z.preprocess((v) => v === "" || v == null ? null : Number(v), z.number().int().min(1).max(5).nullable());
  const parsed = z.object({ studentId: uuid, anchorId: uuid, bookingId: uuid.nullable(), assessmentDate: z.iso.date(), vehicle: score, observation: score, intersections: score, laneChanges: score, speedSpace: score, parking: score, hazard: score, roadTestDate: z.iso.date().nullable(), location: z.string().max(120), outcome: z.enum(["passed","not_passed","not_taken"]).nullable(), notes: z.string().max(4000) }).safeParse({
    studentId: form.get("studentId"), anchorId: form.get("anchorId"), bookingId: String(form.get("bookingId") ?? "") || null, assessmentDate: form.get("assessmentDate"), vehicle: form.get("vehicle"), observation: form.get("observation"), intersections: form.get("intersections"), laneChanges: form.get("laneChanges"), speedSpace: form.get("speedSpace"), parking: form.get("parking"), hazard: form.get("hazard"), roadTestDate: String(form.get("roadTestDate") ?? "") || null, location: form.get("location"), outcome: String(form.get("outcome") ?? "") || null, notes: form.get("notes"),
  });
  if (!parsed.success) redirect(`/admin/students/${encodeURIComponent(String(form.get("anchorId") ?? ""))}?error=assessment`);
  const d = parsed.data;
  await addStudentAssessment(d.studentId, d.bookingId, admin.userId, { assessment_date:d.assessmentDate, vehicle_control:d.vehicle, observation:d.observation, intersections:d.intersections, lane_changes:d.laneChanges, speed_space:d.speedSpace, parking:d.parking, hazard_awareness:d.hazard, road_test_date:d.roadTestDate, road_test_location:d.location, road_test_outcome:d.outcome, notes:d.notes });
  revalidatePath(`/admin/students/${d.anchorId}`);
}
