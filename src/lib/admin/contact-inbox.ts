import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ContactData } from "@/lib/validation/contact";

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;
let cached: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Contact inbox requires configured Supabase storage.");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export async function saveContactMessage(input: ContactData): Promise<void> {
  const { error } = await db().from("contact_messages").insert({
    name: input.name,
    email: input.email,
    phone: input.phone,
    subject: input.subject ?? "",
    message: input.message,
  });
  if (error) throw error;
}

export async function listContactMessages(page: number, unreadOnly = false): Promise<{
  messages: ContactMessage[];
  total: number;
  unreadCount: number;
  pageCount: number;
}> {
  const client = db();
  const safePage = Math.max(1, Math.floor(page));
  let query = client.from("contact_messages").select("*", { count: "exact" });
  if (unreadOnly) query = query.eq("is_read", false);
  const [{ data, count, error }, { count: unreadCount, error: unreadError }] = await Promise.all([
    query
      .order("created_at", { ascending: false })
      .range((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE - 1),
    client.from("contact_messages").select("id", { count: "exact", head: true }).eq("is_read", false),
  ]);
  if (error) throw error;
  if (unreadError) throw unreadError;
  const total = count ?? 0;
  return {
    messages: (data ?? []) as ContactMessage[],
    total,
    unreadCount: unreadCount ?? 0,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function setContactMessageRead(id: string, isRead: boolean): Promise<boolean> {
  const { data, error } = await db()
    .from("contact_messages")
    .update({ is_read: isRead, read_at: isRead ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
