import { formatSlotFull, maskEmail } from "@/lib/booking/format";
import { formatLessonPrice } from "@/lib/data/lessons";

export interface BookingSummaryData {
  lessonName: string;
  durationMin: number;
  priceCad: number;
  startsAt: string;
  studentName: string;
  email: string;
}

export interface BookingSummaryProps {
  data: BookingSummaryData;
  reference?: string;
  className?: string;
}

const rowClasses = "flex items-start justify-between gap-4 py-2.5 text-[13.5px]";
const labelClasses = "shrink-0 text-soft";
const valueClasses = "text-right font-bold text-ink";

export function BookingSummary({ data, reference, className = "" }: BookingSummaryProps) {
  return (
    <dl className={`rounded-[17px] border border-line bg-[#f7f7f3] p-4 sm:p-5 ${className}`}>
      {reference && (
        <div className={rowClasses}>
          <dt className={labelClasses}>Reference</dt>
          <dd className={`${valueClasses} tracking-wide`}>{reference}</dd>
        </div>
      )}
      <div className={rowClasses}>
        <dt className={labelClasses}>Lesson</dt>
        <dd className={valueClasses}>{data.lessonName}</dd>
      </div>
      <div className={rowClasses}>
        <dt className={labelClasses}>When</dt>
        <dd className={valueClasses}>
          {formatSlotFull(data.startsAt)}
          <span className="block text-[11.5px] font-semibold text-soft">
            {data.durationMin} minutes · Pacific Time
          </span>
        </dd>
      </div>
      <div className={rowClasses}>
        <dt className={labelClasses}>Student</dt>
        <dd className={valueClasses}>{data.studentName}</dd>
      </div>
      <div className={rowClasses}>
        <dt className={labelClasses}>Contact</dt>
        <dd className={valueClasses}>{maskEmail(data.email)}</dd>
      </div>
      <div className={`${rowClasses} border-t border-line pt-3.5`}>
        <dt className="shrink-0 text-[13px] font-extrabold text-ink">Package price (pay at school)</dt>
        <dd className="text-right font-display text-[19px] font-extrabold text-ink">
          {formatLessonPrice(data.priceCad)}
        </dd>
      </div>
    </dl>
  );
}
