import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import { occupiedDurationMin, validateSlot } from "@/lib/booking/slots";
import { generateToken, hashToken } from "@/lib/booking/tokens";
import { bookingHoldSchema } from "@/lib/validation/booking";
import { isIpRateLimitedShared } from "@/lib/server/rate-limit";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
const HOLD_MS = 8 * 60_000;

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "booking-holds", 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many booking attempts. Please try again shortly." }, { status: 429 });
  }

  try {
    const bounded = await readBoundedBody(request, 16_384);
    if (!bounded.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    const parsed = bookingHoldSchema.safeParse(JSON.parse(bounded.text));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Review your selected lesson times." }, { status: 400 });

    const store = getStore();
    const catalogue = await store.getLessons();
    const selections = parsed.data.packageSchedules.map((selection, index) => {
      const lesson = catalogue.find((item) => item.id === selection.lessonId && (index === 0 || item.category === "package"));
      return lesson && selection.startsAt.length === lesson.sessionCount * selection.quantity
        ? { lesson, selection }
        : null;
    });
    if (selections.some((selection) => !selection) || parsed.data.packageSchedules[0].quantity !== 1 ||
        new Set(parsed.data.packageSchedules.slice(1).map((selection) => selection.lessonId)).size !== parsed.data.packageSchedules.length - 1) {
      return NextResponse.json({ ok: false, error: "Choose a time for every lesson in each package." }, { status: 400 });
    }

    const expanded = (selections as Array<NonNullable<(typeof selections)[number]>>)
      .flatMap(({ lesson, selection }) => selection.startsAt.map((startsAt) => ({ lesson, startsAt })));
    if (expanded.length > 200) return NextResponse.json({ ok: false, error: "This selection contains too many lessons." }, { status: 400 });
    const ordered = expanded.map((item) => ({ ...item, start: Date.parse(item.startsAt) })).sort((a, b) => a.start - b.start);
    if (ordered.some((item, index) => !Number.isFinite(item.start) || (index > 0 && item.start === ordered[index - 1].start))) {
      return NextResponse.json({ ok: false, error: "Choose a different time for each lesson." }, { status: 400 });
    }

    const now = new Date();
    const anchorStart = parsed.data.packageSchedules[0].startsAt[0];
    const anchorDay = dayKeyOf(anchorStart);
    if (Date.parse(anchorStart) < now.getTime() + 120 * 60_000 ||
        anchorDay > addMonthsToKey(dayKeyOf(now.toISOString()), 6)) {
      return NextResponse.json({ ok: false, error: "The first lesson must be within the next six months and at least two hours from now." }, { status: 400 });
    }
    const latestPackageDay = addMonthsToKey(anchorDay, 6);
    if (ordered.some((item) => dayKeyOf(item.startsAt) < anchorDay || dayKeyOf(item.startsAt) > latestPackageDay)) {
      return NextResponse.json({ ok: false, error: "All package lessons must be within six months of the first lesson." }, { status: 400 });
    }

    const [rules, blackouts] = await Promise.all([store.getRules(), store.getBlackouts()]);
    const busyFrom = new Date(ordered[0].start - 24 * 60 * 60_000).toISOString();
    const busyTo = new Date(ordered.at(-1)!.start + 48 * 60 * 60_000).toISOString();
    const busy = await store.getBusy(busyFrom, busyTo);
    const chosen: Array<{ startsAt: string; endsAt: string }> = [];
    for (const item of ordered) {
      const validation = validateSlot(item.startsAt, {
        lessonDurationMin: item.lesson.durationMin,
        busy: [...busy, ...chosen],
        rules,
        blackouts,
        now,
      });
      if (!validation.valid) {
        return NextResponse.json({ ok: false, error: "One of those times is no longer available. Please choose another slot." }, { status: 409 });
      }
      chosen.push({
        startsAt: new Date(item.start).toISOString(),
        endsAt: new Date(item.start + occupiedDurationMin(item.lesson.durationMin) * 60_000).toISOString(),
      });
    }

    const holdToken = generateToken();
    const expiresAt = new Date(Date.now() + HOLD_MS).toISOString();
    const result = await store.createBookingHold(
      ordered.map((item) => ({ startsAt: new Date(item.start).toISOString(), durationMin: item.lesson.durationMin })),
      hashToken(holdToken),
      expiresAt,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Another customer just reserved one of those times. Please choose again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, holdToken, expiresAt: result.value.expiresAt });
  } catch (error) {
    logSafeError("[bookings] hold failed", error);
    return NextResponse.json({ ok: false, error: "Could not reserve these times yet. Please try again." }, { status: 500 });
  }
}
