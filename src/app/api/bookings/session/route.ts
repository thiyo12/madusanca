import { NextResponse } from "next/server";
import { MANAGE_COOKIE_NAME } from "@/lib/booking/manage-cookie";
import { hasTrustedRequestOrigin } from "@/lib/server/request-origin";

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedRequestOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(MANAGE_COOKIE_NAME);
  return response;
}
