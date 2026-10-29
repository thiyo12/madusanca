"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { LessonGrid } from "@/components/ui/lesson-grid";
import type { Lesson } from "@/lib/data/lessons";
import { revealOnScroll } from "@/lib/motion";

interface LessonsPreviewProps {
  lessons: Lesson[];
}

export function LessonsPreview({ lessons }: LessonsPreviewProps) {
  return (
    <section id="lessons" className="scroll-mt-10 bg-[#f7f7f3] py-20 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={revealOnScroll}
          transition={{ duration: 0.55 }}
          className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"
        >
          <div>
            <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
              <span aria-hidden="true" className="h-0.5 w-5 bg-[#8ac155]" />
              Our learning paths
            </p>
            <h2 className="mt-4 max-w-2xl font-display text-[clamp(32px,4.2vw,53px)] font-extrabold leading-[1.1] tracking-[-0.055em] text-ink">
              Find the right lesson.<br />Feel the difference.
            </h2>
          </div>
          <p className="max-w-[345px] text-[14px] leading-[1.8] text-soft">
            One-on-one instruction, pickup and drop-off, and clear CAD prices
            plus GST. Choose the package that fits your goals.
          </p>
        </motion.div>

        <LessonGrid lessons={lessons} ariaLabel="Lesson packages" />
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] leading-relaxed text-soft">
            Pack bookings reserve the first session; remaining lessons are coordinated with the school.
          </p>
          <Button href="/lessons" variant="outline" size="sm">
            All lesson details <span aria-hidden="true">↗</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
