import { NextResponse } from "next/server";
import { contactSchema } from "@/lib/validation/contact";
import { isIpRateLimitedShared, isRateLimitedShared } from "@/lib/server/rate-limit";
import { escapeHtml } from "@/lib/email/send";
import { readBoundedBody } from "@/lib/server/read-bounded-body";

async function sendViaResend(params: {
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.BOOKING_NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !to || !from) return;

  const html = `
    <h2>New website contact message</h2>
    <p><strong>Name:</strong> ${escapeHtml(params.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(params.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(params.phone || "—")}</p>
    <p><strong>Subject:</strong> ${escapeHtml(params.subject || "—")}</p>
    <hr />
    <p style="white-space:pre-wrap">${escapeHtml(params.message)}</p>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: params.email,
      subject: `Website contact — ${params.name}`,
      html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected contact email with status ${response.status}`);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
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

  const { name, email, phone, subject, message, website } = parsed.data;

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
    const hasResend = Boolean(
      process.env.RESEND_API_KEY &&
        process.env.BOOKING_NOTIFY_EMAIL &&
        process.env.EMAIL_FROM,
    );

    if (hasResend) {
      await sendViaResend({ name, email, phone, subject, message });
    } else {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ ok: false, error: "Contact service is temporarily unavailable. Please call the school." }, { status: 503 });
      }
      // Local/dev fallback: no email account configured yet.
      console.warn("[contact] message not delivered because email is not configured");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[contact] delivery failed", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json(
      { ok: false, error: "Could not send your message. Please try again." },
      { status: 500 },
    );
  }
}
