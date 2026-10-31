import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { siteBase } from "@/lib/booking/urls";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const origin = process.env.NODE_ENV === "production"
    ? new URL(siteBase()).origin
    : request.nextUrl.origin;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next");
  let next = "/admin/reset-password";
  if (nextParam?.startsWith("/")) {
    try {
      const candidate = new URL(nextParam, origin);
      if (candidate.origin === origin) next = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    } catch {
      // Keep the safe reset-password destination for malformed return paths.
    }
  }

  if ((!tokenHash || type !== "recovery") && !code) {
    return NextResponse.redirect(new URL("/admin/reset-password?error=invalid_link", origin));
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(new URL("/admin/reset-password?error=not_configured", origin));
  }

  const response = NextResponse.redirect(new URL(next, origin));
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "recovery" });
  if (error) {
    return NextResponse.redirect(new URL("/admin/reset-password?error=invalid_link", origin));
  }

  return response;
}
