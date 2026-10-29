import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { LoginForm } from "@/app/admin/login/login-form";
import { ResetRequestForm } from "@/app/admin/login/reset-form";

export const metadata: Metadata = {
  title: "Admin Sign In — Wisdom Driving Academy",
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const denied = params.denied === "1";
  const passwordUpdated = params.passwordUpdated === "1";
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-5 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-[20px] border border-[#2a2e33] bg-[#15181b] p-6 sm:p-8">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold">
            Wisdom Driving Academy
          </p>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white">
            Admin sign in
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#9aa1a9]">
            Owner and instructor access — bookings, calendar and availability.
          </p>

          {passwordUpdated && (
            <p role="status" className="mt-5 rounded-lg bg-[#1f3527] px-4 py-3 text-[13px] font-semibold text-[#bce8c4]">
              Password updated. Sign in with your new password.
            </p>
          )}
          <div className="mt-6">
            {configured ? (
              <LoginForm next={next} denied={denied} />
            ) : (
              <p className="rounded-lg bg-[#3a2420] px-4 py-3 text-[13px] font-semibold text-[#ff9d8a]">
                Supabase isn&rsquo;t configured yet. Add
                NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
                .env.local, then restart the dev server.
              </p>
            )}
          </div>
          {configured && (
            <details className="mt-5 border-t border-[#2a2e33] pt-4">
              <summary className="cursor-pointer text-[12.5px] font-bold text-[#c3c8cf] hover:text-white">
                Forgot password?
              </summary>
              <div className="mt-4">
                <ResetRequestForm />
              </div>
            </details>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] text-[#6b727c]">
          <Link
            href="/"
            className="underline-offset-4 hover:text-[#c3c8cf] hover:underline"
          >
            ← Back to website
          </Link>
        </p>
      </div>
    </main>
  );
}
