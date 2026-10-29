export type LessonIconName =
  | "clock"
  | "timer"
  | "road-test"
  | "highway"
  | "moon"
  | "snow";

export interface LessonIconProps {
  name: LessonIconName;
  className?: string;
}

const paths: Record<LessonIconName, React.ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5M9 2.5h6M19 6l1.5-1.5" />
    </>
  ),
  "road-test": (
    <>
      <path d="M4 21l3-14h10l3 14" />
      <path d="M12 4v3M12 10v3M12 16v3" strokeDasharray="0 0" />
    </>
  ),
  highway: (
    <>
      <path d="M5 21L8 3M19 21l-3-18" />
      <path d="M12 4v3M12 10v3M12 16v3" />
    </>
  ),
  moon: (
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  ),
  snow: (
    <>
      <path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17" />
      <path d="M12 6l-2-2M12 6l2-2M12 18l-2 2M12 18l2 2" />
    </>
  ),
};

/** Line icon used on lesson cards. Stroke inherits currentColor. */
export function LessonIcon({ name, className = "h-6 w-6" }: LessonIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
