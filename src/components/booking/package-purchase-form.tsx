"use client";

import { useState } from "react";
import type { Lesson } from "@/lib/data/lessons";
import { formatLessonPrice } from "@/lib/data/lessons";

export function PackagePurchaseForm({ lesson }: { lesson: Lesson }) {
  const [studentName, setStudentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/package-purchases/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, studentName, email, phone, notes, website, consent }),
      });
      const result = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !result.ok || !result.url) {
        setError(result.error ?? "Could not start checkout. Please try again.");
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("Network error. No credits were granted; please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5 rounded-[25px] border border-line bg-white p-5 shadow-[0_22px_60px_rgba(12,42,48,0.08)] sm:p-8">
      <div className="rounded-[16px] bg-[#eaf5df] p-4">
        <p className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-[#426a2c]">Your package</p>
        <h2 className="mt-1 font-display text-xl font-extrabold text-ink">{lesson.name}</h2>
        <p className="mt-1 text-sm text-soft">{lesson.sessionCount} credit{lesson.sessionCount === 1 ? "" : "s"} · {lesson.durationMin} minutes each</p>
        <p className="mt-2 font-display text-2xl font-extrabold text-ink">{formatLessonPrice(lesson.priceCad)}</p>
        <p className="mt-2 text-xs leading-relaxed text-[#52615d]">Schedule sessions individually in My Booking within six calendar months after payment is confirmed. Booking is subject to instructor availability.</p>
      </div>

      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-[12px] font-bold text-ink">
          Full name *
          <input required autoComplete="name" maxLength={80} value={studentName} onChange={(event) => setStudentName(event.target.value)} className="h-11 rounded-[12px] border border-[#d7dfdc] px-3 text-sm outline-none focus:border-[#83b657]" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-[12px] font-bold text-ink">
            Email *
            <input required type="email" autoComplete="email" maxLength={160} value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-[12px] border border-[#d7dfdc] px-3 text-sm outline-none focus:border-[#83b657]" />
          </label>
          <label className="grid gap-1.5 text-[12px] font-bold text-ink">
            Phone *
            <input required type="tel" autoComplete="tel" minLength={7} maxLength={25} value={phone} onChange={(event) => setPhone(event.target.value)} className="h-11 rounded-[12px] border border-[#d7dfdc] px-3 text-sm outline-none focus:border-[#83b657]" />
          </label>
        </div>
        <label className="grid gap-1.5 text-[12px] font-bold text-ink">
          Note for the instructor (optional)
          <textarea rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} className="rounded-[12px] border border-[#d7dfdc] px-3 py-2 text-sm outline-none focus:border-[#83b657]" />
        </label>
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        </div>
        <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-soft">
          <input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#6a9d42]" />
          <span>I agree that my details may be used to manage this purchase and lesson scheduling, as described in the <a href="/privacy" className="font-bold text-gold-deep underline">Privacy Policy</a>.</span>
        </label>
        {error && <p role="alert" className="rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">{error}</p>}
        <button type="submit" disabled={pending} className="btn-gold inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[13px] font-extrabold disabled:opacity-60">
          {pending ? "Opening secure checkout…" : "Continue to secure checkout"}
        </button>
      </form>
    </div>
  );
}
