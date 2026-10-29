"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUp } from "@/lib/motion";
import { formatLessonPrice } from "@/lib/data/lessons";

export interface LessonCardProps {
  id: string;
  index: number;
  name: string;
  durationMin: number;
  priceCad: number;
  description: string;
  features: string[];
  popular?: boolean;
  className?: string;
}

export function LessonCard({
  id,
  index,
  name,
  durationMin,
  priceCad,
  description,
  features,
  popular = false,
  className = "",
}: LessonCardProps) {
  return (
    <motion.article
      variants={fadeUp}
      className={`group flex h-full flex-col rounded-[25px] border p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1.5 hover:shadow-[0_28px_65px_rgba(12,42,48,0.13)] sm:p-7 ${
        popular
          ? "border-[#102a28] bg-[#102a28] text-white shadow-[0_22px_55px_rgba(8,40,36,0.22)]"
          : "border-line bg-white text-ink hover:border-[#bfd7ad]"
      } ${className}`}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className={`text-[10px] font-extrabold uppercase tracking-[0.13em] ${popular ? "text-[#b8d2c6]" : "text-[#87989e]"}`}>
          {String(index + 1).padStart(2, "0")} / Driving lessons
        </span>
        {popular && (
          <span className="shrink-0 rounded-full bg-[#c2ee84] px-2.5 py-1 text-[10px] font-extrabold text-[#18342b]">
            Popular path
          </span>
        )}
      </div>
      <h3 className="mt-5 font-display text-[23px] font-extrabold leading-[1.16] tracking-[-0.05em] sm:text-[26px]">
        {name}
      </h3>
      <p className={`mt-3 min-h-12 text-[13px] leading-[1.7] ${popular ? "text-[#c1d5d0]" : "text-soft"}`}>
        {description}
      </p>
      <div className={`my-6 h-px ${popular ? "bg-white/20" : "bg-line"}`} />
      <p className={`text-[11px] font-semibold ${popular ? "text-[#bdd0cb]" : "text-soft"}`}>
        Package price · {durationMin} min {id === "road-test-package" ? "mock test" : "per booked lesson"}
      </p>
      <p className="mt-1 font-display text-[25px] font-extrabold tracking-[-0.05em] sm:text-[28px]">
        {formatLessonPrice(priceCad)}
      </p>
      <ul className="mb-7 mt-5 grid gap-0">
        {features.map((feature) => (
          <li key={feature} className={`flex items-start gap-3 border-b py-2.5 text-[12px] leading-[1.5] ${popular ? "border-white/15 text-[#e5efeb]" : "border-[#ecf0ee] text-[#40525e]"}`}>
            <span aria-hidden="true" className={`font-extrabold ${popular ? "text-[#c2ee84]" : "text-[#6a9d42]"}`}>✓</span>
            {feature}
          </li>
        ))}
      </ul>
      <Link
        href={`/booking?lesson=${encodeURIComponent(id)}`}
        className={`mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-[13px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
          popular
            ? "bg-[#c2ee84] text-[#102a28] hover:bg-[#d7f5ad]"
            : "border border-[#cbd4d6] text-ink hover:border-[#7baa54] hover:bg-[#eaf5df]"
        }`}
      >
        Select &amp; book <span aria-hidden="true">↗</span>
      </Link>
    </motion.article>
  );
}
