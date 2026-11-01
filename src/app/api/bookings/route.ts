import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { validateSlot } from "@/lib/booking/slots";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { createBookingSchema } from "@/lib/validation/booking";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { sendBookingPaymentPendingEmail } from "@/lib/email/booking-emails";
import { manageUrl } from "@/lib/booking/urls";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";
import { MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8_192;

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
    const lesson = (await store.getLessons()).find((l) => l.id === lessonId);
    if (!lesson) {
      return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404 });
    }
    const startsAt = parsed.data.sessions ?? [parsed.data.startsAt!];
    if (startsAt.length !== lesson.sessionCount) {
      return NextResponse.json({ ok: false, error: `Please select all ${lesson.sessionCount} session times.` }, { status: 400 });
    }
    const sortedStarts = [...startsAt].sort((a, b) => Date.parse(a) - Date.parse(b));
    const limitDay = addMonthsToKey(dayKeyOf(sortedStarts[0]), 2);
    if (Date.parse(sortedStarts[0]) > Date.now() + 90 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: "The first session must be within the next 90 days." }, { status: 400 });
    }
    if (sortedStarts.some((value, index) =>
      !Number.isFinite(Date.parse(value)) || dayKeyOf(value) > limitDay ||
      (index > 0 && value === sortedStarts[index - 1]),
    )) {
      return NextResponse.json({ ok: false, error: "Choose different session times within two months of the first session." }, { status: 400 });
    }

    const [rules, blackouts] = await Promise.all([store.getRules(), store.getBlackouts()]);
    for (const selectedStart of sortedStarts) {
      const startMs = Date.parse(selectedStart);
      const busy = await store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      );
      const validation = validateSlot(selectedStart, {
        lessonDurationMin: lesson.durationMin,
        busy,
        blackouts,
        rules,
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
    }

    const token = generateToken();
    const result = await store.createBookingPackage(
      {
        lessonId: lesson.id,
        lessonName: lesson.name,
        durationMin: lesson.durationMin,
        packagePriceCad: lesson.priceCad,
        sessions: sortedStarts.map((value) => ({
          startsAt: new Date(value).toISOString(),
          endsAt: new Date(Date.parse(value) + lesson.durationMin * 60000).toISOString(),
        })),
        studentName,
        email,
        phone,
        notes: notes ?? "",
      },
      { hash: hashToken(token), expiresAt: tokenExpiry() },
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "That time was just taken. Please pick another slot." },
        { status: 409 },
      );
    }

    const booking = result.value[0];
    const url = manageUrl(token);
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
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        studentName: booking.studentName,
        sessions: result.value.map(({ startsAt: sessionStart }) => ({ startsAt: sessionStart })),
        sessionCount: result.value.length,
      },
      manageUrl: `${new URL(url).origin}/booking/manage`,
      emailSent,
    });
    response.cookies.set(MANAGE_COOKIE_NAME, token, manageCookieOptions);
    return response;
  } catch (error) {
    logSafeError("[bookings] create failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not complete your booking. Please try again." },
      { status: 500 },
    );
  }
}
