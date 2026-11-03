"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import type { AvailabilityRule } from "@/lib/booking/types";
import { toVancouverDayKey } from "@/lib/booking/slots";
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

  const store = getStore();
  const overrides = await store.getDateOverrides(toVancouverDayKey(new Date()));
  if (overrides.some((override) => {
    const weekday = new Date(`${override.date}T12:00:00.000Z`).getUTCDay();
    const rule = rules.find((item) => item.weekday === weekday);
    return !rule || override.startMin < rule.startMin || override.endMin > rule.endMin ||
      (override.startMin - rule.startMin) % 120 !== 0;
  })) {
    back("Update or remove date-specific hours before changing the weekly hours they depend on.");
  }

  await store.setRules(rules);
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  back(undefined, "Availability saved. New bookings use it immediately.");
}

export async function saveDateOverrideAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/settings");
  const date = formData.get("date");
  if (!dateOnlySchema.safeParse(date).success || typeof date !== "string" || date < toVancouverDayKey(new Date())) {
    back("Choose today or a future date for the special hours.");
  }
  const startMin = toMinutes(formData.get("open"));
  const endMin = toMinutes(formData.get("close"));
  if (startMin === null || endMin === null || endMin <= startMin) {
    back("Choose a valid opening and closing time.");
  }

  const store = getStore();
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const rule = (await store.getRules()).find((item) => item.weekday === weekday);
  if (!rule) back("That weekday is normally closed. Set weekly hours first, or close this date with a blackout.");
  if (startMin < rule.startMin || endMin > rule.endMin || (startMin - rule.startMin) % 120 !== 0) {
    back("Special hours must fit within the weekly hours and keep 90-minute lesson slots on the two-hour schedule.");
  }
  if ((await store.getBlackouts()).some((item) => item.date === date)) {
    back("This date is marked closed. Remove its blackout before adding special hours.");
  }

  await store.setDateOverride({ date, startMin, endMin });
  revalidatePath("/admin/settings");
  revalidatePath("/api/availability");
  back(undefined, "Special hours saved for that date.");
}

export async function removeDateOverrideAction(date: string): Promise<void> {
  await requireAdmin("/admin/settings");
  if (!dateOnlySchema.safeParse(date).success) back("Invalid date.");
  await getStore().removeDateOverride(date);
  revalidatePath("/admin/settings");
  revalidatePath("/api/availability");
  back(undefined, "Special hours removed; weekly hours apply again.");
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
