import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminIdentity {
  userId: string;
  email: string;
}

function allowlisted(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Authorisation check: the signed-in user must either be listed in
 * ADMIN_EMAILS or hold profiles.role = 'admin' (read via the service key).
 */
async function isAdmin(userId: string, email: string): Promise<boolean> {
  if (allowlisted(email)) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return false;

  try {
    const response = await fetch(
      `${url}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ role: string }>;
    return rows[0]?.role === "admin";
  } catch {
    return false;
  }
}

/**
 * Gate for all /admin pages (layouts, route handlers, actions).
 * Redirects anonymous visitors to the login screen; signs out non-admins.
 */
export async function requireAdmin(nextPath = "/admin"): Promise<AdminIdentity> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !user.id) {
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (!(await isAdmin(user.id, user.email))) {
    await supabase.auth.signOut();
    redirect("/admin/login?denied=1");
  }

  return { userId: user.id, email: user.email };
}
