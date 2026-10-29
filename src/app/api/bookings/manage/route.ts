import { NextResponse } from "next/server";
import { getStore } from "@/lib/booking/store";
import { validateSlot } from "@/lib/booking/slots";
import { generateToken, hashToken, tokenExpiry } from "@/lib/booking/tokens";
import { manageSchema } from "@/lib/validation/booking";
import { maskEmail } from "@/lib/booking/format";
import { isRateLimited, clientIp } from "@/lib/server/rate-limit";
import {
  sendBookingCancelledEmail,
  sendBookingRescheduledEmail,
} from "@/lib/email/booking-emails";
import type { BookingRecord } from "@/lib/booking/types";
import { manageUrl as buildManageUrl, siteBase } from "@/lib/booking/urls";
import { readBoundedBody } from "@/lib/server/read-bounded-body";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8_192;

const ERROR_STATUS: Record<string, number> = {
  expired: 410,
  not_found: 404,
  not_modifiable: 409,
  conflict: 409,
  cutoff: 409,
  reschedule_limit: 409,
};

const SELF_SERVICE_CUTOFF_MS = 48 * 60 * 60 * 1000;

function isInsideSelfServiceWindow(startsAt: string): boolean {
  return Date.parse(startsAt) - Date.now() < SELF_SERVICE_CUTOFF_MS;
}

function errorResponse(error: string, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: ERROR_STATUS[error] ?? 400 },
  );
}

function safeView(booking: BookingRecord): {
  reference: string;
  lessonId: string;
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  endsAt: string;
  studentName: string;
  emailMasked: string;
  status: string;
  studentRescheduleCount: number;
  paymentStatus: string;
  invoiceUrl?: string;
} {
  return {
    reference: booking.reference,
    lessonId: booking.lessonId,
    lessonName: booking.lessonName,
    durationMin: booking.durationMin,
    priceCad: booking.priceCad,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    studentName: booking.studentName,
    emailMasked: maskEmail(booking.email),
    status: booking.status,
    studentRescheduleCount: booking.studentRescheduleCount ?? 0,
    paymentStatus: booking.paymentStatus ?? "due",
    invoiceUrl: booking.stripeInvoiceUrl,
  };
}

