"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { lessonFormSchema } from "@/lib/validation/booking";
import { logSafeError } from "@/lib/server/safe-log";

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
