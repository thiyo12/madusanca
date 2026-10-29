"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LessonStep } from "@/components/booking/lesson-step";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { DetailsStep, emptyDetails, type DetailsValue } from "@/components/booking/details-step";
import { BookingSummary } from "@/components/booking/booking-summary";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import type { Lesson } from "@/lib/data/lessons";

export interface BookingWizardProps {
  lessons: Lesson[];
  initialLessonId?: string;
}

type StepKey = "lesson" | "when" | "details" | "review";

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: "lesson", label: "Lesson" },
  { key: "when", label: "Date & time" },
  { key: "details", label: "Your details" },
  { key: "review", label: "Confirm" },
];

interface SuccessData {
  reference: string;
  manageUrl: string;
  manageToken: string;
  lessonName: string;
  durationMin: number;
  startsAt: string;
  studentName: string;
  email: string;
  priceCad: number;
  emailSent: boolean;
}

export function BookingWizard({ lessons, initialLessonId }: BookingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [lesson, setLesson] = useState<Lesson | null>(() => {
    if (!initialLessonId) return null;
    return lessons.find((l) => l.id === initialLessonId) ?? null;
  });
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [details, setDetails] = useState<DetailsValue>(emptyDetails);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);

  const step = STEPS[stepIndex]?.key ?? "lesson";

  const canAdvance = useMemo(() => {
    if (step === "lesson") return lesson !== null;
    if (step === "when") return startsAt !== null;
    return true;
  }, [step, lesson, startsAt]);

  function goNext() {
    if (!canAdvance) return;
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setSubmitError(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  function validateDetails(): boolean {
    if (details.firstName.trim().length < 2 || details.lastName.trim().length < 2) {
      setDetailsError("Please enter your first and last name.");
      return false;
    }
    if (details.studentName.trim().length < 2) {
      setDetailsError("Please enter your full legal name as shown on your licence.");
      return false;
    }
    if (!details.licenseClass) {
      setDetailsError("Please select your driver's licence class.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) {
      setDetailsError("Please enter a valid email address.");
      return false;
    }
    if (details.phone.trim().length < 7) {
      setDetailsError("Please enter a phone number we can reach you at.");
      return false;
    }
    if (!details.street.trim() || !details.city.trim() || !details.province.trim() || !details.postalCode.trim()) {
      setDetailsError("Please enter your complete pickup address.");
      return false;
    }
    if (!details.consent) {
      setDetailsError("You must agree to the privacy policy.");
      return false;
    }
    setDetailsError(null);
    return true;
  }

  async function handleDetailsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateDetails()) return;
    goNext();
  }

  async function confirmBooking() {
    if (!lesson || !startsAt) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          startsAt,
          studentName: details.studentName.trim(),
          email: details.email.trim(),
          phone: details.phone.trim(),
          notes: [
            `First name: ${details.firstName.trim()}`,
            `Last name: ${details.lastName.trim()}`,
            `Licence class: ${details.licenseClass}`,
            `Pickup address: ${details.street.trim()}, ${details.city.trim()}, ${details.province.trim()} ${details.postalCode.trim()}`,
            details.notes.trim() ? `Student notes: ${details.notes.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          website: details.website,
          consent: details.consent,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        manageUrl?: string;
        token?: string;
        booking?: {
          reference: string;
          lessonName: string;
          durationMin: number;
          startsAt: string;
          studentName: string;
          email?: string;
        };
        emailSent?: boolean;
      };

      if (!response.ok || !result.ok || !result.booking || !result.manageUrl || !result.token) {
        setSubmitError(result.error ?? "Could not complete your booking. Please try again.");
        return;
      }

      setSuccess({
        reference: result.booking.reference,
        manageUrl: result.manageUrl,
        manageToken: result.token,
        lessonName: result.booking.lessonName,
        durationMin: result.booking.durationMin,
        startsAt: result.booking.startsAt,
        studentName: result.booking.studentName,
        email: details.email.trim(),
        priceCad: lesson.priceCad,
        emailSent: result.emailSent === true,
      });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-[25px] border border-[#d3e9c5] bg-[#f5fbed] p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#102a28] text-lg font-extrabold text-[#c2ee84]">
          ✓
        </span>
        <h2 className="mt-4 font-display text-2xl font-extrabold text-ink">
          You&rsquo;re booked!
        </h2>
        {success.emailSent ? (
          <p className="mt-2 text-[15px] leading-relaxed text-[#4b525e]">
            A confirmation is on its way to <strong>{details.email.trim()}</strong> with your private booking link.
          </p>
        ) : (
          <p role="alert" className="mt-2 rounded-[12px] bg-[#eaf5df] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#31543a]">
            Your booking is reserved, but we couldn&rsquo;t deliver the confirmation to{" "}
            <strong>{details.email.trim()}</strong>. Save your reference below and keep this page&rsquo;s
            manage button, or call Shan at +1 236-234-3229 for help.
          </p>
        )}
        <BookingSummary
          className="mt-5 bg-white"
          reference={success.reference}
          data={{
            lessonName: success.lessonName,
            durationMin: success.durationMin,
            priceCad: success.priceCad,
            startsAt: success.startsAt,
            studentName: success.studentName,
            email: success.email,
          }}
        />
        <div className="mt-5 flex flex-wrap gap-3">
          <Button href={success.manageUrl} variant="dark">
            Manage this booking
          </Button>
          <StripeCheckoutButton token={success.manageToken} />
          <Button href="/lessons" variant="outline">
            Back to lessons
          </Button>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-[#616872]">
          You can pay securely online above or arrange payment directly with the
          school. A paid invoice is generated by Stripe. Please bring your valid
          driver&rsquo;s licence.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[25px] border border-line bg-white p-5 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
      <ol className="mb-7 flex flex-wrap gap-x-5 gap-y-2" aria-label="Booking progress">
        {STEPS.map((item, index) => {
          const active = index === stepIndex;
          const done = index < stepIndex;
          return (
            <li key={item.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-extrabold ${
                  active
                     ? "bg-[#c2ee84] text-[#102a28]"
                    : done
                      ? "bg-ink text-white"
                      : "bg-mist text-soft"
                }`}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={`text-[12.5px] font-bold ${
                  active ? "text-ink" : done ? "text-[#4b525e]" : "text-soft"
                }`}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>

      {step === "lesson" && (
        <LessonStep lessons={lessons} selectedId={lesson?.id ?? null} onSelect={setLesson} />
      )}

      {step === "when" && lesson && (
        <DateTimeStep
          key={lesson.id}
          lessonId={lesson.id}
          selectedStart={startsAt}
          onSelect={setStartsAt}
        />
      )}

      {step === "details" && (
        <form onSubmit={handleDetailsSubmit} noValidate>
          <DetailsStep value={details} onChange={setDetails} error={detailsError} />
          <Button type="submit" className="mt-6 w-full sm:w-auto">
            Review booking
          </Button>
        </form>
      )}

      {step === "review" && lesson && startsAt && (
        <div>
          <BookingSummary
            data={{
              lessonName: lesson.name,
              durationMin: lesson.durationMin,
              priceCad: lesson.priceCad,
              startsAt,
              studentName: details.studentName.trim(),
              email: details.email.trim(),
            }}
          />
          <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-soft">
            <p>
              Confirming reserves this time. You&rsquo;ll receive a private manage link by
              email to change or cancel online at least 48 hours before the lesson.
            </p>
            {lesson.id === "five-lesson-pack" || lesson.id === "eight-lesson-pack" ? (
              <p>
                This booking reserves the first 90-minute session in the pack; we&rsquo;ll
                arrange the remaining sessions with you.
              </p>
            ) : lesson.id === "road-test-package" ? (
              <p>
                This booking reserves the 45-minute mock test. We&rsquo;ll confirm the
                road-test date, car rental and pickup time with you separately.
              </p>
            ) : null}
          </div>
          {submitError && (
            <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
              {submitError}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={confirmBooking} disabled={submitting} className="w-full sm:w-auto">
              {submitting ? "Confirming…" : "Confirm booking"}
            </Button>
            <Button variant="outline" onClick={goBack} disabled={submitting}>
              Change details
            </Button>
          </div>
        </div>
      )}

      {(step === "lesson" || step === "when") && (
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0}>
            <span aria-hidden="true">←</span> Back
          </Button>
          <Button onClick={goNext} disabled={!canAdvance}>
            Continue <span aria-hidden="true">→</span>
          </Button>
        </div>
      )}
    </div>
  );
}
