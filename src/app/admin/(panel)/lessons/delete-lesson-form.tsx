"use client";

import { useActionState, useState } from "react";
import { deleteLessonAction, type LessonFormState } from "./actions";

export function DeleteLessonForm({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<LessonFormState, FormData>(deleteLessonAction, null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-[8px] border border-[#e7b8b3] bg-white px-3.5 text-[12.5px] font-extrabold text-[#a43232] transition-colors hover:bg-[#fff0ed]"
      >
        Delete
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pending) setOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby={`delete-lesson-${id}`} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id={`delete-lesson-${id}`} className="font-display text-xl font-extrabold text-ink">Delete this lesson?</h2>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              <strong className="text-ink">{name}</strong> will be removed from the public catalogue and future booking choices. Existing bookings and their history will not be deleted.
            </p>
            <form action={formAction} className="mt-5 grid gap-3">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="name" value={name} />
              <label className="grid gap-1.5 text-[12px] font-bold text-ink">
                Type <span className="select-all">{name}</span> to confirm
                <input name="confirmation" required autoComplete="off" className="h-10 rounded-lg border border-line px-3 text-sm" />
              </label>
              <label className="grid gap-1.5 text-[12px] font-bold text-ink">
                Admin password
                <input name="password" type="password" required minLength={6} maxLength={128} autoComplete="current-password" className="h-10 rounded-lg border border-line px-3 text-sm" />
              </label>
              {state && (
                <p role={state.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold ${state.ok ? "bg-[#e6f6ec] text-[#1f7a45]" : "bg-[#fff0ed] text-[#a43232]"}`}>
                  {state.message}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" disabled={pending} onClick={() => setOpen(false)} className="h-10 rounded-lg border border-line px-4 text-[12.5px] font-bold text-ink disabled:opacity-60">Cancel</button>
                <button type="submit" disabled={pending || state?.ok} className="h-10 rounded-lg bg-[#a43232] px-4 text-[12.5px] font-extrabold text-white disabled:opacity-60">{pending ? "Deleting…" : "Confirm delete"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
