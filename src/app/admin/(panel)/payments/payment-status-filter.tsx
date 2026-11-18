"use client";

const PAYMENT_STATUSES = [
  { value: "", label: "All" },
  { value: "due", label: "Due" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
];

export function PaymentStatusFilter({ defaultValue }: { defaultValue: string }) {
  return (
    <select
      name="payment"
      defaultValue={defaultValue}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      aria-label="Filter bookings by payment status"
      className="h-10 rounded-[10px] border border-[#dce0e4] bg-white px-3 text-sm text-ink outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/25"
    >
      {PAYMENT_STATUSES.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}
