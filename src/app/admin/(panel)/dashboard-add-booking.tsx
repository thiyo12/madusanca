"use client";

import { useState } from "react";
import type { Lesson } from "@/lib/data/lessons";
import { BookingWizard } from "@/components/booking/booking-wizard";

export function DashboardAddBooking({ lessons }: { lessons: Lesson[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-gold inline-flex h-10 items-center rounded-[10px] px-4 text-[13px] font-extrabold">
        + Add booking
      </button>
      {open && (
        <div role="presentation" className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/55 px-3 py-4 sm:px-6 sm:py-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="dashboard-booking-dialog-title" className="w-full max-w-6xl rounded-[20px] bg-[#f7f7f3] p-3 shadow-2xl sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold-deep">Admin booking</p><h2 id="dashboard-booking-dialog-title" className="text-[15px] font-extrabold text-ink">Use the website booking steps</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close booking form" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-lg font-bold text-soft hover:bg-line hover:text-ink">×</button>
            </div>
            <BookingWizard lessons={lessons} adminMode onAdminDone={() => setOpen(false)} />
          </section>
        </div>
      )}
    </>
  );
}
