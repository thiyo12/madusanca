"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Lesson } from "@/lib/data/lessons";
import { createCalendarBookingAction, type QuickBookingState } from "./actions";

interface QuickBookDialogProps {
  dayKey: string;
  startMin: number;
  lessons: Lesson[];
  onClose: () => void;
}

const fieldClass =
  "h-10 w-full rounded-[9px] border border-[#dce0e4] bg-white px-3 text-[13px] text-ink outline-none focus:border-gold";
const labelClass = "grid gap-1.5 text-[12px] font-bold text-[#282c33]";

export function QuickBookDialog({ dayKey, startMin, lessons, onClose }: QuickBookDialogProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<QuickBookingState, FormData>(
    createCalendarBookingAction,
    { ok: false, message: "" },
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const time = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-8 sm:py-14"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-book-title"
        className="w-full max-w-xl rounded-[18px] bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-gold-deep">Calendar booking</p>
            <h2 id="quick-book-title" className="mt-1.5 font-display text-xl font-extrabold text-ink">
              Book {dayKey} at {time} Pacific
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close booking form"
            className="grid h-8 w-8 place-items-center rounded-full bg-mist text-soft hover:bg-line hover:text-ink disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {state.ok ? (
          <div className="mt-5">
            <p className="rounded-[10px] bg-[#e6f6ec] px-4 py-3 text-[13px] font-semibold text-[#1f7a45]">
              {state.message}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-gold mt-4 inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-extrabold"
            >
              Done
            </button>
          </div>
        ) : (
          <form action={formAction} className="mt-5 grid gap-3.5">
            <input type="hidden" name="dayKey" value={dayKey} />
            <input type="hidden" name="startMin" value={startMin} />
            <label className={labelClass}>
              Lesson package
              <select name="lessonId" required className={fieldClass} defaultValue={lessons[0]?.id ?? ""}>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.name} · {lesson.durationMin} min
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className={labelClass}>
                Student full legal name
                <input name="studentName" required minLength={2} maxLength={80} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Email
                <input name="email" type="email" required maxLength={160} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Phone
                <input name="phone" type="tel" required minLength={7} maxLength={25} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Notes (optional)
                <input name="notes" maxLength={220} className={fieldClass} />
              </label>
            </div>
            <p className="text-[12px] leading-relaxed text-soft">
              The server rechecks hours and conflicts before booking. A confirmation and private manage link are emailed to the student.
            </p>
            {state.message && (
              <p role="alert" className="rounded-[10px] bg-[#fff0ed] px-3 py-2.5 text-[12.5px] font-semibold text-[#bc4633]">
                {state.message}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={pending || lessons.length === 0}
                className="btn-gold inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-extrabold disabled:opacity-60"
              >
                {pending ? "Booking…" : "Create booking"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[13px] font-extrabold text-ink hover:border-gold disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
