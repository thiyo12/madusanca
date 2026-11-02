"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LessonStep } from "@/components/booking/lesson-step";
import { DateTimeStep } from "@/components/booking/date-time-step";
import { DetailsStep, emptyDetails, type DetailsValue } from "@/components/booking/details-step";
import { BookingSummary } from "@/components/booking/booking-summary";
import { StripeCheckoutButton } from "@/components/booking/stripe-checkout-button";
import { formatLessonPrice, type Lesson } from "@/lib/data/lessons";
import { addMonthsToKey, dayKeyOf } from "@/lib/booking/format";
import type { PackageQuantitySelection, ScheduledPackageSelection } from "@/lib/booking/types";

export interface BookingWizardProps {
  lessons: Lesson[];
  initialLessonId?: string;
}

type StepKey = "lesson" | "when" | "preview" | "details" | "review";

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: "lesson", label: "Lesson" },
  { key: "when", label: "Date & time" },
  { key: "preview", label: "Preview" },
  { key: "details", label: "Your details" },
  { key: "review", label: "Confirm" },
];

const BOOKING_DRAFT_KEY = "wda-booking-draft-v1";
const BOOKING_DRAFT_TTL_MS = 30 * 60 * 1000;

interface StoredBookingDraft {
  version: 1;
  savedAt: number;
  stepIndex: number;
  lessonId: string | null;
  packageQuantities: Record<string, number>;
  scheduledStarts: Record<string, string>;
  showAddOns: boolean;
  appointmentIndex: number;
  details: DetailsValue;
}

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
  sessions: Array<{ lessonName: string; startsAt: string }>;
}

