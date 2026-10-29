import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware): refreshes the Supabase session
 * cookie and optimistically guards /admin/*. Real authorisation (role check)
 * happens in requireAdmin() on the server.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;
  const isLoginPath = pathname === "/admin/login";
  const isPasswordResetPath = pathname === "/admin/reset-password";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured — keep visitors on the login screen, which explains setup.
    return isLoginPath || isPasswordResetPath
      ? supabaseResponse
      : NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
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
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPath) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/admin/:path*"],
};
