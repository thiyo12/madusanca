"use client";

import { useState } from "react";
import { preserveManageSessionForStripeReturn } from "@/lib/booking/manage-session-client";

export function StripePackagePurchaseButton({ packages, disabled = false }: {
  packages: Array<{ lessonId: string; quantity: number; startsAt: string[] }>;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/package-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packages }),
      });
      const result = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !result.ok || !result.url) {
        setError(result.error ?? "Could not open secure checkout. Please try again.");
        return;
      }
      preserveManageSessionForStripeReturn();
      window.location.assign(result.url);
    } catch {
      setError("Network error. Your current booking is unchanged; please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-2">
      <button type="button" onClick={() => void startCheckout()} disabled={disabled || pending}
        className="inline-flex h-10 items-center justify-center rounded-full bg-[#c2ee84] px-4 text-[12px] font-extrabold text-[#10212e] hover:bg-[#d4f4a8] disabled:opacity-60">
        {pending ? "Opening checkout…" : "Add package & pay"}
      </button>
      {error && <p role="alert" className="max-w-xl rounded-[10px] bg-[#fff0ed] px-3 py-2 text-[12px] font-semibold text-[#9d382a]">{error}</p>}
    </div>
  );
}
