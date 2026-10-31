"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import type { AvailabilityRule } from "@/lib/booking/types";
import { dateOnlySchema } from "@/lib/validation/booking";

function back(error?: string, success?: string): never {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (success) params.set("success", success);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  redirect(`/admin/settings${suffix}`);
}

function toMinutes(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export async function saveRulesAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/settings");

  const rules: AvailabilityRule[] = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    if (formData.get(`closed_${weekday}`)) continue;

    const startMin = toMinutes(formData.get(`open_${weekday}`));
    const endMin = toMinutes(formData.get(`close_${weekday}`));
    if (startMin === null || endMin === null) {
      back("Each open day needs a valid start and end time.");
    }
    if (endMin <= startMin) {
      back("Closing time must be after opening time.");
    }
    rules.push({ weekday, startMin, endMin });
  }

  await getStore().setRules(rules);
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  back(undefined, "Availability saved. New bookings use it immediately.");
}

const blackoutSchema = z.object({
  date: dateOnlySchema,
  reason: z.string().trim().max(120).optional().or(z.literal("")),
}).strict();

export async function addBlackoutAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/settings");

  const parsed = blackoutSchema.safeParse({
    date: formData.get("date"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    back(parsed.error.issues[0]?.message ?? "Check the date.");
  }

  await getStore().addBlackout(parsed.data.date, parsed.data.reason);
  revalidatePath("/admin/settings");
  back(undefined, "Blackout date added.");
}

export async function removeBlackoutAction(date: string): Promise<void> {
  await requireAdmin("/admin/settings");
  if (!dateOnlySchema.safeParse(date).success) {
    back("Invalid date.");
  }

  await getStore().removeBlackout(date);
  revalidatePath("/admin/settings");
  back(undefined, "Blackout date removed.");
}
