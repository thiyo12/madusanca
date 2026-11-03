import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { hashToken, isValidTokenFormat } from "@/lib/booking/tokens";
import { isIpRateLimitedShared } from "@/lib/server/rate-limit";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
const releaseSchema = z.object({ holdToken: z.string().refine(isValidTokenFormat) }).strict();

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "booking-hold-release", 30, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please try again shortly." }, { status: 429 });
  }
  try {
    const bounded = await readBoundedBody(request, 1_024);
    if (!bounded.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    const parsed = releaseSchema.safeParse(JSON.parse(bounded.text));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid hold token." }, { status: 400 });
    await getStore().releaseBookingHold(hashToken(parsed.data.holdToken));
    return NextResponse.json({ ok: true });
  } catch (error) {
    logSafeError("[bookings] hold release failed", error);
    return NextResponse.json({ ok: false, error: "Could not release the selected times." }, { status: 500 });
  }
}
