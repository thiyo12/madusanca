"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type FormStatus = "idle" | "submitting" | "success" | "error";

const inputClasses =
  "w-full rounded-[13px] border border-[#d7dfdc] bg-white px-3.5 py-3 text-sm text-ink outline-none transition-colors placeholder:text-[#91a0a4] focus:border-[#83b657] focus:ring-[3px] focus:ring-[#c2ee84]/35";

const labelClasses = "grid gap-1.5 text-[12px] font-bold text-ink";

export function ContactForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      subject: String(data.get("subject") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
      consent: data.get("consent") === "on",
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        setStatus("error");
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="rounded-2xl border border-[#bce9c8] bg-[#f2fff4] p-7"
      >
        <h3 className="font-display text-lg font-extrabold text-ink">
          ✓ Message sent
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[#4b525e]">
          Thanks for reaching out — we&rsquo;ll get back to you within one to
          two business days.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-extrabold text-gold-deep underline-offset-4 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClasses}>
          Full name *
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            placeholder="Your full name"
            className={inputClasses}
          />
        </label>
        <label className={labelClasses}>
          Email address *
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={160}
            placeholder="you@example.com"
            className={inputClasses}
          />
        </label>
        <label className={labelClasses}>
          Phone number (optional)
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            maxLength={25}
            placeholder="(604) 555-0199"
            className={inputClasses}
          />
        </label>
        <label className={labelClasses}>
          Subject (optional)
          <input
            name="subject"
            maxLength={120}
            placeholder="e.g. Lesson availability"
            className={inputClasses}
          />
        </label>
      </div>

      <label className={`${labelClasses} mt-4`}>
        Message *
        <textarea
          name="message"
          required
          rows={5}
          maxLength={2000}
          placeholder="How can we help?"
          className={`${inputClasses} resize-y`}
        />
      </label>

      {/* Honeypot — hidden from real users */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[#616872]">
        <input
          type="checkbox"
          name="consent"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#6a9d42]"
        />
        <span>
          I agree that my details may be used to respond to this message, as
          described in the{" "}
          <a href="/privacy" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
            Privacy Policy
          </a>
          . *
        </span>
      </label>

      {status === "error" && error && (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={status === "submitting"}
        className="mt-6 w-full sm:w-auto"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
