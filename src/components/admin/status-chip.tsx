import type { BookingStatus } from "@/lib/booking/types";

export interface StatusChipProps {
  status: BookingStatus;
  className?: string;
}

const TONES: Record<BookingStatus, string> = {
  pending_payment: "bg-[#fff4d9] text-[#8a6514]",
  confirmed: "bg-[#e6f6ec] text-[#1f7a45]",
  rescheduled: "bg-gold-soft text-gold-deep",
  cancelled: "bg-[#fdecea] text-[#bc4633]",
  completed: "bg-[#e8eef7] text-[#2f5590]",
};

const LABELS: Record<BookingStatus, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function StatusChip({ status, className = "" }: StatusChipProps) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide ${TONES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  );
}
