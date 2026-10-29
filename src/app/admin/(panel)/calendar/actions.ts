"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { validateSlot, zonedToUtc } from "@/lib/booking/slots";
import { manageUrl } from "@/lib/booking/urls";
import { sendBookingConfirmedEmail } from "@/lib/email/booking-emails";

export interface QuickBookingState {
  ok: boolean;
  message: string;
  reference?: string;
}

const quickBookingSchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMin: z.coerce.number().int().min(0).max(1439),
  studentName: z.string().trim().min(2).max(80),
  email: z.email().max(160),
  phone: z.string().trim().min(7).max(25),
  notes: z.string().trim().max(220).optional().or(z.literal("")),
});

export async function createCalendarBookingAction(
  _previous: QuickBookingState,
  formData: FormData,
): Promise<QuickBookingState> {
  await requireAdmin("/admin/calendar");

  const parsed = quickBookingSchema.safeParse({
    lessonId: formData.get("lessonId"),
    dayKey: formData.get("dayKey"),
    startMin: formData.get("startMin"),
    studentName: formData.get("studentName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the booking details." };
  }

  try {
    const store = getStore();
    const lessons = await store.getLessons();
    const lesson = lessons.find((item) => item.id === parsed.data.lessonId);
    if (!lesson) return { ok: false, message: "That lesson package is no longer available." };

    const [year, month, day] = parsed.data.dayKey.split("-").map(Number);
    const startsAt = zonedToUtc(year, month, day, parsed.data.startMin).toISOString();
    const startMs = Date.parse(startsAt);
    const endsAt = new Date(startMs + lesson.durationMin * 60_000).toISOString();
    const [rules, blackouts, busy] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      ),
    ]);
    const validation = validateSlot(startsAt, {
      lessonDurationMin: lesson.durationMin,
      busy,
      blackouts,
      rules,
      now: new Date(),
    });
    if (!validation.valid) {
      return {
        ok: false,
        message: validation.reason === "occupied"
          ? "That slot was just taken. Choose another time."
          : "That slot is outside current booking hours or the minimum lead time.",
      };
    }

    const token = generateToken();
    const created = await store.createBooking(
      {
        lessonId: lesson.id,
        lessonName: lesson.name,
        durationMin: lesson.durationMin,
        priceCad: lesson.priceCad,
        startsAt,
        endsAt,
        studentName: parsed.data.studentName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        notes: parsed.data.notes ?? "",
      },
      { hash: hashToken(token), expiresAt: tokenExpiry() },
    );
    if (!created.ok) {
      return { ok: false, message: "That slot was just taken. Choose another time." };
    }

    const emailSent = await sendBookingConfirmedEmail({
      reference: created.value.reference,
      lessonName: created.value.lessonName,
      durationMin: created.value.durationMin,
      startsAt: created.value.startsAt,
      studentName: created.value.studentName,
      studentEmail: created.value.email,
      manageUrl: manageUrl(token),
    });

    revalidatePath("/admin/calendar");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin");
    return {
      ok: true,
      reference: created.value.reference,
      message: emailSent
        ? `Booking ${created.value.reference} created; confirmation emailed to the student.`
        : `Booking ${created.value.reference} created, but the email was not delivered. Check Resend sender/domain settings.`,
    };
  } catch (error) {
    console.error("[admin/calendar] quick booking failed", error);
    return { ok: false, message: "Could not create the booking. Check the details and try again." };
  }
}
