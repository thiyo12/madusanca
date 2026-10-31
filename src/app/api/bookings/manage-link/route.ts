import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/booking/store";
import { hashToken } from "@/lib/booking/tokens";
import { MANAGE_COOKIE_NAME, manageCookieOptions } from "@/lib/booking/manage-cookie";
import { siteBase } from "@/lib/booking/urls";

export const dynamic = "force-dynamic";

function redirectToManage(): NextResponse {
  const response = NextResponse.redirect(new URL("/booking/manage", siteBase()));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return redirectToManage();
  }
  try {
    const found = await getStore().getBookingByToken(hashToken(token));
    if (!found) return redirectToManage();
    const response = redirectToManage();
    response.cookies.set(MANAGE_COOKIE_NAME, token, manageCookieOptions);
    return response;
  } catch {
    return redirectToManage();
  }
}
