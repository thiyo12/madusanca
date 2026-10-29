"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { revealOnScroll } from "@/lib/motion";

export function CtaBanner() {
  return (
    <section className="bg-white py-20 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={revealOnScroll}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-start justify-between gap-8 rounded-[28px] bg-[#c7f08d] px-7 py-12 text-ink sm:px-11 sm:py-14 lg:flex-row lg:items-center lg:px-16 lg:py-16"
        >
          <div>
            <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#31543a]">
              <span aria-hidden="true" className="h-0.5 w-5 bg-[#578b36]" />
              Your next move
            </p>
            <h2 className="mt-3 max-w-[670px] font-display text-[clamp(32px,4vw,50px)] font-extrabold leading-[1.1] tracking-[-0.055em]">
              Ready to feel at home behind the wheel?
            </h2>
          </div>
          <Button
            href="/booking"
            variant="dark"
            size="lg"
            className="shrink-0 px-9 text-base font-extrabold"
          >
            Book a lesson <span aria-hidden="true">↗</span>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
