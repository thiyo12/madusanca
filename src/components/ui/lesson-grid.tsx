"use client";

import { motion } from "framer-motion";
import { LessonCard } from "@/components/ui/lesson-card";
import { staggerContainer, revealOnScroll } from "@/lib/motion";
import type { Lesson } from "@/lib/data/lessons";

export interface LessonGridProps {
  lessons: Lesson[];
  ariaLabel?: string;
}

/**
 * Lesson cards as a swipeable scroll-snap carousel on mobile
 * (cards peek off-screen to signal swiping), switching to a
 * 2-column grid on tablet and 4-column grid on wide desktops.
 */
export function LessonGrid({ lessons, ariaLabel = "Lesson options" }: LessonGridProps) {
  return (
    <motion.div
      role="region"
      aria-label={ariaLabel}
      variants={staggerContainer}
      initial="hidden"
      whileInView="show"
      viewport={revealOnScroll}
      className="no-scrollbar -mx-5 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-4"
    >
      {lessons.map((lesson, index) => (
        <LessonCard
          key={lesson.id}
          {...lesson}
          index={index}
          className="w-[85%] shrink-0 snap-start sm:w-[62%] md:w-auto"
        />
      ))}
    </motion.div>
  );
}
