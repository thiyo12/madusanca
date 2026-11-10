import {
  bookingDetailsTable,
  bookingShell,
  escapeHtml,
  notifySchool,
  sendEmail,
} from "@/lib/email/send";
import { formatSlotFull } from "@/lib/booking/format";

interface BookingArgs {
  reference: string;
  lessonName: string;
  durationMin: number;
  startsAt: string;
  studentName: string;
  studentEmail: string;
  manageUrl: string;
  sessionStartsAt?: string[];
}

const manageButton = (url: string): string => `
  <p style="margin:20px 0 0">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#e3a721;color:#111315;font-weight:800;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px">Manage your booking</a>
  </p>
  <p style="font-size:12px;color:#6b7280;margin:12px 0 0">Or paste this link: ${escapeHtml(url)}</p>`;

export async function sendBookingConfirmedEmail(args: BookingArgs): Promise<boolean> {
  const html = bookingShell(
    "Your lesson is booked",
    `<p>Hi ${escapeHtml(args.studentName)}, your driving lesson is confirmed.</p>
     ${bookingDetailsTable(args)}
     ${manageButton(args.manageUrl)}
     <p style="font-size:13px;color:#4b525e;margin:16px 0 0">Please make online changes at least 48 hours before the lesson to avoid a cancellation fee. For later changes, call +1 236-234-3229; fees may apply.</p>
     <p style="font-size:13px;color:#4b525e;margin:18px 0 0">Payment is arranged directly with the school — no payment was taken online. Please arrive on time with your learner licence.</p>`,
  );
  const sent = await sendEmail({
    to: args.studentEmail,
    subject: `Lesson booked — ${args.reference}`,
    html,
  });
  await notifySchool(
    `New booking — ${args.reference}`,
    bookingShell(
      "New booking",
      `<p>A new lesson was booked on the website.</p>${bookingDetailsTable(args)}
       <p style="font-size:13px">Student email: ${escapeHtml(args.studentEmail)}</p>`,
    ),
  );
  return sent;
}

export async function sendBookingPaymentReceivedEmail(args: BookingArgs & { invoiceUrl?: string }): Promise<boolean> {
  const invoice = args.invoiceUrl
    ? `<p><a href="${escapeHtml(args.invoiceUrl)}" style="color:#31543a;font-weight:800">View your paid invoice</a></p>`
    : "";
  const html = bookingShell(
    "Payment received — your lesson is confirmed",
    `<p>Hi ${escapeHtml(args.studentName)}, we received your payment and confirmed your lesson.</p>${bookingDetailsTable(args)}${invoice}${manageButton(args.manageUrl)}`,
  );
  const sent = await sendEmail({ to: args.studentEmail, subject: `Payment confirmed — ${args.reference}`, html });
  await notifySchool(`Lesson payment confirmed — ${args.reference}`, bookingShell("Lesson payment confirmed", bookingDetailsTable(args)));
  return sent;
}

export async function sendPackagePurchasePaidEmail(args: {
  reference: string;
  lessonName: string;
  creditsPurchased: number;
  amountCad: number;
  studentName: string;
  studentEmail: string;
  manageUrl: string;
  invoiceUrl?: string;
}): Promise<boolean> {
  const invoice = args.invoiceUrl
    ? `<p><a href="${escapeHtml(args.invoiceUrl)}" style="color:#31543a;font-weight:800">View your paid invoice</a></p>`
    : "";
  const html = bookingShell(
    "Additional lesson package paid",
    `<p>Hi ${escapeHtml(args.studentName)}, your payment was received. Your additional lesson package is ready to manage.</p><p><strong>${escapeHtml(args.lessonName)}</strong> · ${args.creditsPurchased} lessons · $${args.amountCad.toFixed(2)} CAD</p><p>Reference: <strong>${escapeHtml(args.reference)}</strong></p>${invoice}${manageButton(args.manageUrl)}`,
  );
  const sent = await sendEmail({ to: args.studentEmail, subject: `Package payment confirmed — ${args.reference}`, html });
  await notifySchool(`Additional package paid — ${args.reference}`, html);
  return sent;
}

export async function sendBookingRescheduledEmail(args: BookingArgs & { previousStartsAt: string }): Promise<boolean> {
  const html = bookingShell(
    "Your lesson was rescheduled",
    `<p>Hi ${escapeHtml(args.studentName)}, your lesson has been moved.</p>
      <p style="font-size:13px;color:#6b7280">Previous time: ${escapeHtml(bookingDetailsWhen(args.previousStartsAt))}</p>
      ${bookingDetailsTable(args)}
      ${manageButton(args.manageUrl)}
      <p style="font-size:13px;color:#4b525e;margin:16px 0 0">Online changes must be made at least 48 hours before the lesson. For later changes, call +1 236-234-3229; fees may apply.</p>`,
  );
  const sent = await sendEmail({
    to: args.studentEmail,
    subject: `Lesson rescheduled — ${args.reference}`,
    html,
  });
  await notifySchool(
    `Booking rescheduled — ${args.reference}`,
    bookingShell("Booking rescheduled", bookingDetailsTable(args)),
  );
  return sent;
}

/** "Find my booking" flow — emails a 6-digit code that proves inbox ownership. */
export async function sendBookingOtpEmail(args: {
  studentName: string;
  studentEmail: string;
  code: string;
}): Promise<boolean> {
  const html = bookingShell(
    "Your verification code",
    `<p>Hi ${escapeHtml(args.studentName)}, use this code to find and manage your booking on our website:</p>
     <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#111315;background:#f6f7f8;border-radius:12px;padding:16px 0;text-align:center;margin:18px 0 0">${args.code}</p>
     <p style="font-size:13px;color:#4b525e;margin:18px 0 0">This code is valid for 10 minutes and can be used again during that time if you return to My Booking. After it expires, you can request a new code. If you didn&rsquo;t request this, you can safely ignore this message — nothing about your booking changes.</p>`,
  );
  return sendEmail({
    to: args.studentEmail,
    subject: `Your verification code — Wisdom Driving Academy`,
    html,
    devHint: `OTP code: ${args.code}`,
  });
}

export async function sendBookingCancelledEmail(args: BookingArgs): Promise<boolean> {
  const html = bookingShell(
    "Your lesson was cancelled",
    `<p>Hi ${escapeHtml(args.studentName)}, your lesson below is now cancelled.</p>
     ${bookingDetailsTable(args)}
     <p style="font-size:13px;color:#4b525e;margin:18px 0 0">Need a new time? Book again any time from our website.</p>
     <p style="margin:20px 0 0"><a href="${escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? "https://wisdomdrivingacademy.ca")}/lessons" style="display:inline-block;background:#111315;color:#fff;font-weight:800;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px">Book a new lesson</a></p>`,
  );
  const sent = await sendEmail({
    to: args.studentEmail,
    subject: `Lesson cancelled — ${args.reference}`,
    html,
  });
  await notifySchool(
    `Booking cancelled — ${args.reference}`,
    bookingShell("Booking cancelled", bookingDetailsTable(args)),
  );
  return sent;
}

function bookingDetailsWhen(iso: string): string {
  return formatSlotFull(iso);
}
