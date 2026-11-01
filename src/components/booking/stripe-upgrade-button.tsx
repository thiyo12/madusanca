"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StripeUpgradeButton({ targetLessonId, amountCad, sessions, disabled = false }: { targetLessonId: string; amountCad: number; sessions: string[]; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upgrade() {
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/stripe/upgrade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetLessonId, sessions }) });
      const result = await response.json() as { ok?: boolean; url?: string; paid?: boolean; error?: string };
      if (result.paid) { router.refresh(); return; }
      if (!response.ok || !result.ok || !result.url) { setError(result.error ?? "Could not open secure checkout."); return; }
      window.location.assign(result.url);
    } catch { setError("Network error. Your booking is unchanged; please try again."); }
    finally { setPending(false); }
  }
  return <div className="grid justify-items-start gap-2">
    <button type="button" onClick={() => void upgrade()} disabled={pending || disabled} className="inline-flex h-10 items-center justify-center rounded-full border border-line px-4 text-[12px] font-extrabold text-ink hover:bg-mist disabled:opacity-60">
      {pending ? "Opening checkout…" : `Upgrade · pay $${amountCad.toLocaleString("en-CA")} CAD + GST`}
    </button>
    {error && <p role="alert" className="max-w-xl rounded-[10px] bg-[#fff0ed] px-3 py-2 text-[12.5px] font-semibold text-[#9d382a]">{error}</p>}
  </div>;
}
