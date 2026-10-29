"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { revealOnScroll } from "@/lib/motion";

const faqs = [
  {
    question: "How many driving lessons does a new (novice) driver need?",
    answer:
      "We recommend at least 8 lessons of 1.5 hours each (12 hours of professional training) for beginner drivers to learn the rules, techniques and manoeuvres needed for the ICBC road test. Lessons alone are not enough: students should also practise regularly in their own or a family member's vehicle with a qualified supervising driver to build confidence, consistency and safe habits.",
  },
  {
    question: "How many lessons do experienced drivers from other countries need?",
    answer:
      "For newcomers to British Columbia with previous driving experience, we recommend at least 5 lessons of 1.5 hours each (7.5 hours of professional training). Lessons focus on BC traffic rules, safe driving habits and the manoeuvres assessed in the ICBC road test. We also recommend practising near your ICBC road test centre so you become familiar with local intersections, roads and traffic conditions.",
  },
  {
    question: "How many hours should a new driver practise before the ICBC road test?",
    answer:
      "ICBC recommends at least 60 hours of supervised practice for new drivers. Practise regularly between professional lessons in different traffic conditions, intersections and road environments. Before your test, we recommend extra practice around the ICBC test location to learn the surrounding roads and intersections.",
  },
  {
    question: "Who may need additional driving lessons?",
    answer:
      "The right number of lessons depends on each student's confidence, experience and chance to practise. Extra lessons can help anxious or nervous drivers build comfort, and students without access to their own or a family vehicle maintain their skills. Everyone learns at a different pace; our goal is to help you become a safe, confident, independent driver, not simply prepare you to pass a test.",
  },
  {
    question: "Can I reschedule or cancel my lesson?",
    answer:
      "Yes. Use the private Manage My Booking link in your confirmation email, or choose My Booking on this site and verify your email with a one-time code. Please make changes at least 48 hours before the lesson to avoid a cancellation fee. Requests within 48 hours may incur a fee under the school policy.",
  },
  {
    question: "Is payment required online?",
    answer:
      "Not in this release. Payment is arranged with the school directly (e-transfer, card or in person) after your booking is confirmed.",
  },
  {
    question: "Do I need an account to book or manage a lesson?",
    answer:
      "No account is needed. Book with your email address and use the private link in your confirmation, or verify that email with a one-time code from the My Booking page.",
  },
] as const;

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-12 bg-[#f7f7f3] py-20 sm:py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={revealOnScroll}
            transition={{ duration: 0.55 }}
          >
            <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
              <span aria-hidden="true" className="h-0.5 w-5 bg-[#8ac155]" />
              Helpful answers
            </p>
            <h2 className="mt-4 font-display text-[clamp(32px,4vw,53px)] font-extrabold leading-[1.1] tracking-[-0.055em] text-ink">
              A few things
              <br />
              you may wonder.
            </h2>
            <p className="mt-5 max-w-[370px] text-[14px] leading-[1.85] text-soft">
              Clear answers for starting lessons, getting ready for an ICBC
              road test, and managing your booking yourself.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={revealOnScroll}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="border-t border-[#dce3df]"
          >
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              return (
                <div key={faq.question} className="border-b border-[#dce3df]">
                  <h3>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`faq-panel-${index}`}
                      onClick={() => setOpenIndex(isOpen ? null : index)}
                      className="flex w-full items-center justify-between gap-4 py-5 text-left text-[15px] font-extrabold text-ink transition-colors hover:text-[#426a2c] sm:text-[16px]"
                    >
                      {faq.question}
                      <span
                        aria-hidden="true"
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg transition-all duration-300 ${
                          isOpen
                            ? "rotate-45 bg-[#e5f6d6] text-[#426a2c]"
                            : "text-[#6b8b52]"
                        }`}
                      >
                        +
                      </span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        id={`faq-panel-${index}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <p className="pb-5 pr-9 text-[13.5px] leading-[1.8] text-[#66747c] sm:text-[14px]">
                          {faq.answer}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
