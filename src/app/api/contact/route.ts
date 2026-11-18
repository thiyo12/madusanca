import { NextResponse } from "next/server";
import { contactSchema } from "@/lib/validation/contact";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";
import { readBoundedBody } from "@/lib/server/read-bounded-body";
import { saveContactMessage } from "@/lib/admin/contact-inbox";
import { logSafeError } from "@/lib/server/safe-log";

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
  }
  if (await isIpRateLimitedShared(request, "contact", 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many messages. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const result = await readBoundedBody(request, 12_288);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Please check the form." },
      { status: 400 },
    );
  }

  const { email, website } = parsed.data;

  if (await isRateLimitedShared(`contact-email:${email.trim().toLowerCase()}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many messages from this email. Please try again later." },
      { status: 429 },
    );
  }

  // Honeypot filled → bot; pretend success without delivering.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  try {
    await saveContactMessage(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logSafeError("[contact] message could not be saved", error);
    return NextResponse.json(
      { ok: false, error: "Could not save your message. Please try again or call the school." },
      { status: 503 },
    );
  }
}
