"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CheckoutResponse {
  ok?: boolean;
  url?: string;
  paid?: boolean;
  error?: string;
}

export function StripeCheckoutButton({ manageToken }: { manageToken?: string } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manageToken ? { manageToken } : {}),
      });
      const result = (await response.json()) as CheckoutResponse;
      if (result.paid) {
        router.refresh();
        return;
      }
      if (!response.ok || !result.ok || !result.url) {
        setError(result.error ?? "Could not open secure checkout. Please try again.");
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("Network error. Your booking is still saved. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-2">
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#c2ee84] px-6 text-[13px] font-extrabold text-[#10212e] transition-colors hover:bg-[#d4f4a8] disabled:opacity-60"
      >
        {pending ? "Opening secure checkout…" : "Pay securely with Stripe"}
        {!pending && <span aria-hidden="true">↗</span>}
      </button>
      {error && (
        <p role="alert" className="max-w-xl rounded-[10px] bg-[#fff0ed] px-3 py-2 text-[12.5px] font-semibold text-[#9d382a]">
          {error}
        </p>
      )}
    </div>
  );
}
