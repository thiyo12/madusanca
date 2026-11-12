"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStore } from "@/lib/booking/store";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { manageUrl } from "@/lib/booking/urls";
import { sendBookingConfirmedEmail } from "@/lib/email/booking-emails";
import { logSafeError } from "@/lib/server/safe-log";
import { bookingHoldSchema, dateOnlySchema } from "@/lib/validation/booking";

const adminBookingSchema = bookingHoldSchema.extend({
  holdToken: z.string().min(20).max(160),
  studentName: z.string().trim().min(2).max(80),
  email: z.email().max(160),
  phone: z.string().trim().min(7).max(25),
  dateOfBirth: dateOnlySchema,
  gender: z.enum(["woman", "man", "prefer_not_to_say"]),
  licenseNumber: z.string().trim().min(4).max(32),
  firstName: z.string().trim().min(2).max(30),
  lastName: z.string().trim().min(2).max(30),
  licenseClass: z.enum(["7L", "7N", "5", "Other"]),
  street: z.string().trim().min(1).max(60),
  city: z.string().trim().min(1).max(30),
  province: z.literal("BC"),
  postalCode: z.string().trim().min(1).max(7),
  notes: z.string().trim().max(2000),
  consent: z.literal(true),
}).strict();

export interface AdminBundleBookingResult {
  ok: boolean;
  error?: string;
  reference?: string;
  manageToken?: string;
  emailSent?: boolean;
  booking?: { reference: string; lessonName: string; durationMin: number; priceCad: number; startsAt: string; studentName: string; email: string };
  sessions?: Array<{ lessonName: string; startsAt: string }>;
}

export async function createAdminBundleBooking(input: unknown): Promise<AdminBundleBookingResult> {
  await requireAdmin("/admin");
  const parsed = adminBookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Review the booking details." };

  try {
    const data = parsed.data;
    const notes = [
      `First name: ${data.firstName}`,
      `Last name: ${data.lastName}`,
      `Licence class: ${data.licenseClass}`,
      `Pickup address: ${data.street}, ${data.city}, ${data.province} ${data.postalCode}`,
      data.notes ? `Student notes: ${data.notes}` : "",
      "Booking created by admin; payment arranged directly with the school.",
    ].filter(Boolean).join("\n");
    const rawManageToken = generateToken();
    const holdHash = hashToken(data.holdToken);
    const store = getStore();
    const catalogue = await store.getLessons();
    const bookingTotal = data.packageSchedules.reduce((total, selection) => {
      const lesson = catalogue.find((item) => item.id === selection.lessonId);
      return total + (lesson ? lesson.priceCad * selection.quantity : 0);
    }, 0);
    if (bookingTotal <= 0 || !Number.isSafeInteger(Math.round(bookingTotal * 100))) {
      return { ok: false, error: "A selected lesson package is no longer available. Reload and try again." };
    }
    const created = await store.createBookingBundle({
      packages: data.packageSchedules,
      studentName: data.studentName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      licenseNumber: data.licenseNumber,
      notes,
    }, { hash: hashToken(rawManageToken), expiresAt: tokenExpiry() }, holdHash, true);

    if (!created.ok) {
      return { ok: false, error: created.error === "conflict" ? "One of those times is no longer available. Please choose the lesson times again." : "Could not create this booking. Please review the details and try again." };
    }
    if (created.value.length === 0) return { ok: false, error: "No lessons were returned. Please try again." };

    // Admin-created appointments are confirmed reservations with payment tracked separately as due.
    const confirmed = await store.updateBookingStatus(created.value[0].id, "confirmed");
    if (!confirmed.ok) {
      logSafeError("[admin/bookings] created bundle could not be confirmed", new Error(confirmed.error));
      return { ok: false, error: "The booking was created but could not be confirmed. Please check Bookings before retrying." };
    }

    const first = created.value[0];
    let emailSent = false;
    try {
      emailSent = await sendBookingConfirmedEmail({
        reference: first.reference,
        lessonName: first.lessonName,
        durationMin: first.durationMin,
        startsAt: first.startsAt,
        studentName: first.studentName,
        studentEmail: first.email,
        manageUrl: manageUrl(),
        sessionStartsAt: created.value.map((booking) => booking.startsAt),
      });
    } catch (error) {
      logSafeError("[admin/bookings] confirmation email failed", error);
    }

    revalidatePath("/admin");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/payments");
    return {
      ok: true,
      reference: first.reference,
      manageToken: rawManageToken,
      emailSent,
      booking: {
        reference: first.reference,
        lessonName: first.lessonName,
        durationMin: first.durationMin,
        priceCad: bookingTotal,
        startsAt: first.startsAt,
        studentName: first.studentName,
        email: first.email,
      },
      sessions: created.value.map((booking) => ({ lessonName: booking.lessonName, startsAt: booking.startsAt })),
    };
  } catch (error) {
    logSafeError("[admin/bookings] bundle creation failed", error);
    return { ok: false, error: "Could not create the booking. Please try again." };
  }
}
