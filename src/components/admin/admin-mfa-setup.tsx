"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function AdminMfaSetup({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedFactor, setVerifiedFactor] = useState(false);

  function supabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("Authentication is not configured.");
    return createBrowserClient(url, anonKey, {
      cookieOptions: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    });
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = supabase();
        const [{ data: factors, error: factorsError }, { data: assurance, error: assuranceError }] = await Promise.all([
          client.auth.mfa.listFactors(),
          client.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
        if (factorsError || assuranceError) throw new Error("Could not verify admin MFA status.");
        if (!active) return;
        if (assurance.currentLevel === "aal2") {
          router.replace(next);
          router.refresh();
          return;
        }
        const verified = factors.totp.find((factor) => factor.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          setVerifiedFactor(true);
        } else {
          // Remove abandoned unverified setup factors before starting a fresh enrollment.
          for (const factor of factors.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
            const { error: removeError } = await client.auth.mfa.unenroll({ factorId: factor.id });
            if (removeError) throw new Error("Could not clear an incomplete MFA setup. Contact the site administrator.");
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load MFA setup.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [next, router]);

  async function beginEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: enrollError } = await supabase().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Wisdom Driving Academy admin",
        issuer: "Wisdom Driving Academy",
      });
      if (enrollError) throw new Error("Could not start authenticator setup. Try again.");
      setFactorId(data.id);
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setVerifiedFactor(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("Enter the current six-digit authenticator code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase().auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw new Error("That code could not be verified. Check the authenticator and try again.");
      const { data, error: assuranceError } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || data.currentLevel !== "aal2") throw new Error("MFA verification did not reach the required security level.");
      router.replace(next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the authenticator code.");
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  async function signOut() {
    await supabase().auth.signOut({ scope: "local" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-line bg-white p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#426a2c]">Admin security</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#111315]">Authenticator verification</h1>
        <p className="mt-3 text-sm leading-6 text-[#555b61]">
          Admin access requires a time-based one-time password (TOTP) authenticator.
          Keep your authenticator and recovery method private.
        </p>

        {loading ? <p className="mt-6 text-sm">Checking your security status…</p> : null}

        {!loading && !verifiedFactor && !enrollment ? (
          <button type="button" disabled={busy} onClick={() => void beginEnrollment()}
            className="mt-6 rounded-xl bg-[#1f7a45] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? "Starting setup…" : "Set up an authenticator"}
          </button>
        ) : null}

        {enrollment ? (
          <div className="mt-6 rounded-xl border border-line p-4">
            <p className="text-sm font-bold">1. Scan this code with your authenticator app</p>
            {/* Supabase returns SVG markup; encode it as a data URL and never inject it as HTML. */}
            <Image unoptimized width={192} height={192} className="mx-auto my-4 h-48 w-48" alt="Authenticator enrollment QR code"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrCode)}`} />
            <p className="text-xs text-[#555b61]">If scanning is unavailable, enter this secret manually:</p>
            <code className="mt-2 block break-all rounded bg-[#f5f7f5] p-3 text-sm">{enrollment.secret}</code>
          </div>
        ) : null}

        {!loading && factorId ? (
          <form onSubmit={(event) => void verifyCode(event)} className="mt-6 space-y-3">
            <label htmlFor="mfa-code" className="block text-sm font-bold">
              {verifiedFactor ? "Enter your authenticator code" : "2. Confirm setup with a code"}
            </label>
            <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
              maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg tracking-[0.3em]" />
            <button type="submit" disabled={busy || code.length !== 6}
              className="w-full rounded-xl bg-[#1f7a45] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        ) : null}

        {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        <button type="button" onClick={() => void signOut()} className="mt-6 text-sm font-semibold underline">
          Sign out
        </button>
      </section>
    </main>
  );
}
