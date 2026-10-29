import { formatSlotFull } from "@/lib/booking/format";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  /** Dev-only shortcut shown in the console fallback (e.g. the OTP code). */
  devHint?: string;
}

/**
 * Delivers via Resend when configured; otherwise logs to the console
 * (local development fallback — getStore() already blocks unconfigured production).
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("[email] Resend rejected the message", response.status, detail);
        return false;
      }
      return true;
    } catch (error) {
      console.error("[email] Resend request failed", error);
      return false;
    }
  }

  console.info("[email:dev] not configured — logged instead", {
    to: payload.to,
    subject: payload.subject,
    ...(payload.devHint && process.env.NODE_ENV !== "production"
      ? { devHint: payload.devHint }
      : {}),
  });
  return false;
}

export async function notifySchool(subject: string, html: string): Promise<void> {
  const to = process.env.BOOKING_NOTIFY_EMAIL;
  if (!to) return;
  await sendEmail({ to, subject, html });
}

export function bookingShell(title: string, body: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f8;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e8e9ec;border-radius:14px;padding:28px">
      <div style="font-weight:800;font-size:15px;letter-spacing:-0.02em">Wisdom Driving Academy</div>
      <h1 style="font-size:20px;margin:18px 0 12px;color:#111315">${escapeHtml(title)}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e8e9ec;margin:22px 0 14px" />
      <p style="font-size:12px;color:#6b7280;margin:0">Questions? Reply to this email or use the contact page on our website.</p>
    </div>
  </div>`;
}

export function bookingDetailsTable(args: {
  reference: string;
  lessonName: string;
  durationMin: number;
  startsAt: string;
  studentName: string;
}): string {
  return `
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 14px 6px 0;color:#6b7280">Reference</td><td style="padding:6px 0;font-weight:700">${escapeHtml(args.reference)}</td></tr>
      <tr><td style="padding:6px 14px 6px 0;color:#6b7280">Lesson</td><td style="padding:6px 0">${escapeHtml(args.lessonName)} (${args.durationMin} min)</td></tr>
      <tr><td style="padding:6px 14px 6px 0;color:#6b7280">When</td><td style="padding:6px 0">${escapeHtml(formatSlotFull(args.startsAt))} (Pacific Time)</td></tr>
      <tr><td style="padding:6px 14px 6px 0;color:#6b7280">Student</td><td style="padding:6px 0">${escapeHtml(args.studentName)}</td></tr>
    </table>`;
}
