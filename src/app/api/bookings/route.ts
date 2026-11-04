import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { occupiedDurationMin, validateSlot } from "@/lib/booking/slots";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { createBookingSchema } from "@/lib/validation/booking";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { sendBookingPaymentPendingEmail } from "@/lib/email/booking-emails";
import { manageUrl } from "@/lib/booking/urls";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { CHECKOUT_COOKIE_NAME, checkoutCookieOptions, createCheckoutGrant } from "@/lib/booking/checkout-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import type { Lesson } from "@/lib/data/lessons";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32_768;

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "bookings", 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many booking attempts. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const result = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Please check the form." },
      { status: 400 },
    );
  }

  const { lessonId, studentName, email, phone, notes, website } = parsed.data;

  if (await isRateLimitedShared(`booking-email:${email.trim().toLowerCase()}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many booking attempts for this email. Please try again later." },
      { status: 429 },
    );
  }

  // Honeypot filled → bot; pretend success without storing anything.
  if (website) {
    return NextResponse.json({ ok: true, booking: null });
  }

  try {
    const store = getStore();
    const catalogue = await store.getLessons();
    const lesson = catalogue.find((l) => l.id === lessonId);
    if (!lesson) {
      return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404 });
    }
    if (!Number.isSafeInteger(Math.round(lesson.priceCad * 100)) || lesson.priceCad > 999_999.99) {
      return NextResponse.json({ ok: false, error: "The selected total exceeds the secure checkout limit. Reduce package quantities and try again." }, { status: 400 });
    }
    const packageSchedules = parsed.data.packageSchedules ?? [{
      lessonId: lesson.id,
      quantity: 1,
      startsAt: parsed.data.sessions ?? [parsed.data.startsAt!],
    }];
    if (packageSchedules.length !== 1 || packageSchedules[0].lessonId !== lesson.id || packageSchedules[0].quantity !== 1 ||
      packageSchedules[0].startsAt.length !== lesson.sessionCount) {
      return NextResponse.json({ ok: false, error: "Choose a date and time for every lesson in each selected package." }, { status: 400 });
    }
    const startsAt = packageSchedules[0].startsAt;
    if (startsAt.length > 200) return NextResponse.json({ ok: false, error: "This selection contains too many scheduled lessons. Reduce package quantities." }, { status: 400 });
    const sortedStarts = [...startsAt].sort((a, b) => Date.parse(a) - Date.parse(b));
    const anchorStart = packageSchedules[0].startsAt[0];
    const anchorDay = dayKeyOf(anchorStart);
    const validationNow = new Date();
    const latestFirstSessionDay = addMonthsToKey(dayKeyOf(validationNow.toISOString()), 6);
    const limitDay = addMonthsToKey(anchorDay, 6);
    if (Date.parse(anchorStart) < validationNow.getTime() + 120 * 60_000) {
      return NextResponse.json({ ok: false, error: "The first session must start at least two hours from now." }, { status: 400 });
    }
    if (anchorDay > latestFirstSessionDay) {
      return NextResponse.json({
        ok: false,
        error: `Your selected first-session date (${anchorDay}) is after the latest allowed date (${latestFirstSessionDay}). Choose a date within six months.`,
      }, { status: 400 });
    }
    if (sortedStarts.some((value, index) =>
      !Number.isFinite(Date.parse(value)) || dayKeyOf(value) < anchorDay || dayKeyOf(value) > limitDay ||
      (index > 0 && value === sortedStarts[index - 1]),
    )) {
      return NextResponse.json({ ok: false, error: "Choose different session times within six months of the first session." }, { status: 400 });
    }

    const [rules, blackouts, dateOverrides] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getDateOverrides(anchorDay, limitDay),
    ]);
    const selectedBusy: Array<{ startsAt: string; endsAt: string }> = [];
    const lessonByStart = new Map<string, Lesson>();
    for (const selection of packageSchedules) {
      const selectedLesson = catalogue.find((item) => item.id === selection.lessonId)!;
      selection.startsAt.forEach((start) => lessonByStart.set(new Date(start).toISOString(), selectedLesson));
    }
    for (const selectedStart of sortedStarts) {
      const startMs = Date.parse(selectedStart);
      const scheduledLesson = lessonByStart.get(new Date(startMs).toISOString()) ?? lesson;
      const busy = await store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
        hashToken(parsed.data.holdToken),
      );
      const validation = validateSlot(selectedStart, {
        lessonDurationMin: scheduledLesson.durationMin,
        busy: [...busy, ...selectedBusy],
        blackouts,
        rules,
        dateOverrides,
        now: new Date(),
      });
      if (!validation.valid) {
        return NextResponse.json({
          ok: false,
          error: validation.reason === "occupied"
            ? "One of those times was just taken. Please choose another slot."
            : "One of those times is no longer available. Please review your selections.",
        }, { status: 409 });
      }
      selectedBusy.push({
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(startMs + occupiedDurationMin(scheduledLesson.durationMin) * 60_000).toISOString(),
      });
    }

    const token = generateToken();
    const result = await store.createBookingBundle({
        packages: packageSchedules.map((selection) => ({
          ...selection,
          startsAt: selection.startsAt.map((value) => new Date(value).toISOString()).sort((a, b) => Date.parse(a) - Date.parse(b)),
        })),
        studentName,
        email,
        phone,
        dateOfBirth: parsed.data.dateOfBirth,
        gender: parsed.data.gender,
        licenseNumber: parsed.data.licenseNumber,
        notes: notes ?? "",
      }, { hash: hashToken(token), expiresAt: tokenExpiry() }, hashToken(parsed.data.holdToken));

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error === "conflict"
            ? "One of your selected times was just taken. Your other times are saved—change the unavailable lesson time and confirm again."
            : "We couldn’t reserve this booking. Please review your selected times and try again.",
        },
        { status: result.error === "conflict" ? 409 : 400 },
      );
    }

    const booking = result.value[0];
    const url = manageUrl();
    const emailSent = await sendBookingPaymentPendingEmail({
      reference: booking.reference,
      lessonName: booking.lessonName,
      durationMin: booking.durationMin,
      startsAt: booking.startsAt,
      studentName: booking.studentName,
      studentEmail: booking.email,
      manageUrl: url,
      sessionStartsAt: result.value.map((session) => session.startsAt),
    });

    const response = NextResponse.json({
      ok: true,
      booking: {
        reference: booking.reference,
        lessonName: booking.lessonName,
        durationMin: booking.durationMin,
        priceCad: booking.packagePriceCad ?? booking.priceCad,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        studentName: booking.studentName,
        sessions: result.value.map(({ startsAt: sessionStart }) => ({ startsAt: sessionStart })),
        sessionCount: result.value.length,
      },
      emailSent,
    });
    // A checkout-only grant is deliberately separate from the manage cookie.
    response.cookies.set(CHECKOUT_COOKIE_NAME, createCheckoutGrant(booking.id), checkoutCookieOptions);
    return response;
  } catch (error) {
    logSafeError("[bookings] create failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not complete your booking. Please try again." },
      { status: 500 },
    );
  }
}
