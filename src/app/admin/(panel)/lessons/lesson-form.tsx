"use client";

import { useActionState, useEffect } from "react";
import { saveLessonAction, type LessonFormState } from "./actions";
import type { Lesson } from "@/lib/data/lessons";

const inputClass =
  "h-9 w-full rounded-[8px] border border-[#dce0e4] bg-white px-2.5 text-[13px] text-ink outline-none focus:border-gold";
const labelClass = "grid gap-1.5 text-[12px] font-bold text-[#282c33]";

interface LessonFormProps {
  lesson: Lesson;
  onDone: () => void;
}

export function LessonForm({ lesson, onDone }: LessonFormProps) {
  const [state, formAction, pending] = useActionState<LessonFormState, FormData>(
    saveLessonAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="id" value={lesson.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Name
          <input
            type="text"
            name="name"
            defaultValue={lesson.name}
            required
            maxLength={80}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Duration (minutes)
          <input
            type="number"
            name="durationMin"
            defaultValue={lesson.durationMin}
            min={15}
            max={600}
            step={15}
            required
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Price (CAD)
          <input
            type="number"
            name="priceCad"
            defaultValue={lesson.priceCad}
            min={0}
            max={10000}
            step={1}
            required
            className={inputClass}
          />
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          Short description
          <input
            type="text"
            name="description"
            defaultValue={lesson.description}
            required
            maxLength={200}
            className={inputClass}
          />
        </label>

        <label className={`${labelClass} sm:col-span-2`}>
          Features (one per line)
          <textarea
            name="features"
            defaultValue={lesson.features.join("\n")}
            rows={4}
            required
            className="w-full rounded-[8px] border border-[#dce0e4] bg-white px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-gold"
          />
        </label>

        <label className={labelClass}>
          Category
          <select
            name="category"
            defaultValue={lesson.category}
            className={inputClass}
          >
            <option value="package">Package</option>
            <option value="module">Module</option>
          </select>
        </label>

        <label className="flex items-center gap-2 self-end pb-2 text-[12.5px] font-bold text-[#4b525e]">
          <input
            type="checkbox"
            name="popular"
            defaultChecked={Boolean(lesson.popular)}
            className="h-4 w-4 accent-[#e3a721]"
          />
          Highlight as popular
        </label>
      </div>

      {state && (
        <p
          className={`rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${
            state.ok
              ? "bg-[#e6f6ec] text-[#1f7a45]"
              : "bg-[#fdecec] text-[#a43232]"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-gold inline-flex h-10 items-center rounded-[10px] px-5 text-[13px] font-extrabold disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save lesson"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-4 text-[13px] font-extrabold text-ink transition-colors hover:border-gold hover:text-gold-deep"
        >
          Close
        </button>
      </div>
    </form>
  );
}