async function load(hash: string) {
  const store = getStore();
  return store.getBookingByToken(hash);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isRateLimited(`manage:${clientIp(request)}`, 15, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const result = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(result.text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = manageSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: firstIssue?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { action, token, startsAt } = parsed.data;
  const hash = hashToken(token);

  try {
    if (action === "get") {
      const found = await load(hash);
      if (!found) {
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      return NextResponse.json({ ok: true, booking: safeView(found.booking) });
    }

    if (action === "cancel") {
      const store = getStore();
      const found = await load(hash);
      if (!found) {
        return errorResponse("not_found", "This booking link is invalid or has expired.");
      }
      if (found.booking.status === "cancelled" || found.booking.status === "completed") {
        return errorResponse("not_modifiable", "This booking can no longer be changed.");
      }
      if (isInsideSelfServiceWindow(found.booking.startsAt)) {
        return errorResponse("cutoff", messageFor("cutoff"));
      }
      if (found.booking.stripeCheckoutSessionId) {
        try {
          const stripe = (await import("@/lib/stripe/server")).getStripe();
          const session = await stripe.checkout.sessions.retrieve(found.booking.stripeCheckoutSessionId);
          if (session.status === "complete") {
            return errorResponse("not_modifiable", session.payment_status === "paid"
              ? "This booking has already been paid. Contact the school for cancellation or refund help."
              : "Payment is still processing. Please try again after Stripe confirms its status.");
          }
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
          await store.handleStripeCheckoutEvent({
            eventId: `customer-cancel-expire-${session.id}`,
            eventType: "expired",
            bookingId: found.booking.id,
            sessionId: session.id,
          });
        } catch (error) {
          console.error("[bookings/manage] Checkout cancellation check failed", error);
          return NextResponse.json({ ok: false, error: "Could not verify payment status. Please try again shortly." }, { status: 503 });
        }
      }
      const result = await store.cancelBookingByToken(hash);
      if (!result.ok) {
        return errorResponse(result.error, messageFor(result.error));
      }
      const emailSent = await sendBookingCancelledEmail({
        reference: result.value.reference,
        lessonName: result.value.lessonName,
        durationMin: result.value.durationMin,
        startsAt: result.value.startsAt,
        studentName: result.value.studentName,
        studentEmail: result.value.email,
        manageUrl: siteBase(),
      });
      return NextResponse.json({ ok: true, booking: safeView(result.value), emailSent });
    }

    // action === "reschedule"
    if (!startsAt) {
      return NextResponse.json(
        { ok: false, error: "Please choose a new time." },
        { status: 400 },
      );
    }

    const store = getStore();
    const found = await load(hash);
    if (!found) {
      return errorResponse("not_found", "This booking link is invalid or has expired.");
    }
    if (found.booking.status === "cancelled" || found.booking.status === "completed") {
      return errorResponse("not_modifiable", "This booking can no longer be changed.");
    }
    if (isInsideSelfServiceWindow(found.booking.startsAt)) {
      return errorResponse("cutoff", messageFor("cutoff"));
    }
    if (found.booking.stripeCheckoutSessionId) {
      try {
        const stripe = (await import("@/lib/stripe/server")).getStripe();
        const session = await stripe.checkout.sessions.retrieve(found.booking.stripeCheckoutSessionId);
        if (session.status === "complete") {
          return errorResponse("not_modifiable", session.payment_status === "paid"
            ? "This booking has already been paid. Contact the school before rescheduling."
            : "Payment is still processing. Please try again after Stripe confirms its status.");
        }
        if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
        await store.handleStripeCheckoutEvent({
          eventId: `customer-reschedule-expire-${session.id}`,
          eventType: "expired",
          bookingId: found.booking.id,
          sessionId: session.id,
        });
      } catch (error) {
        console.error("[bookings/manage] Checkout reschedule check failed", error);
        return NextResponse.json({ ok: false, error: "Could not verify payment status. Please try again shortly." }, { status: 503 });
      }
    }

    // Use the duration stored on the booking — catalogue edits must not
    // retroactively change lessons already booked.
    const durationMin = found.booking.durationMin;
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) {
      return NextResponse.json({ ok: false, error: "Invalid date." }, { status: 400 });
    }
    const endsAt = new Date(startMs + durationMin * 60000).toISOString();

    const now = new Date();
    const [rules, blackouts, busy] = await Promise.all([
      store.getRules(),
      store.getBlackouts(),
      store.getBusy(
        new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
        new Date(startMs + 48 * 60 * 60 * 1000).toISOString(),
      ),
    ]);
    // The customer's own current slot counts as free while rescheduling.
    const ownBusy = busy.filter(
      (interval) =>
        !(interval.startsAt === found.booking.startsAt && interval.endsAt === found.booking.endsAt),
    );

    const validation = validateSlot(new Date(startMs).toISOString(), {
      lessonDurationMin: durationMin,
      busy: ownBusy,
      blackouts,
      rules,
      now,
    });
    if (!validation.valid) {
      return NextResponse.json(
        {
          ok: false,
          error:
            validation.reason === "occupied"
              ? "That time was just taken. Please pick another slot."
              : "That time is no longer available. Please pick another slot.",
        },
        { status: 409 },
      );
    }

    const newToken = generateToken();
    const previousStartsAt = found.booking.startsAt;
    const result = await store.rescheduleBookingByToken(hash, new Date(startMs).toISOString(), endsAt, {
      hash: hashToken(newToken),
      expiresAt: tokenExpiry(),
    });
    if (!result.ok) {
      return errorResponse(result.error, messageFor(result.error));
    }

    const manageUrl = buildManageUrl(newToken);
    const emailSent = await sendBookingRescheduledEmail({
      reference: result.value.reference,
      lessonName: result.value.lessonName,
      durationMin: result.value.durationMin,
      startsAt: result.value.startsAt,
      previousStartsAt,
      studentName: result.value.studentName,
      studentEmail: result.value.email,
      manageUrl,
    });

    return NextResponse.json({
      ok: true,
      booking: safeView(result.value),
      token: newToken,
      manageUrl,
      emailSent,
    });
  } catch (error) {
    console.error("[bookings] manage failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not update the booking. Please try again." },
      { status: 500 },
    );
  }
}

function messageFor(error: string): string {
  switch (error) {
    case "expired":
      return "This booking link has expired. Please contact us to make changes.";
    case "not_modifiable":
      return "This booking can no longer be changed.";
    case "conflict":
      return "That time was just taken. Please pick another slot.";
    case "cutoff":
      return "Online changes close 48 hours before the lesson. Please call the school for help with this booking.";
    case "reschedule_limit":
      return "This booking has already been rescheduled twice online. Call Shan at +1 236-234-3229 for help.";
    default:
      return "This booking link is invalid or has expired.";
  }
}
