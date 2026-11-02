"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LessonStep } from "@/components/booking/lesson-step";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { DetailsStep, emptyDetails, type DetailsValue } from "@/components/booking/details-step";
import { BookingSummary } from "@/components/booking/booking-summary";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import { formatLessonPrice, type Lesson } from "@/lib/data/lessons";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import type { PackageQuantitySelection } from "@/lib/booking/types";

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
  manageToken: string;
  lessonName: string;
  durationMin: number;
  startsAt: string;
  studentName: string;
  email: string;
  priceCad: number;
  emailSent: boolean;
  addOnPackages: PackageQuantitySelection[];
  addOns: Array<{ id: string; name: string; priceCad: number; sessionCount: number; quantity: number }>;
}

export function BookingWizard({ lessons, initialLessonId }: BookingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [lesson, setLesson] = useState<Lesson | null>(() => {
    if (!initialLessonId) return null;
    return lessons.find((l) => l.id === initialLessonId) ?? null;
  });
  const [startsAt, setStartsAt] = useState<string[]>([]);
  const [packageQuantities, setPackageQuantities] = useState<Record<string, number>>({});
  const addOnPackages = useMemo(() => Object.entries(packageQuantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([lessonId, quantity]) => ({ lessonId, quantity })), [packageQuantities]);
  const [showAddOns, setShowAddOns] = useState(false);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [details, setDetails] = useState<DetailsValue>(emptyDetails);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [success, setSuccess] = useState<SuccessData | null>(null);

  const step = STEPS[stepIndex]?.key ?? "lesson";

  const canAdvance = useMemo(() => {
    if (step === "lesson") return lesson !== null;
    if (step === "when") return Boolean(lesson && startsAt.length === lesson.sessionCount);
    return true;
  }, [step, lesson, startsAt]);

  const packageWindowEnd = useMemo(() => {
    if (!startsAt[0]) return undefined;
    return addMonthsToKey(dayKeyOf(startsAt[0]), 2);
  }, [startsAt]);

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
    if (!lesson || startsAt.length !== lesson.sessionCount) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          sessions: startsAt,
          addOnPackages,
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
          manageToken?: string;
        booking?: {
          reference: string;
          lessonName: string;
          durationMin: number;
          priceCad?: number;
          startsAt: string;
          sessions?: Array<{ startsAt: string }>;
          studentName: string;
          email?: string;
        };
          emailSent?: boolean;
        addOns?: Array<{ id: string; name: string; priceCad: number; sessionCount: number; quantity: number }>;
      };

      if (!response.ok || !result.ok || !result.booking || !result.manageToken) {
        const message = result.error ?? "Could not complete your booking. Please try again.";
        setSubmitError(message);
        if (response.status === 409) {
          setStepIndex(1);
          setSessionIndex(0);
          setStartsAt([]);
          setAvailabilityRevision((revision) => revision + 1);
        }
        return;
      }

      setSuccess({
        reference: result.booking.reference,
        manageToken: result.manageToken,
        lessonName: result.booking.lessonName,
        durationMin: result.booking.durationMin,
        startsAt: result.booking.startsAt,
        studentName: result.booking.studentName,
        email: details.email.trim(),
        priceCad: result.booking.priceCad ?? lesson.priceCad,
        emailSent: result.emailSent === true,
        addOnPackages: (result.addOns ?? []).map((item) => ({ lessonId: item.id, quantity: item.quantity })),
        addOns: result.addOns ?? [],
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
            A confirmation is on its way to <strong>{details.email.trim()}</strong>. To manage this booking, verify your email on My Booking.
          </p>
        ) : (
          <p role="alert" className="mt-2 rounded-[12px] bg-[#eaf5df] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#31543a]">
            Your booking is reserved, but we couldn&rsquo;t deliver the confirmation to{" "}
            <strong>{details.email.trim()}</strong>. Save your reference below and use My Booking with your email and verification code, or call Shan at +1 236-234-3229 for help.
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
        {success.addOns.length > 0 && (
          <section className="mt-4 rounded-[17px] border border-line bg-white p-4 sm:p-5">
            <h3 className="text-sm font-extrabold text-ink">Checkout review</h3>
            <ul className="mt-2 grid gap-2 text-[13px]">
              <li className="flex justify-between gap-3"><span className="text-soft">{success.lessonName}</span><strong className="text-ink">${success.priceCad.toFixed(2)} CAD</strong></li>
              {success.addOns.map((item) => <li key={item.id} className="flex justify-between gap-3"><span className="text-soft">{item.name} × {item.quantity} · {item.sessionCount * item.quantity} lesson credits</span><strong className="text-ink">${(item.priceCad * item.quantity).toFixed(2)} CAD</strong></li>)}
              <li className="flex justify-between gap-3 border-t border-line pt-2 font-extrabold"><span>Subtotal</span><span>${(success.priceCad + success.addOns.reduce((sum, item) => sum + item.priceCad * item.quantity, 0)).toFixed(2)} CAD</span></li>
            </ul>
            <p className="mt-2 text-[11px] text-soft">Applicable tax will be calculated and shown by Stripe Checkout before payment.</p>
          </section>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <StripeCheckoutButton manageToken={success.manageToken} addOnPackages={success.addOnPackages} />
          <Button href="/booking/manage" variant="outline">
            My Booking (email code)
          </Button>
          <Button href="/lessons" variant="outline">
            Back to lessons
          </Button>
        </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-[#616872]">
          Your time is reserved while payment is due. Pay securely above or later from My Booking. To make changes, verify your email in My Booking. Please bring your valid driver&rsquo;s licence.
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
        <div className="grid gap-5">
          <LessonStep lessons={lessons} selectedId={lesson?.id ?? null} onSelect={setLesson} />
          {lesson && (
            <section className="rounded-[16px] border border-line bg-[#fbfcf9] p-4 sm:p-5">
              <button type="button" onClick={() => setShowAddOns((open) => !open)} aria-expanded={showAddOns} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="text-sm font-extrabold text-ink">Need extra driving lessons?</span>
                <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-[#eaf5df] text-lg font-bold text-[#426a2c]">{showAddOns ? "−" : "+"}</span>
              </button>
              {showAddOns && (
                <div className="mt-3 grid gap-2">
                   {lessons.filter((item) => item.category === "package").map((item) => {
                     const quantity = packageQuantities[item.id] ?? 0;
                     return (
                       <label key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                         <span className="grid gap-0.5">
                           <span className="text-[13px] font-extrabold text-ink">{item.name}{item.id === lesson.id ? " · same package as selected" : ""}</span>
                           <span className="text-[12px] text-soft">{item.sessionCount} lesson credits per package · {item.durationMin} min each · {formatLessonPrice(item.priceCad)}</span>
                         </span>
                         <span className="ml-auto grid shrink-0 gap-1 text-right">
                           <span className="text-[10px] font-bold uppercase tracking-wide text-soft">Packages</span>
                           <input type="number" min="0" step="1" inputMode="numeric" aria-label={`Additional ${item.name} packages`} value={quantity || ""} placeholder="0" onChange={(event) => {
                             const next = Number.parseInt(event.target.value, 10);
                             setPackageQuantities((current) => ({ ...current, [item.id]: Number.isSafeInteger(next) && next > 0 ? next : 0 }));
                           }} className="h-10 w-20 rounded-lg border border-line px-2 text-center text-sm font-bold text-ink" />
                         </span>
                       </label>
                     );
                   })}
                   <p className="text-[11px] leading-relaxed text-soft">Set a quantity for any package, including the package selected above. All selected packages are added to one checkout; additional credits can be scheduled later in My Booking. Applicable taxes are calculated at checkout.</p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {step === "when" && lesson && (
        <div>
          {submitError && <p role="alert" className="mb-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">{submitError}</p>}
          <p className="mb-3 text-sm font-extrabold text-ink">Choose a separate date and time for each session</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {Array.from({ length: lesson.sessionCount }, (_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSessionIndex(index)}
                aria-pressed={sessionIndex === index}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${sessionIndex === index ? "border-ink bg-ink text-white" : "border-line text-ink"}`}
              >
                Session {index + 1}{startsAt[index] ? " ✓" : ""}
              </button>
            ))}
          </div>
          {packageWindowEnd && <p className="mb-3 text-xs text-soft">All sessions must be booked by {packageWindowEnd} (two months from your first session).</p>}
          <DateTimeStep
            key={`${lesson.id}-${availabilityRevision}`}
            lessonId={lesson.id}
            selectedStart={startsAt[sessionIndex] ?? null}
            maxDate={packageWindowEnd}
            minDate={sessionIndex > 0 && startsAt[0] ? dayKeyOf(startsAt[0]) : undefined}
            horizonDays={lesson.sessionCount > 1 && sessionIndex > 0 ? 150 : 90}
            blockedStartsAt={startsAt.filter((_, index) => index !== sessionIndex)}
            onSelect={(slot) => {
              setSubmitError(null);
              setStartsAt((current) => {
                const next = [...current];
                next[sessionIndex] = slot;
                return next;
              });
              setSessionIndex((index) => Math.min(index + 1, lesson.sessionCount - 1));
            }}
          />
        </div>
      )}

      {step === "details" && (
        <form onSubmit={handleDetailsSubmit} noValidate>
          <DetailsStep value={details} onChange={setDetails} error={detailsError} />
          <Button type="submit" className="mt-6 w-full sm:w-auto">
            Review booking
          </Button>
        </form>
      )}

      {step === "review" && lesson && startsAt.length === lesson.sessionCount && (
        <div>
          <BookingSummary
            data={{
              lessonName: lesson.name,
              durationMin: lesson.durationMin,
              priceCad: lesson.priceCad,
              startsAt: startsAt[0],
              studentName: details.studentName.trim(),
              email: details.email.trim(),
            }}
          />
          {addOnPackages.length > 0 && (
            <section className="mt-4 rounded-[17px] border border-line p-4 sm:p-5">
              <h3 className="text-sm font-extrabold text-ink">Additional lesson credits</h3>
              <ul className="mt-2 grid gap-2 text-[13px]">
                {addOnPackages.map(({ lessonId: id, quantity }) => {
                  const extra = lessons.find((item) => item.id === id);
                  return extra ? <li key={id} className="flex justify-between gap-3"><span className="text-soft">{extra.name} × {quantity} · {extra.sessionCount * quantity} lesson credits</span><strong className="text-ink">{formatLessonPrice(extra.priceCad * quantity)}</strong></li> : null;
                })}
                <li className="flex justify-between gap-3 border-t border-line pt-2 font-extrabold"><span>New items subtotal</span><span>${(lesson.priceCad + addOnPackages.reduce((sum, selection) => sum + (lessons.find((item) => item.id === selection.lessonId)?.priceCad ?? 0) * selection.quantity, 0)).toFixed(2)} CAD + applicable taxes</span></li>
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-soft">Stripe will calculate applicable tax and show the final payable total before you pay.</p>
            </section>
          )}
          <section className="mt-4 rounded-[17px] border border-line p-4 sm:p-5">
            <h3 className="text-sm font-extrabold text-ink">Your details</h3>
            <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
              <div><dt className="text-soft">Name</dt><dd className="font-bold text-ink">{details.firstName} {details.lastName}</dd></div>
              <div><dt className="text-soft">Student / licence name</dt><dd className="font-bold text-ink">{details.studentName}</dd></div>
              <div><dt className="text-soft">Email</dt><dd className="break-all font-bold text-ink">{details.email}</dd></div>
              <div><dt className="text-soft">Phone</dt><dd className="font-bold text-ink">{details.phone}</dd></div>
              <div className="sm:col-span-2"><dt className="text-soft">Pickup address</dt><dd className="font-bold text-ink">{details.street}, {details.city}, {details.province} {details.postalCode}</dd></div>
              <div><dt className="text-soft">Licence class</dt><dd className="font-bold text-ink">{details.licenseClass}</dd></div>
              {details.notes && <div className="sm:col-span-2"><dt className="text-soft">Notes</dt><dd className="font-bold text-ink">{details.notes}</dd></div>}
            </dl>
          </section>
          <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-soft">
            <p>
              Confirming reserves this time. Your confirmation email links to My Booking,
              where you must verify your email before viewing or changing bookings.
            </p>
            {lesson.sessionCount > 1 ? (
              <div>
                <p>All {lesson.sessionCount} session times are included and must be within two months of the first session:</p>
                <ol className="mt-2 list-inside list-decimal">
                  {startsAt.map((slot, index) => <li key={`${slot}-${index}`}>{new Date(slot).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific</li>)}
                </ol>
              </div>
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
            <Button variant="outline" onClick={() => { setSubmitError(null); setStepIndex(0); }} disabled={submitting}>
              Change lesson / extras
            </Button>
            <Button variant="outline" onClick={() => { setSubmitError(null); setStepIndex(1); setSessionIndex(0); }} disabled={submitting}>
              Change date / time
            </Button>
          </div>
        </div>
      )}

      {(step === "lesson" || step === "when") && (
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button variant="ghost" onClick={() => step === "when" && sessionIndex > 0 ? setSessionIndex((index) => index - 1) : goBack()} disabled={stepIndex === 0}>
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
