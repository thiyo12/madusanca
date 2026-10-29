"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { lessonFormSchema } from "@/lib/validation/booking";

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
    const existing = (await store.getLessons()).find((l) => l.id === parsed.data.id);
    if (!existing) {
      return { ok: false, message: "Lesson not found — catalogue changed, reload the page." };
    }

    await store.saveLesson({ ...existing, ...parsed.data });

    revalidatePath("/admin/lessons");
    revalidatePath("/");
    revalidatePath("/lessons");
    return {
      ok: true,
      message: `${parsed.data.name} saved — homepage, lessons page and booking wizard now show it.`,
    };
  } catch (error) {
    console.error("[admin/lessons] save failed", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save the lesson.",
    };
  }
}
