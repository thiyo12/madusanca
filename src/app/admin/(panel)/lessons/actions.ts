"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { lessonFormSchema } from "@/lib/validation/booking";
import { logSafeError } from "@/lib/server/safe-log";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { z } from "zod";
import { isRateLimitedShared } from "@/lib/server/rate-limit";
import { isLocalAdminBypassEnabled } from "@/lib/auth/local-admin-bypass";

export type LessonFormState = { ok: boolean; message: string } | null;

export async function saveLessonAction(
  _previous: LessonFormState,
  formData: FormData,
): Promise<LessonFormState> {
  await requireAdmin("/admin/login");

  const features = String(formData.get("features") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lessonFormSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    durationMin: formData.get("durationMin"),
    sessionCount: formData.get("sessionCount"),
    priceCad: formData.get("priceCad"),
    description: formData.get("description"),
    features,
    category: formData.get("category"),
    popular: formData.get("popular") === "on",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  try {
    const store = getStore();
    const lessons = await store.getLessons();
    const existing = lessons.find((lesson) => lesson.id === parsed.data.id);
    const creating = formData.get("isNew") === "on";
    if (creating && existing) {
      return { ok: false, message: "That package ID is already in use. Change the name and try again." };
    }
    if (!creating && !existing) return { ok: false, message: "Lesson not found — catalogue changed, reload the page." };

    await store.saveLesson({
      ...(existing ?? { icon: "timer" as const }),
      ...parsed.data,
    });

    revalidatePath("/admin/lessons");
    revalidatePath("/");
    revalidatePath("/lessons");
    return {
      ok: true,
      message: `${parsed.data.name} ${creating ? "added" : "saved"} — homepage, lessons page and booking wizard now show it.`,
    };
  } catch (error) {
    logSafeError("[admin/lessons] save failed", error);
    return {
      ok: false,
      message: "Could not save the lesson. Please try again.",
    };
  }
}

export async function deleteLessonAction(
  _previous: LessonFormState,
  formData: FormData,
): Promise<LessonFormState> {
  const admin = await requireAdmin("/admin/lessons");
  const parsed = z.object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    password: z.string().min(6).max(128),
    confirmation: z.string().trim().min(1).max(80),
  }).strict().safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the delete form." };
  if (parsed.data.confirmation !== parsed.data.name) {
    return { ok: false, message: "Type the lesson name exactly to confirm deletion." };
  }
  if (await isRateLimitedShared(`admin-lesson-delete:${admin.userId}`, 5, 15 * 60 * 1000)) {
    return { ok: false, message: "Too many delete attempts. Please wait before trying again." };
  }

  const requestHeaders = await headers();
  const localBypass = isLocalAdminBypassEnabled(process.env.NODE_ENV, requestHeaders.get("host") ?? "");
  if (!localBypass) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return { ok: false, message: "Password verification is unavailable. Please contact the site administrator." };
    const verifier = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    try {
      const { data, error } = await verifier.auth.signInWithPassword({ email: admin.email, password: parsed.data.password });
      if (error || data.user?.id !== admin.userId) return { ok: false, message: "The admin password is incorrect." };
    } catch (error) {
      logSafeError("[admin/lessons] password verification failed", error);
      return { ok: false, message: "Could not verify the admin password. Please try again." };
    }
  }

  try {
    const store = getStore();
    const lessons = await store.getLessons();
    const existing = lessons.find((lesson) => lesson.id === parsed.data.id);
    if (!existing || existing.name !== parsed.data.name) {
      return { ok: false, message: "This lesson changed or no longer exists. Reload the page and try again." };
    }
    await store.deleteLesson(existing.id);
    for (const path of ["/", "/lessons", "/booking", "/admin/lessons", "/admin/calendar"]) revalidatePath(path);
    return { ok: true, message: `${existing.name} was removed from the public catalogue. Existing bookings were not changed.` };
  } catch (error) {
    logSafeError("[admin/lessons] delete failed", error);
    return { ok: false, message: "Could not delete the lesson. Existing bookings were not changed." };
  }
}
