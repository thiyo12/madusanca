"use client";

import { formatLessonPrice, type Lesson } from "@/lib/data/lessons";
import type { LessonIconName } from "@/components/ui/lesson-icon";
import { LessonIcon } from "@/components/ui/lesson-icon";

export interface LessonStepProps {
  lessons: Lesson[];
  selectedId: string | null;
  onSelect: (lesson: Lesson) => void;
  onBack?: () => void;
}

const iconTone: Record<LessonIconName, string> = {
  clock: "text-gold-deep",
  timer: "text-gold-deep",
  "road-test": "text-gold-deep",
  highway: "text-gold-deep",
  moon: "text-gold-deep",
  snow: "text-gold-deep",
};

export function LessonStep({ lessons, selectedId, onSelect }: LessonStepProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {lessons.map((lesson) => {
        const active = lesson.id === selectedId;
        return (
          <button
            key={lesson.id}
            type="button"
            onClick={() => onSelect(lesson)}
            aria-pressed={active}
            className={`rounded-[18px] border p-4 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:p-5 ${
               active
                 ? "border-[#8dbd62] bg-[#eaf5df]"
                 : "border-line bg-white hover:border-[#8dbd62] hover:bg-[#f8fcf4]"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${active ? "bg-white" : "bg-gold-soft"} ${iconTone[lesson.icon]}`}
              >
                <LessonIcon name={lesson.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-extrabold text-ink">{lesson.name}</span>
                  {lesson.popular && (
                     <span className="rounded-full bg-[#102a28] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[#c2ee84]">
                      MOST POPULAR
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-soft">
                  {lesson.durationMin} minutes per booking · {formatLessonPrice(lesson.priceCad)}
                </p>
              </div>
            </div>
          </button>
        );
      })}
      <p className="text-[12px] leading-relaxed text-soft sm:col-span-2">
        No payment is taken online — payment is arranged directly with the school. Pack bookings reserve the first lesson; remaining sessions are arranged with the school.
      </p>
    </div>
  );
}
