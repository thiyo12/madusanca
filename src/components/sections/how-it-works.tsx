"use client";

import { motion } from "framer-motion";
import { staggerContainer, fadeUp, revealOnScroll } from "@/lib/motion";

const steps = [
  {
    num: "01",
    title: "Choose a lesson",
    text: "Pick the lesson that fits your learning goals.",
  },
  {
    num: "02",
    title: "Select your time",
    text: "Find a date and an open slot that works for you.",
  },
  {
    num: "03",
    title: "Enter your details",
    text: "Provide your full legal name, licence class, contact details and pickup address.",
  },
  {
    num: "04",
    title: "Get confirmed",
    text: "Receive confirmation and a link to manage your booking.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-10 bg-[#0b1b29] py-20 text-white sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={revealOnScroll}
          transition={{ duration: 0.55 }}
          className="mb-11 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"
        >
          <div>
            <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#c2ee84]">
              <span aria-hidden="true" className="h-0.5 w-5 bg-[#c2ee84]" />
              Simple from the first step
            </p>
            <h2 className="mt-4 max-w-[680px] font-display text-[clamp(32px,4.2vw,53px)] font-extrabold leading-[1.1] tracking-[-0.055em]">
              Getting started should feel effortless.
            </h2>
          </div>
          <p className="max-w-[345px] text-[14px] leading-[1.8] text-[#b9cbd0]">
            A clear booking journey with real available times, a confirmation
            email and a private way to manage your lesson.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={revealOnScroll}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {steps.map((step) => (
            <motion.article
              key={step.num}
              variants={fadeUp}
              className="flex min-h-[220px] flex-col rounded-[23px] border border-white/10 bg-[#18303d] p-7 text-white transition-colors duration-300 hover:bg-[#1d3947]"
            >
              <span className="mb-9 text-[12px] font-extrabold tracking-[0.12em] text-[#c2ee84]">
                {step.num} — {step.title.toUpperCase()}
              </span>
              <h3 className="font-display text-[21px] font-extrabold leading-tight">{step.title}</h3>
              <p className="mt-3 text-[13px] leading-[1.7] text-[#bdccce]">
                {step.text}
              </p>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
