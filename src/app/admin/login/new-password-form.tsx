"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updatePassword, type LoginState } from "@/app/admin/login/actions";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(updatePassword, {
    error: null,
  });

  return (
    <form action={action} className="grid gap-4">
      <label className="grid gap-1.5 text-[12px] font-bold text-[#c3c8cf]">
        New password
        <input
          type="password"
          name="password"
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          className="w-full rounded-[10px] border border-[#2a2e33] bg-[#191c1f] px-3.5 py-3 text-sm text-white outline-none placeholder:text-[#6b727c] focus:border-gold focus:ring-[3px] focus:ring-gold/25"
        />
      </label>
      <label className="grid gap-1.5 text-[12px] font-bold text-[#c3c8cf]">
        Confirm new password
        <input
          type="password"
          name="confirmPassword"
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          className="w-full rounded-[10px] border border-[#2a2e33] bg-[#191c1f] px-3.5 py-3 text-sm text-white outline-none placeholder:text-[#6b727c] focus:border-gold focus:ring-[3px] focus:ring-gold/25"
        />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#3a2420] px-4 py-3 text-[13px] font-semibold text-[#ff9d8a]">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Updating password…" : "Set new password"}
      </Button>
    </form>
  );
}
