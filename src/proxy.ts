import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

function supabaseOrigin(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.protocol !== "https:" && url.hostname !== "localhost") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function withCsp(response: NextResponse, policy: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/**
 * Next.js 16 proxy (formerly middleware): refreshes the Supabase session
 * cookie and optimistically guards /admin/*. Real authorisation (role check)
 * happens in requireAdmin() on the server.
 */
export async function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com`,
    "script-src-attr 'none'",
    `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin()} https://api.stripe.com https://checkout.stripe.com`,
    "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "upgrade-insecure-requests",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  let supabaseResponse = withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  const { pathname, search } = request.nextUrl;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLoginPath = pathname === "/admin/login";
  const isPasswordResetPath = pathname === "/admin/reset-password";
  if (!isAdminPath) return supabaseResponse;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured — keep visitors on the login screen, which explains setup.
    return isLoginPath || isPasswordResetPath
      ? supabaseResponse
      : withCsp(NextResponse.redirect(new URL("/admin/login", request.url)), csp);
  }

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
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const updatedHeaders = new Headers(request.headers);
        updatedHeaders.set("x-nonce", nonce);
        updatedHeaders.set("Content-Security-Policy", csp);
        supabaseResponse = withCsp(NextResponse.next({ request: { headers: updatedHeaders } }), csp);
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Validates the JWT against Supabase; returns user or null (never throws).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isLoginPath && !isPasswordResetPath) {
    const loginUrl = new URL("/admin/login", request.url);
    const next = `${pathname}${search}`;
    if (next !== "/admin") loginUrl.searchParams.set("next", next);
    return withCsp(NextResponse.redirect(loginUrl), csp);
  }

  if (user && isLoginPath) {
    return withCsp(NextResponse.redirect(new URL("/admin", request.url)), csp);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
