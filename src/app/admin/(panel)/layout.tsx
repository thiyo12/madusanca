import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { AdminNav } from "./admin-nav";

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

  return (
    <div className="min-h-screen bg-mist lg:flex">
      <AdminNav email={admin.email} />
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
    </div>
  );
}
