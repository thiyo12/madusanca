"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
  message?: string | null;
}

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters.").max(128),
  next: z.string().max(300).optional().or(z.literal("")),
});

const resetSchema = z.object({
  email: z.email("Enter a valid email address."),
});

function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/admin") && !next.startsWith("//")) return next;
  return "/admin";
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "email_not_confirmed" || error.message.includes("Email not confirmed")) {
      return {
        error: "Confirm your email first — open the confirmation link Supabase sent you, then sign in again.",
      };
    }
    console.error("[admin/login] Supabase sign-in failed", {
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      message: error.message,
    });
    return { error: "Invalid email or password. Confirm this user exists in the linked Supabase project's Authentication → Users, and use its current password." };
  }

  redirect(safeNext(parsed.data.next));
}

export async function requestPasswordReset(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = resetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter your account email." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const redirectTo = new URL("/auth/confirm?next=/admin/reset-password", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").toString();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
    if (error) {
      const code = (error as { code?: string }).code;
      const status = (error as { status?: number }).status;
      if (
        code === "over_email_send_rate_limit" ||
        code === "email_rate_limit_exceeded" ||
        error.message.toLowerCase().includes("rate limit") ||
        error.message.toLowerCase().includes("email rate limit")
      ) {
        return {
          error: "Supabase temporarily rate-limited password recovery emails. Wait for its cooldown, then request one more link. Avoid repeated requests; the latest sent link is the one to use.",
        };
      }
      console.error("[admin/password-reset] Supabase request failed", {
        status,
        code,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("[admin/password-reset] request failed", error);
  }

  // Avoid revealing whether an email belongs to an account.
  return { error: null, message: "If an account exists for that email, Supabase will send a password-reset link. Check your inbox and spam folder." };
}

export async function updatePassword(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = z.object({
    password: z.string().min(8, "Use at least 8 characters.").max(128),
    confirmPassword: z.string().min(8).max(128),
  }).safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid password." };
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "This reset link is invalid or expired. Request a new password-reset email." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[admin/password-reset] password update failed", {
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return { error: "Could not update the password. Request a new reset link and try again." };
  }

  redirect("/admin/login?passwordUpdated=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
