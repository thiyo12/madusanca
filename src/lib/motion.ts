import type { Variants } from "framer-motion";

/** Staggered container for grouped reveals */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.05,
    },
  },
};

/** Single element rising into view */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 0.61, 0.36, 1] },
  },
};

/** Viewport trigger: reveal once when scrolled into view */
export const revealOnScroll = {
  once: true,
  margin: "-70px",
} as const;
