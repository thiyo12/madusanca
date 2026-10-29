import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { NewPasswordForm } from "@/app/admin/login/new-password-form";

interface ResetPasswordPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "Reset Admin Password — Wisdom Driving Academy",
  robots: { index: false, follow: false },
};

export default async function AdminResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-5 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex justify-center"><Logo /></div>
        <div className="rounded-[20px] border border-[#2a2e33] bg-[#15181b] p-6 sm:p-8">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold">Wisdom Driving Academy</p>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Choose a new password</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#9aa1a9]">Use at least 8 characters. This form works only after opening a valid password-reset link.</p>
          {error && (
            <p role="alert" className="mt-5 rounded-lg bg-[#3a2420] px-4 py-3 text-[13px] font-semibold text-[#ff9d8a]">
              The reset link is invalid, expired, or not configured. Request a new link from admin sign in and open it on this device.
            </p>
          )}
          <div className="mt-6"><NewPasswordForm /></div>
        </div>
        <p className="mt-6 text-center text-[12px] text-[#6b727c]">
          <Link href="/admin/login" className="underline-offset-4 hover:text-[#c3c8cf] hover:underline">← Back to admin sign in</Link>
        </p>
      </div>
    </main>
  );
}
