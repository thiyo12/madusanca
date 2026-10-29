// Supabase client configuration
// Uses environment variables from .env.local
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set

// Type helpers for session management
export type SupabaseUser = {
  id: string;
  email?: string;
  appMetadata?: unknown;
  userMetadata?: unknown;
  aud?: string;
  role?: string;
  emailConfirmedAt?: string;
  phoneConfirmedAt?: string;
  lastSignInAt?: string;
  updatedAt?: string;
  createdAt?: string;
};

export type SupabaseSession = {
  user: SupabaseUser | null;
  session: string | null;
  expiresAt: string | null;
};

// Get Supabase configuration from environment variables
export const getSupabaseConfig = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.warn(
      "Supabase environment variables are not fully configured. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    );
    return null;
  }

  return { url, anonKey };
};