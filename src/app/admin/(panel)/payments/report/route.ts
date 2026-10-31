import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listPaidCheckoutSessions, paymentReportCsv, paymentReportRange } from "@/lib/stripe/payment-report";
import { stripeMode } from "@/lib/stripe/server";
import { logSafeError } from "@/lib/server/safe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  await requireAdmin("/admin/payments");
  const period = request.nextUrl.searchParams.get("period");
  if (period !== "week" && period !== "month") {
    return NextResponse.json({ error: "Choose a weekly or monthly report." }, { status: 400 });
  }

  try {
    const range = paymentReportRange(period);
    const sessions = await listPaidCheckoutSessions(range);
    const csv = `\uFEFF${paymentReportCsv(sessions)}`;
    const filename = `wisdom-payments-${period}-${range.fromDate}-to-${range.toDate}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Stripe-Mode": stripeMode(),
      },
    });
  } catch (error) {
    logSafeError("[admin/payments/report] Stripe report failed", error);
    return NextResponse.json(
      { error: "Could not download the Stripe report. Check the Stripe connection and try again." },
      { status: 503 },
    );
  }
}
