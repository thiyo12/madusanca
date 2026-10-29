import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { generateSlots, HORIZON_DAYS } from "@/lib/booking/slots";
import { availabilityQuerySchema } from "@/lib/validation/booking";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const parsed = availabilityQuerySchema.safeParse({
    lessonId: url.searchParams.get("lessonId"),
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const store = getStore();
    const lesson = (await store.getLessons()).find((l) => l.id === parsed.data.lessonId);
    if (!lesson) {
      return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404 });
    }
    const now = new Date();
    const from = parsed.data.from;
    const busyFrom = from ? new Date(`${from}T00:00:00Z`).toISOString() : now.toISOString();
    const busyTo = new Date(now.getTime() + (HORIZON_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();

    const [rules, blackouts, busy] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getBusy(busyFrom, busyTo),
    ]);

    const slots = generateSlots({
      lessonDurationMin: lesson.durationMin,
      fromDayKey: from,
      toDayKey: parsed.data.to,
      busy,
      blackouts,
      rules,
      now,
    });

    return NextResponse.json({
      ok: true,
      lessonId: lesson.id,
      lessonName: lesson.name,
      durationMin: lesson.durationMin,
      priceCad: lesson.priceCad,
      timezone: "America/Vancouver",
      slots,
    });
  } catch (error) {
    console.error("[availability] failed", error);
    return NextResponse.json(
      { ok: false, error: "Availability is unavailable right now. Please try again." },
      { status: 500 },
    );
  }
}
