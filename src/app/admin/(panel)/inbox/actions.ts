"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { setContactMessageRead } from "@/lib/admin/contact-inbox";

export async function setContactMessageReadAction(formData: FormData): Promise<void> {
  await requireAdmin("/admin/inbox");
  const parsed = z.object({
    id: z.uuid(),
    isRead: z.enum(["true", "false"]),
    page: z.coerce.number().int().min(1).max(10_000),
    unread: z.enum(["true", "false"]),
  }).safeParse({
    id: formData.get("id"),
    isRead: formData.get("isRead"),
    page: formData.get("page"),
    unread: formData.get("unread"),
  });
  if (!parsed.success) redirect("/admin/inbox?error=invalid");

  const updated = await setContactMessageRead(parsed.data.id, parsed.data.isRead === "true");
  if (!updated) redirect("/admin/inbox?error=not-found");
  revalidatePath("/admin/inbox");
  const query = new URLSearchParams({ page: String(parsed.data.page) });
  if (parsed.data.unread === "true") query.set("unread", "1");
  redirect(`/admin/inbox?${query.toString()}`);
}
