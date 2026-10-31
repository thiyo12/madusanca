"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientIp, isRateLimitedShared } from "@/lib/server/rate-limit";
import { logSafeError } from "@/lib/server/safe-log";

export interface LoginState {
  error: string | null;
  message?: string | null;
}

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters.").max(128),
  next: z.string().max(300).optional().or(z.literal("")),
}).strict();

const resetSchema = z.object({
  email: z.email("Enter a valid email address."),
}).strict();

function publicSiteUrl(): string {
  // Never let a stale production environment value send recovery links to localhost.
  if (process.env.NODE_ENV === "production") return "https://wisdomdrivingacademy.com";
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return configured || "http://localhost:3000";
}

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
  if (await isRateLimitedShared(`admin-login:${parsed.data.email.trim().toLowerCase()}`, 10, 15 * 60 * 1000)) {
    return { error: "Too many sign-in attempts. Please wait and try again." };
  }
  // A shared IP limit adds friction against password spraying. Only trust the
  // proxy-provided address when deployment explicitly enables that setting.
  const requestHeaders = await headers();
  const ip = clientIp(new Request("http://localhost", { headers: requestHeaders }));
  if (ip !== "unknown" && await isRateLimitedShared(`admin-login-ip:${ip}`, 30, 15 * 60 * 1000)) {
    return { error: "Too many sign-in attempts from this network. Please wait and try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
  });

  if (error) {
    logSafeError("[admin/login] Supabase sign-in failed", error);
    return { error: "Invalid email or password." };
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
  if (await isRateLimitedShared(`admin-reset:${parsed.data.email.trim().toLowerCase()}`, 3, 60 * 60 * 1000)) {
    return { error: null, message: "If an account exists for that email, Supabase will send a password-reset link. Check your inbox and spam folder." };
  }
  const requestHeaders = await headers();
  const ip = clientIp(new Request("http://localhost", { headers: requestHeaders }));
  if (ip !== "unknown" && await isRateLimitedShared(`admin-reset-ip:${ip}`, 10, 60 * 60 * 1000)) {
    return { error: null, message: "If an account exists for that email, Supabase will send a password-reset link. Check your inbox and spam folder." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const redirectTo = new URL("/auth/confirm?next=/admin/reset-password", publicSiteUrl()).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
    if (error) {
      const code = (error as { code?: string }).code;
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
      logSafeError("[admin/password-reset] Supabase request failed", error);
      return { error: "Supabase could not send the reset link. Check the Auth email provider and redirect URL settings, then try again." };
    }
  } catch (error) {
    logSafeError("[admin/password-reset] request failed", error);
    return { error: "Password recovery is temporarily unavailable. Please try again later." };
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
  }).strict().safeParse({
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
    logSafeError("[admin/password-reset] password update failed", error);
    return { error: "Could not update the password. Request a new reset link and try again." };
  }

  const { error: revokeError } = await supabase.auth.signOut({ scope: "global" });
  if (revokeError) {
    logSafeError("[admin/password-reset] global session revocation failed", revokeError);
    await supabase.auth.signOut({ scope: "local" });
    return {
      error: "Your password was updated, but Supabase could not confirm sign-out on other devices. Contact the site administrator to revoke existing sessions.",
    };
  }

  redirect("/admin/login?passwordUpdated=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
