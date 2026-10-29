import type { BookingStore } from "@/lib/booking/types";
import { fileStore } from "@/lib/booking/file-store";
import { supabaseStore } from "@/lib/booking/supabase-store";

let store: BookingStore | null = null;

/**
 * Server-only storage selection:
 * - Supabase when configured (production / preview environments)
 * - Local JSON file store for development without Supabase keys
 */
export function getStore(): BookingStore {
  if (store) return store;
  const hasSupabase = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (hasSupabase) {
    store = supabaseStore;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Bookings require Supabase. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  } else {
    store = fileStore;
  }
  return store;
}
