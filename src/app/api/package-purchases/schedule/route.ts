import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/booking/store";
import { getManageToken, MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
const scheduleSchema = z.object({
  purchaseId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
}).strict();

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  if (await isIpRateLimitedShared(request, "package-credit-schedule", 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many scheduling attempts. Please try again later." }, { status: 429 });
  }
  let body: unknown;
  try {
    const result = await readBoundedBody(request, 2_048);
    if (!result.ok) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Choose a valid session time." }, { status: 400 });

  const token = await getManageToken();
  if (!token) return NextResponse.json({ ok: false, error: "Verify your email to manage package credits." }, { status: 401 });
  const currentHash = hashToken(token);
  if (await isRateLimitedShared(`package-schedule-token:${currentHash}`, 12, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many scheduling attempts. Please try again later." }, { status: 429 });
  }

  try {
    const store = getStore();
    const purchase = await store.getPackagePurchaseByToken(currentHash);
    if (!purchase || purchase.id !== parsed.data.purchaseId) {
      return NextResponse.json({ ok: false, error: "This package access link is invalid or expired." }, { status: 404 });
    }
    const nextToken = generateToken();
    const result = await store.schedulePackageCredit(purchase.id, parsed.data.startsAt, {
      currentHash,
      hash: hashToken(nextToken),
      expiresAt: tokenExpiry(),
    });
    if (!result.ok) {
      const status = result.error === "conflict" ? 409 : result.error === "expired" ? 410 : result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ ok: false, error: result.error === "conflict"
        ? "That time was just taken. Please choose another available session."
        : result.error === "expired"
          ? "This purchase has expired or is not paid yet. Contact the school if you need help."
          : result.error === "not_modifiable"
            ? "There are no unscheduled lessons left in this purchase."
            : "Could not schedule this session. Please try again." }, { status });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(MANAGE_COOKIE_NAME, nextToken, manageCookieOptions);
    return response;
  } catch (error) {
    logSafeError("[package-purchases/schedule] failed", error);
    return NextResponse.json({ ok: false, error: "Could not schedule this lesson. Your lesson balance is unchanged; please try again." }, { status: 500 });
  }
}
