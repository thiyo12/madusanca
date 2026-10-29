import type { Metadata } from "next";
import { getStore } from "@/lib/booking/store";
import { LessonsEditor } from "./lessons-editor";

export const metadata: Metadata = {
  title: "Lessons — Wisdom Driving Academy Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminLessonsPage() {
  const lessons = await getStore().getLessons();

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold-deep">
        Admin
      </p>
      <h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight text-ink sm:text-3xl">
        Lessons
      </h1>

      <div className="mt-5 rounded-[14px] border border-[#f6e4b9] bg-gold-soft px-4 py-3 text-[12.5px] leading-relaxed text-[#604717]">
        This catalogue feeds the homepage, the lessons page and the booking
        wizard — hit <strong>Save lesson</strong> and the new name, price,
        duration and features are live on the site immediately. Public package
        prices display with GST added. Changing a price never affects bookings
        that already exist.
      </div>

      <LessonsEditor lessons={lessons} />
    </div>
  );
}
