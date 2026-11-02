import { NextResponse } from "next/server";
import { siteBase } from "@/lib/booking/urls";

export const dynamic = "force-dynamic";

function redirectToManage(): NextResponse {
  const response = NextResponse.redirect(new URL("/booking/manage", siteBase()));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(): Promise<NextResponse> {
  // Old confirmation emails may still contain a tokenized legacy URL. Ignore
  // it: direct links must never authenticate a My Booking session.
  return redirectToManage();
}