export function BookingWizard({ lessons, initialLessonId }: BookingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [lesson, setLesson] = useState<Lesson | null>(() => {
    if (!initialLessonId) return null;
    return lessons.find((l) => l.id === initialLessonId) ?? null;
  });
  const [scheduledStarts, setScheduledStarts] = useState<Record<string, string>>({});
  const [packageQuantities, setPackageQuantities] = useState<Record<string, number>>({});
  const addOnPackages = useMemo(() => Object.entries(packageQuantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([lessonId, quantity]) => ({ lessonId, quantity })), [packageQuantities]);
  const [showAddOns, setShowAddOns] = useState(false);
  const [appointmentIndex, setAppointmentIndex] = useState(0);
  const [details, setDetails] = useState<DetailsValue>(emptyDetails);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [draftReady, setDraftReady] = useState(false);

  const appointments = useMemo(() => {
    if (!lesson) return [];
    const primary = Array.from({ length: lesson.sessionCount }, (_, index) => ({
      key: `primary-${index}`,
      groupKey: "primary",
      groupLabel: `${lesson.name} · selected package`,
      lessonId: lesson.id,
      lessonName: lesson.name,
      label: `Lesson ${index + 1} of ${lesson.sessionCount}`,
    }));
    const extras = addOnPackages.flatMap((selection) => {
      const selectedLesson = lessons.find((item) => item.id === selection.lessonId);
      if (!selectedLesson) return [];
      return Array.from({ length: selection.quantity }, (_, packIndex) =>
        Array.from({ length: selectedLesson.sessionCount }, (_, sessionIndex) => ({
          key: `addon-${selectedLesson.id}-${packIndex}-${sessionIndex}`,
          groupKey: `addon-${selectedLesson.id}-${packIndex}`,
          groupLabel: `Additional ${selectedLesson.name} · Package ${packIndex + 1}`,
          lessonId: selectedLesson.id,
          lessonName: selectedLesson.name,
          label: `Lesson ${sessionIndex + 1} of ${selectedLesson.sessionCount}`,
        })),
      ).flat();
    });
    return [...primary, ...extras];
  }, [lesson, addOnPackages, lessons]);

  const appointmentGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: typeof appointments }>();
    for (const appointment of appointments) {
      const group = groups.get(appointment.groupKey);
      if (group) group.items.push(appointment);
      else groups.set(appointment.groupKey, { key: appointment.groupKey, label: appointment.groupLabel, items: [appointment] });
    }
    return Array.from(groups.values());
  }, [appointments]);

  const scheduledCount = appointments.filter((item) => Boolean(scheduledStarts[item.key])).length;
  const activeAppointmentIndex = Math.min(appointmentIndex, Math.max(appointments.length - 1, 0));

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const raw = window.sessionStorage.getItem(BOOKING_DRAFT_KEY);
        if (raw) {
        const saved = JSON.parse(raw) as Partial<StoredBookingDraft>;
        const age = Date.now() - (typeof saved.savedAt === "number" ? saved.savedAt : 0);
        if (saved.version === 1 && age >= 0 && age < BOOKING_DRAFT_TTL_MS) {
          const restoredLesson = lessons.find((item) => item.id === saved.lessonId) ?? null;
          const quantities = Object.fromEntries(Object.entries(saved.packageQuantities ?? {}).filter(([id, quantity]) =>
            lessons.some((item) => item.id === id && item.category === "package") && Number.isSafeInteger(quantity) && quantity > 0,
          ));
          const starts = Object.fromEntries(Object.entries(saved.scheduledStarts ?? {}).filter(([, startsAt]) =>
            typeof startsAt === "string" && Number.isFinite(Date.parse(startsAt)),
          ));
          const restoredDetails = { ...emptyDetails };
          if (saved.details && typeof saved.details === "object") {
            for (const key of Object.keys(restoredDetails) as Array<keyof DetailsValue>) {
              const value = saved.details[key];
              if (typeof value === "string") restoredDetails[key] = value as never;
              else if (key === "consent" && typeof value === "boolean") restoredDetails.consent = value;
            }
          }
          setLesson(restoredLesson);
          setPackageQuantities(quantities);
          setScheduledStarts(starts);
          setShowAddOns(saved.showAddOns === true);
          setAppointmentIndex(Number.isSafeInteger(saved.appointmentIndex) && (saved.appointmentIndex ?? -1) >= 0 ? saved.appointmentIndex! : 0);
          setDetails(restoredDetails);
          const maxStep = Math.max(0, Math.min(STEPS.length - 1, Number.isSafeInteger(saved.stepIndex) ? saved.stepIndex! : 0));
          setStepIndex(maxStep >= 2 && Object.keys(starts).length === 0 ? 1 : maxStep);
        } else {
          window.sessionStorage.removeItem(BOOKING_DRAFT_KEY);
        }
        }
      } catch {
        try {
          window.sessionStorage.removeItem(BOOKING_DRAFT_KEY);
        } catch {
          // Storage may be disabled; the in-memory form still works.
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [lessons]);

  useEffect(() => {
    if (!draftReady || success) return;
    const hasDraft = Boolean(lesson || Object.keys(packageQuantities).length || Object.keys(scheduledStarts).length ||
      details.firstName || details.lastName || details.studentName || details.dateOfBirth || details.gender || details.licenseNumber || details.email);
    if (!hasDraft) return;

    const draft: StoredBookingDraft = {
      version: 1,
      savedAt: Date.now(),
      stepIndex,
      lessonId: lesson?.id ?? null,
      packageQuantities,
      scheduledStarts,
      showAddOns,
      appointmentIndex,
      details,
    };
    try {
      window.sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Keep the form usable when browser storage is unavailable.
    }

    const expiry = window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem(BOOKING_DRAFT_KEY);
      } catch {
        // Ignore disabled storage.
      }
      setStepIndex(0);
      setLesson(null);
      setPackageQuantities({});
      setScheduledStarts({});
      setShowAddOns(false);
      setAppointmentIndex(0);
      setDetails(emptyDetails);
    }, BOOKING_DRAFT_TTL_MS);
    return () => window.clearTimeout(expiry);
  }, [draftReady, success, stepIndex, lesson, packageQuantities, scheduledStarts, showAddOns, appointmentIndex, details]);

  const packageSchedules = useMemo<ScheduledPackageSelection[]>(() => {
    if (!lesson) return [];
    return [
      { lessonId: lesson.id, quantity: 1, startsAt: Array.from({ length: lesson.sessionCount }, (_, index) => scheduledStarts[`primary-${index}`]).filter((value): value is string => Boolean(value)) },
      ...addOnPackages.map((selection) => ({
        ...selection,
        startsAt: appointments.filter((item) => item.key.startsWith(`addon-${selection.lessonId}-`))
          .map((item) => scheduledStarts[item.key]).filter((value): value is string => Boolean(value)),
      })),
    ];
  }, [lesson, addOnPackages, appointments, scheduledStarts]);

  const startsAt = useMemo(() => Array.from({ length: lesson?.sessionCount ?? 0 }, (_, index) => scheduledStarts[`primary-${index}`]).filter((value): value is string => Boolean(value)), [lesson, scheduledStarts]);

  const step = STEPS[stepIndex]?.key ?? "lesson";

  const canAdvance = useMemo(() => {
    if (step === "lesson") return lesson !== null;
    if (step === "when") return appointments.length > 0 && appointments.every((item) => Boolean(scheduledStarts[item.key]));
    return true;
  }, [step, lesson, appointments, scheduledStarts]);

  const packageWindowEnd = useMemo(() => {
    const first = scheduledStarts["primary-0"];
    return first ? addMonthsToKey(dayKeyOf(first), 6) : undefined;
  }, [scheduledStarts]);

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
    if (!details.dateOfBirth || details.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      setDetailsError("Please enter a valid date of birth.");
      return false;
    }
    if (!details.gender) {
      setDetailsError("Please select a gender option.");
      return false;
    }
    if (details.licenseNumber.trim().length < 4 || details.licenseNumber.trim().length > 32) {
      setDetailsError("Please enter a valid driver’s licence number.");
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
    if (!lesson || !appointments.every((item) => Boolean(scheduledStarts[item.key]))) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          packageSchedules,
          addOnPackages,
          studentName: details.studentName.trim(),
          email: details.email.trim(),
          phone: details.phone.trim(),
          dateOfBirth: details.dateOfBirth,
          gender: details.gender,
          licenseNumber: details.licenseNumber.trim(),
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
        if (response.status === 409 || message === "We couldn’t reserve this booking. Please review your selected times and try again.") {
          setSubmitError("Your saved lesson times could not be reserved. Please select the currently available times again.");
          setStepIndex(STEPS.findIndex((item) => item.key === "when"));
          setAppointmentIndex(0);
          setScheduledStarts({});
          setAvailabilityRevision((revision) => revision + 1);
        } else {
          setSubmitError(message);
        }
        return;
      }

      try {
        window.sessionStorage.removeItem(BOOKING_DRAFT_KEY);
      } catch {
        // Successful booking should not depend on browser storage access.
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
        sessions: appointments.map((item) => ({ lessonName: item.lessonName, startsAt: scheduledStarts[item.key] })).filter((item): item is { lessonName: string; startsAt: string } => Boolean(item.startsAt)),
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
          Your booking is reserved
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
        <section className="mt-4 rounded-[17px] border border-line bg-white p-4 sm:p-5">
          <h3 className="text-sm font-extrabold text-ink">Scheduled lessons</h3>
          <ol className="mt-2 grid gap-2 text-[13px]">
            {success.sessions.map((session, index) => <li key={`${session.startsAt}-${index}`} className="flex flex-wrap justify-between gap-3 border-b border-line pb-2 last:border-0"><span className="text-soft">{session.lessonName}</span><strong className="text-ink">{new Date(session.startsAt).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific</strong></li>)}
          </ol>
        </section>
        {success.addOns.length > 0 && (
          <section className="mt-4 rounded-[17px] border border-line bg-white p-4 sm:p-5">
            <h3 className="text-sm font-extrabold text-ink">Checkout review</h3>
            <ul className="mt-2 grid gap-2 text-[13px]">
              <li className="flex justify-between gap-3"><span className="text-soft">{success.lessonName}</span><strong className="text-ink">${success.priceCad.toFixed(2)} CAD</strong></li>
              {success.addOns.map((item) => <li key={item.id} className="flex justify-between gap-3"><span className="text-soft">{item.name} × {item.quantity} · {item.sessionCount * item.quantity} lessons</span><strong className="text-ink">${(item.priceCad * item.quantity).toFixed(2)} CAD</strong></li>)}
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
          <LessonStep lessons={lessons} selectedId={lesson?.id ?? null} onSelect={(selected) => {
            setLesson(selected);
            setPackageQuantities({});
            setScheduledStarts({});
            setAppointmentIndex(0);
          }} />
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
                      const scheduledElsewhere = lesson.sessionCount + addOnPackages
                        .filter((selection) => selection.lessonId !== item.id)
                        .reduce((sum, selection) => sum + (lessons.find((candidate) => candidate.id === selection.lessonId)?.sessionCount ?? 0) * selection.quantity, 0);
                      const maxQuantity = Math.max(0, Math.floor((200 - scheduledElsewhere) / item.sessionCount));
                      return (
                       <label key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                         <span className="grid gap-0.5">
                           <span className="text-[13px] font-extrabold text-ink">{item.name}{item.id === lesson.id ? " · same package as selected" : ""}</span>
                            <span className="text-[12px] text-soft">{item.sessionCount} lessons per package · {item.durationMin} min each · {formatLessonPrice(item.priceCad)}</span>
                         </span>
                         <span className="ml-auto grid shrink-0 gap-1 text-right">
                           <span className="text-[10px] font-bold uppercase tracking-wide text-soft">Packages</span>
                            <input type="number" min="0" max={maxQuantity} step="1" inputMode="numeric" aria-label={`Additional ${item.name} packages`} value={quantity || ""} placeholder="0" onChange={(event) => {
                              const next = Number(event.target.value);
                              setPackageQuantities((current) => ({ ...current, [item.id]: Number.isSafeInteger(next) && next > 0 ? Math.min(next, maxQuantity) : 0 }));
                              setAppointmentIndex(0);
                            }} className="h-10 w-20 rounded-lg border border-line px-2 text-center text-sm font-bold text-ink" />
                         </span>
                       </label>
                     );
                   })}
                    <p className="text-[11px] leading-relaxed text-soft">Choose a quantity for any package, including the selected package. You will choose a date and time for every lesson in each selected package, then pay for everything together.</p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {step === "when" && lesson && (
        <div>
          {submitError && <p role="alert" className="mb-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">{submitError}</p>}
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-ink">Choose a date and time for each lesson</p>
              <p className="mt-1 text-xs font-semibold text-soft">Select a lesson below to choose or change its time.</p>
            </div>
            <p className="rounded-full bg-[#eaf5df] px-3 py-1.5 text-xs font-extrabold text-[#31543a]" aria-live="polite">
              {scheduledCount} of {appointments.length} scheduled
            </p>
          </div>
          {packageWindowEnd && <p className="mb-4 rounded-xl bg-[#fbfcf9] px-3 py-2 text-xs text-soft">Schedule all lessons by {packageWindowEnd} (six months from your first lesson).</p>}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
            <section id="appointment-calendar" className="min-w-0 rounded-2xl border border-line bg-white p-3 sm:p-4">
              {appointments[activeAppointmentIndex] && <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-soft">Currently selecting · Lesson {activeAppointmentIndex + 1} of {appointments.length}</p>
                    <p className="mt-1 text-sm font-extrabold text-ink">{appointments[activeAppointmentIndex].groupLabel}</p>
                    <p className="text-xs text-soft">{appointments[activeAppointmentIndex].label}</p>
                  </div>
                  {scheduledStarts[appointments[activeAppointmentIndex].key] && <span className="rounded-full bg-[#eaf5df] px-2.5 py-1 text-[10px] font-extrabold text-[#31543a]">Time selected</span>}
                </div>
                <DateTimeStep
                  key={`${appointments[activeAppointmentIndex].key}-${availabilityRevision}`}
                  lessonId={appointments[activeAppointmentIndex].lessonId}
                  selectedStart={scheduledStarts[appointments[activeAppointmentIndex].key] ?? null}
                  maxDate={activeAppointmentIndex === 0
                    ? addMonthsToKey(dayKeyOf(new Date().toISOString()), 6)
                    : packageWindowEnd}
                  minDate={activeAppointmentIndex > 0 && scheduledStarts["primary-0"] ? dayKeyOf(scheduledStarts["primary-0"]) : undefined}
                  horizonDays={370}
                  blockedStartsAt={appointments.filter((_, index) => index !== activeAppointmentIndex).filter((item) => scheduledStarts[item.key]).map((item) => ({
                    startsAt: scheduledStarts[item.key],
                    durationMin: lessons.find((candidate) => candidate.id === item.lessonId)?.durationMin ?? lesson.durationMin,
                  }))}
                  onUnavailableSelection={() => {
                    const selected = appointments[activeAppointmentIndex];
                    if (!selected) return;
                    setScheduledStarts((current) => {
                      if (!current[selected.key]) return current;
                      const next = { ...current };
                      delete next[selected.key];
                      return next;
                    });
                    setSubmitError("A saved lesson time is no longer available. Please choose a current slot.");
                  }}
                  onSelect={(slot) => {
                    setSubmitError(null);
                    const selected = appointments[activeAppointmentIndex];
                    setScheduledStarts((current) => ({ ...current, [selected.key]: slot }));
                    const nextUnscheduled = appointments.findIndex((item, index) => index > activeAppointmentIndex && item.key !== selected.key && !scheduledStarts[item.key]);
                    const firstUnscheduled = appointments.findIndex((item) => item.key !== selected.key && !scheduledStarts[item.key]);
                    const nextIndex = nextUnscheduled >= 0 ? nextUnscheduled : firstUnscheduled;
                    if (nextIndex >= 0) setAppointmentIndex(nextIndex);
                  }}
                />
              </>}
            </section>

            <section aria-label="Lessons to schedule" className="min-w-0">
              <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-soft">Your lesson times</h3>
              <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
                {appointmentGroups.map((group) => (
                  <div key={group.key} className="rounded-xl border border-line bg-[#fbfcf9] p-2.5">
                    <p className="mb-2 px-1 text-[11px] font-extrabold text-ink">{group.label}</p>
                    <div className="grid gap-1.5">
                      {group.items.map((item) => {
                        const index = appointments.findIndex((appointment) => appointment.key === item.key);
                        const startsAt = scheduledStarts[item.key];
                        const active = index === activeAppointmentIndex;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setAppointmentIndex(index)}
                            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${active ? "border-[#557c3d] bg-[#eaf5df]" : "border-transparent bg-white hover:border-line"}`}
                          >
                            <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${startsAt ? "bg-[#31543a] text-white" : "bg-mist text-soft"}`}>{startsAt ? "✓" : index + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-bold text-ink">{item.label}</span>
                              <span className="block truncate text-[10px] text-soft">{startsAt ? `${new Date(startsAt).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific` : "Choose a time"}</span>
                            </span>
                            {active && <span className="shrink-0 text-[10px] font-extrabold text-[#31543a]">Selected</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {step === "preview" && lesson && (
        <section aria-labelledby="booking-preview-title">
          <div className="mb-5">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-[#648552]">Review before continuing</p>
            <h2 id="booking-preview-title" className="mt-1 font-display text-2xl font-extrabold text-ink">Your booking preview</h2>
            <p className="mt-1 text-sm text-soft">Check your packages, lesson times, and estimated total. You can still change your selection.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
            <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
              <h3 className="text-sm font-extrabold text-ink">Scheduled lessons ({appointments.length})</h3>
              <ol className="mt-3 grid max-h-[30rem] gap-2 overflow-y-auto pr-1">
                {appointments.map((item, index) => (
                  <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fbfcf9] px-3 py-2.5 text-[12px]">
                    <span className="font-semibold text-ink">{index + 1}. {item.groupLabel} · {item.label}</span>
                    <strong className="text-[#31543a]">{new Date(scheduledStarts[item.key]).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific</strong>
                  </li>
                ))}
              </ol>
              {packageWindowEnd && <p className="mt-3 text-[11px] leading-relaxed text-soft">All lessons must be scheduled by {packageWindowEnd} (six months from your first lesson).</p>}
            </section>

            <section className="h-fit rounded-2xl border border-line bg-[#fbfcf9] p-4 sm:p-5">
              <h3 className="text-sm font-extrabold text-ink">Package summary</h3>
              <ul className="mt-3 grid gap-3 text-[13px]">
                <li className="flex justify-between gap-3"><span className="text-soft">{lesson.name} × 1</span><strong className="text-ink">{formatLessonPrice(lesson.priceCad)}</strong></li>
                {addOnPackages.map(({ lessonId: id, quantity }) => {
                  const extra = lessons.find((item) => item.id === id);
                  return extra ? <li key={id} className="flex justify-between gap-3"><span className="text-soft">{extra.name} × {quantity}</span><strong className="text-ink">{formatLessonPrice(extra.priceCad * quantity)}</strong></li> : null;
                })}
                <li className="flex justify-between gap-3 border-t border-line pt-3 font-extrabold"><span>Estimated subtotal</span><span>{formatLessonPrice(lesson.priceCad + addOnPackages.reduce((sum, selection) => sum + (lessons.find((item) => item.id === selection.lessonId)?.priceCad ?? 0) * selection.quantity, 0))}</span></li>
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-soft">Applicable taxes are calculated and shown before payment. No payment is taken on this preview page.</p>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
            <Button variant="outline" onClick={() => setStepIndex(STEPS.findIndex((item) => item.key === "when"))}>Change date / time</Button>
            <Button variant="outline" onClick={() => setStepIndex(STEPS.findIndex((item) => item.key === "lesson"))}>Change package</Button>
            <Button onClick={() => setStepIndex(STEPS.findIndex((item) => item.key === "details"))} className="ml-auto">Continue to your details <span aria-hidden="true">→</span></Button>
          </div>
        </section>
      )}

      {step === "details" && (
        <form onSubmit={handleDetailsSubmit} noValidate>
          <DetailsStep value={details} onChange={setDetails} error={detailsError} />
          <Button type="submit" className="mt-6 w-full sm:w-auto">
            Review booking
          </Button>
        </form>
      )}

      {step === "review" && lesson && appointments.every((item) => Boolean(scheduledStarts[item.key])) && (
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
              <h3 className="text-sm font-extrabold text-ink">Additional lesson packages</h3>
              <ul className="mt-2 grid gap-2 text-[13px]">
                {addOnPackages.map(({ lessonId: id, quantity }) => {
                  const extra = lessons.find((item) => item.id === id);
                  return extra ? <li key={id} className="flex justify-between gap-3"><span className="text-soft">{extra.name} × {quantity} · {extra.sessionCount * quantity} lessons</span><strong className="text-ink">{formatLessonPrice(extra.priceCad * quantity)}</strong></li> : null;
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
              <div><dt className="text-soft">Date of birth</dt><dd className="font-bold text-ink">{details.dateOfBirth}</dd></div>
              <div><dt className="text-soft">Gender</dt><dd className="font-bold text-ink">{details.gender.replaceAll("_", " ")}</dd></div>
              <div><dt className="text-soft">Driver’s licence number</dt><dd className="font-bold text-ink">{details.licenseNumber}</dd></div>
              {details.notes && <div className="sm:col-span-2"><dt className="text-soft">Notes</dt><dd className="font-bold text-ink">{details.notes}</dd></div>}
            </dl>
          </section>
          <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-soft">
            <p>
              Confirming reserves all selected lesson times. Your confirmation email links to My Booking,
              where you must verify your email before viewing or changing bookings.
            </p>
            {appointments.length > 1 ? (
              <div>
                <p>All {appointments.length} lesson times are included and must be within six months of the first lesson:</p>
                <ol className="mt-2 list-inside list-decimal">
                  {appointments.map((item) => <li key={item.key}>{item.lessonName} — {new Date(scheduledStarts[item.key]).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} Pacific</li>)}
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
            <Button variant="outline" onClick={() => { setSubmitError(null); setStepIndex(1); setAppointmentIndex(0); }} disabled={submitting}>
              Change date / time
            </Button>
          </div>
        </div>
      )}

      {(step === "lesson" || step === "when") && (
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button variant="ghost" onClick={() => step === "when" && appointmentIndex > 0 ? setAppointmentIndex((index) => index - 1) : goBack()} disabled={stepIndex === 0}>
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
