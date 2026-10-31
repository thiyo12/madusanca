import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";

export type PaymentReportPeriod = "week" | "month";

export interface PaymentReportRange {
  start: number;
  end: number;
  fromDate: string;
  toDate: string;
}

/** Current calendar week (Monday start) or month, using Vancouver local dates. */
export function paymentReportRange(period: PaymentReportPeriod, now = new Date()): PaymentReportRange {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  let startYear = year;
  let startMonth = month;
  let firstDay = 1;
  if (period === "week") {
    const date = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    startYear = date.getUTCFullYear();
    startMonth = date.getUTCMonth() + 1;
    firstDay = date.getUTCDate();
  }
  const fromDate = `${startYear}-${String(startMonth).padStart(2, "0")}-${String(firstDay).padStart(2, "0")}`;
  const toDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    start: localMidnightUnix(fromDate),
    end: Math.floor(now.getTime() / 1000),
    fromDate,
    toDate,
  };
}

function localMidnightUnix(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day);
  let guess = desiredLocalAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 3; i += 1) {
    const localParts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const localAsUtc = Date.UTC(
      Number(localParts.year), Number(localParts.month) - 1, Number(localParts.day),
      Number(localParts.hour), Number(localParts.minute), Number(localParts.second),
    );
    guess += desiredLocalAsUtc - localAsUtc;
  }
  return Math.floor(guess / 1000);
}

export async function listPaidCheckoutSessions(range: PaymentReportRange): Promise<Stripe.Checkout.Session[]> {
  const stripe = getStripe();
  const sessions: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  let scanned = 0;
  let truncated = false;
  while (scanned < 10_000) {
    const page = await stripe.checkout.sessions.list({
      created: { gte: range.start, lte: range.end },
      status: "complete",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    scanned += page.data.length;
    sessions.push(...page.data.filter((session) => session.payment_status === "paid"));
    if (!page.has_more || page.data.length === 0) break;
    if (scanned >= 10_000) { truncated = true; break; }
    startingAfter = page.data[page.data.length - 1].id;
  }
  if (truncated) throw new Error("Report is larger than the supported 10,000 Checkout Sessions.");
  return sessions;
}

export function paymentReportCsv(sessions: Stripe.Checkout.Session[]): string {
  const headings = [
    "Checkout created (Pacific Time)", "Booking reference", "Payment type", "Customer email",
    "Subtotal CAD", "Tax CAD", "Customer paid CAD", "Currency", "Checkout session ID", "Live mode",
  ];
  const rows = sessions.map((session) => [
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver", dateStyle: "short", timeStyle: "short",
    }).format(new Date(session.created * 1000)),
    session.metadata?.booking_reference ?? session.client_reference_id ?? "",
    session.metadata?.checkout_kind === "package_upgrade"
      ? `Package upgrade${session.metadata.target_lesson_name ? `: ${session.metadata.target_lesson_name}` : ""}`
      : `Booking payment${session.metadata?.lesson_name ? `: ${session.metadata.lesson_name}` : ""}`,
    session.customer_details?.email ?? session.customer_email ?? "",
    centsToCad(session.amount_subtotal),
    centsToCad(session.total_details?.amount_tax),
    centsToCad(session.amount_total),
    (session.currency ?? "cad").toUpperCase(),
    session.id,
    session.livemode ? "Yes" : "No",
  ]);
  return [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function centsToCad(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
