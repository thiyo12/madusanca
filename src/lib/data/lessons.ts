import type { LessonIconName } from "@/components/ui/lesson-icon";

export interface Lesson {
  id: string;
  name: string;
  durationMin: number;
  /** Number of separately scheduled sessions included in this package. */
  sessionCount: number;
  priceCad: number;
  description: string;
  features: string[];
  icon: LessonIconName;
  popular?: boolean;
  category: "package" | "module";
}

/** Single source of truth for packages; prices are CAD before GST. */
export const lessons: Lesson[] = [
  {
    id: "90-minute-lesson",
    name: "90-Minute Lesson",
    durationMin: 90,
    sessionCount: 1,
    priceCad: 90,
    description: "Private, one-on-one driving instruction with pickup and drop-off included.",
    features: [
      "One-on-one instruction",
      "Pickup & drop-off included",
      "90 minutes per lesson",
    ],
    icon: "timer",
    category: "package",
  },
  {
    id: "five-lesson-pack",
    name: "5-Lesson Pack",
    durationMin: 90,
    sessionCount: 5,
    priceCad: 450,
    description: "Five private 90-minute lessons, with pickup and drop-off included.",
    features: [
      "Five 90-minute lessons",
      "One-on-one instruction",
      "Pickup & drop-off included",
    ],
    icon: "clock",
    category: "package",
  },
  {
    id: "eight-lesson-pack",
    name: "8-Lesson Pack",
    durationMin: 90,
    sessionCount: 8,
    priceCad: 720,
    description: "Eight private 90-minute lessons, with pickup and drop-off included.",
    features: [
      "Eight 90-minute lessons",
      "One-on-one instruction",
      "Pickup & drop-off included",
    ],
    icon: "timer",
    popular: true,
    category: "package",
  },
  {
    id: "road-test-package",
    name: "Road Test Package",
    durationMin: 45,
    sessionCount: 1,
    priceCad: 150,
    description: "A 45-minute mock test, car rental, and pickup one hour before your road test.",
    features: [
      "45-minute mock test",
      "Car rental for the road test",
      "Pickup 1 hour before the test",
    ],
    icon: "road-test",
    category: "package",
  },
];

export function formatPrice(priceCad: number): string {
  return `$${priceCad.toLocaleString("en-CA")} CAD`;
}

export function formatLessonPrice(priceCad: number): string {
  return `${formatPrice(priceCad)} + GST`;
}
