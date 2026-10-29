"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { login, type LoginState } from "@/app/admin/login/actions";

export interface LoginFormProps {
  next?: string;
  denied?: boolean;
}

const inputClasses =
  "w-full rounded-[10px] border border-[#2a2e33] bg-[#191c1f] px-3.5 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#6b727c] focus:border-gold focus:ring-[3px] focus:ring-gold/25";

const labelClasses = "grid gap-1.5 text-[12px] font-bold text-[#c3c8cf]";

export function LoginForm({ next, denied }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {
    error: null,
  });

  return (
    <form action={formAction} noValidate className="grid gap-4">
      {denied && (
        <p role="alert" className="rounded-lg bg-[#3a2420] px-4 py-3 text-[13px] font-semibold text-[#ff9d8a]">
          That account doesn&rsquo;t have admin access.
        </p>
      )}

      <label className={labelClasses}>
        Email address
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
          className={inputClasses}
        />
      </label>
      <label className={labelClasses}>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className={inputClasses}
        />
      </label>

      <input type="hidden" name="next" value={next ?? ""} />

      {state.error && (
        <p role="alert" className="rounded-lg bg-[#3a2420] px-4 py-3 text-[13px] font-semibold text-[#ff9d8a]">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
