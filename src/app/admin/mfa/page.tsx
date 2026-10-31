import { requireAdmin } from "@/lib/auth/require-admin";
import { AdminMfaSetup } from "@/components/admin/admin-mfa-setup";

interface AdminMfaPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminMfaPage({ searchParams }: AdminMfaPageProps) {
  await requireAdmin("/admin/mfa");
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : "/admin";
  const next = rawNext.startsWith("/admin/") && !rawNext.startsWith("/admin/mfa")
    ? rawNext
    : "/admin";
  return <AdminMfaSetup next={next} />;
}
