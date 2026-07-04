// Supabase client. Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// from the build-time environment. If the env vars are missing, the
// integration is disabled and the app falls back to localStorage via
// `src/db.ts` (so the dummy accounts still work offline).
//
// To enable Supabase:
//   1. Create a project at https://supabase.com
//   2. Run the SQL in `supabase/schema.sql` in the SQL editor
//   3. Create a Storage bucket called `client-photos` (public read)
//   4. Set the env vars in `.env` (or your hosting platform):
//        VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//        VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

// Throws clearly during app boot if env vars are missing — the app no
// longer has any localStorage fallback.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Don't throw on import (would crash the whole app immediately).
  // getSupabase() throws when called.
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env vars are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env or hosting platform.",
  );
}

let _client: SupabaseClient | null = null;

export const SUPABASE_ENABLED =
  Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);

/**
 * Returns the singleton Supabase client. Throws if env vars are missing —
 * the app no longer falls back to any other storage layer.
 */
export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}
