import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { AdminNav } from "./admin-nav";
import { headers } from "next/headers";
import { isLocalAdminBypassEnabled } from "@/lib/auth/local-admin-bypass";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin("/admin");
  const host = (await headers()).get("host") ?? "";
  const localBypass = isLocalAdminBypassEnabled(process.env.NODE_ENV, host);

  return (
    <div className="min-h-screen bg-mist lg:flex">
      <AdminNav email={admin.email} localBypass={localBypass} />
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
    </div>
  );
}
