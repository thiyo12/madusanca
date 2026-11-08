import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BookingRecord } from "@/lib/booking/types";

export interface StudentProfile {
  id: string; full_name: string; email: string; phone: string;
  date_of_birth: string | null; gender: string | null; license_number: string | null;
}
export interface StudentAssessment {
  id: string; booking_id: string | null; assessment_date: string;
  vehicle_control: number | null; observation: number | null; intersections: number | null;
  lane_changes: number | null; speed_space: number | null; parking: number | null;
  hazard_awareness: number | null; road_test_date: string | null; road_test_location: string | null;
  road_test_outcome: "passed" | "not_passed" | "not_taken" | null; notes: string; updated_at?: string;
}
export interface StudentCourseCompletion { course_key: string; ended_early: boolean; expected_lessons: number; completed_lessons: number; finished_at: string }
let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Student profiles require configured Supabase storage.");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
export async function studentForBooking(bookingId: string): Promise<StudentProfile | null> {
  const { data: link, error } = await db().from("student_profile_bookings").select("student_id").eq("booking_id", bookingId).maybeSingle();
  if (error || !link) return null;
  const { data, error: profileError } = await db().from("student_profiles").select("id,full_name,email,phone,date_of_birth,gender,license_number").eq("id", link.student_id).maybeSingle();
  if (profileError) throw profileError;
  return data as StudentProfile | null;
}
export async function bookingsForStudent(studentId: string): Promise<BookingRecord[]> {
  const { data: links, error } = await db().from("student_profile_bookings").select("booking_id").eq("student_id", studentId);
  if (error) throw error;
  if (!links?.length) return [];
  const { data, error: bookingsError } = await db().from("bookings").select("*").in("id", links.map((row) => row.booking_id)).order("starts_at", { ascending: true });
  if (bookingsError) throw bookingsError;
  const { toRecord } = await import("@/lib/booking/supabase-store");
  return (data ?? []).map((row) => toRecord(row));
}
export async function profileById(studentId: string): Promise<StudentProfile | null> {
  const { data, error } = await db().from("student_profiles").select("id,full_name,email,phone,date_of_birth,gender,license_number").eq("id", studentId).maybeSingle();
  if (error) throw error;
  return data as StudentProfile | null;
}
export async function assessmentsForStudent(studentId: string): Promise<StudentAssessment[]> {
  const { data, error } = await db().from("student_assessments").select("id,booking_id,assessment_date,vehicle_control,observation,intersections,lane_changes,speed_space,parking,hazard_awareness,road_test_date,road_test_location,road_test_outcome,notes,updated_at").eq("student_id", studentId).order("assessment_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StudentAssessment[];
}
export async function assessmentForBooking(bookingId: string): Promise<StudentAssessment | null> {
  const { data, error } = await db().from("student_assessments").select("id,booking_id,assessment_date,vehicle_control,observation,intersections,lane_changes,speed_space,parking,hazard_awareness,road_test_date,road_test_location,road_test_outcome,notes,updated_at").eq("booking_id", bookingId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as StudentAssessment | null;
}
export async function courseCompletionsForStudent(studentId: string): Promise<StudentCourseCompletion[]> {
  const { data, error } = await db().from("student_course_completions").select("course_key,ended_early,expected_lessons,completed_lessons,finished_at").eq("student_id", studentId);
  if (error) throw error;
  return (data ?? []) as StudentCourseCompletion[];
}
export async function saveBookingAssessment(studentId: string, bookingId: string, adminId: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await db().rpc("admin_save_booking_assessment", {
    p_student_id: studentId, p_booking_id: bookingId, p_admin_id: adminId,
    p_assessment_date: values.assessment_date, p_vehicle_control: values.vehicle_control,
    p_observation: values.observation, p_intersections: values.intersections,
    p_lane_changes: values.lane_changes, p_speed_space: values.speed_space,
    p_parking: values.parking, p_hazard_awareness: values.hazard_awareness,
    p_road_test_date: values.road_test_date, p_road_test_location: values.road_test_location,
    p_road_test_outcome: values.road_test_outcome, p_notes: values.notes,
  });
  if (error) throw error;
}
export async function finishStudentCourse(studentId: string, courseKey: string, adminId: string, endedEarly: boolean): Promise<{ok:boolean; error?:string}> {
  const { data, error } = await db().rpc("admin_finish_student_course", { p_student_id: studentId, p_course_key: courseKey, p_admin_id: adminId, p_ended_early: endedEarly });
  if (error) throw error;
  return data as {ok:boolean; error?:string};
}
export async function searchBookingsByLicense(license: string): Promise<string[]> {
  const { data, error } = await db().rpc("admin_find_student_bookings_by_license", { p_license: license });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ booking_id: string }>;
  return Array.from(new Set(rows.map((row) => row.booking_id)));
}
export async function allStudentProfiles(): Promise<StudentProfile[]> {
  const { data, error } = await db().from("student_profiles").select("id,full_name,email,phone,date_of_birth,gender,license_number").order("full_name");
  if (error) throw error;
  return (data ?? []) as StudentProfile[];
}
export async function unlinkedBookings(): Promise<BookingRecord[]> {
  const { data: linked, error: linkError } = await db().from("student_profile_bookings").select("booking_id");
  if (linkError) throw linkError;
  let query = db().from("bookings").select("*").order("created_at", { ascending: false }).limit(200);
  if (linked?.length) query = query.not("id", "in", `(${linked.map((x) => x.booking_id).join(",")})`);
  const { data, error } = await query;
  if (error) throw error;
  const { toRecord } = await import("@/lib/booking/supabase-store");
  return (data ?? []).map((row) => toRecord(row));
}
export async function updateStudentProfile(studentId: string, adminId: string, details: Omit<StudentProfile, "id">): Promise<void> {
  const { error } = await db().rpc("admin_update_student_profile", { p_student_id: studentId, p_admin_id: adminId,
    p_full_name: details.full_name, p_email: details.email, p_phone: details.phone,
    p_date_of_birth: details.date_of_birth, p_gender: details.gender, p_license_number: details.license_number });
  if (error) throw error;
}
export async function linkBookingToStudent(studentId: string, bookingId: string, adminId: string): Promise<void> {
  const { error } = await db().rpc("admin_link_student_booking", { p_student_id: studentId, p_booking_id: bookingId, p_admin_id: adminId });
  if (error) throw error;
}
export async function licenseSearchMatches(license: string): Promise<BookingRecord[]> {
  const ids = await searchBookingsByLicense(license);
  if (!ids.length) return [];
  const { data, error } = await db().from("bookings").select("*").in("id", ids).order("starts_at", { ascending: true });
  if (error) throw error;
  const { toRecord } = await import("@/lib/booking/supabase-store");
  return (data ?? []).map((row) => toRecord(row));
}
