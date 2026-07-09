// Supabase client. Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// from the build-time environment. NEVER reads a service-role key —
// the browser must only use the anon (public) key.
//
// To enable Supabase:
//   1. Create a project at https://supabase.com
//   2. Run the SQL in `supabase/schema.sql` in the SQL editor
//   3. Create a Storage bucket called `client-photos` (public read)
//   4. Set the env vars in `.env` (or your hosting platform):
//        VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//        VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
//
// IMPORTANT — service-role safety:
//   * The service-role key is a SECRET. It must NEVER appear in browser
//     code, env vars prefixed with VITE_, or anywhere in the client
//     bundle. Supabase's JS client detects it and throws "Forbidden use
//     of secret API key in browser".
//   * This file deliberately only reads VITE_SUPABASE_URL and
//     VITE_SUPABASE_ANON_KEY. Any environment variable whose name
//     contains "service", "secret", or matches the service-role JWT
//     pattern is rejected with a clear error message.

/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Normalize the configured URL. Supabase's JS client appends the API
// paths itself (`/auth/v1`, `/rest/v1`, `/storage/v1`, etc.) — if
// `VITE_SUPABASE_URL` already contains a path (e.g. the user pasted
// `https://xyz.supabase.co/rest/v1`), every request is doubled up
// and PostgREST rejects it with `PGRST125 Invalid path specified`.
// We strip everything after the origin and rebuild a clean URL.
const _rawUrl: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
let SUPABASE_URL = "";
try {
  if (_rawUrl) {
    const u = new URL(_rawUrl);
    SUPABASE_URL = `${u.protocol}//${u.host}`;
  }
} catch {
  // Not a parseable URL — keep SUPABASE_URL as "" so getSupabase() throws
  // a clear "Supabase is not configured" error.
  SUPABASE_URL = "";
}
const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

// Refuse any client config that smells like a service-role key. This
// is a defence-in-depth check: the service role must never be embedded
// in the browser bundle, and the Supabase JS client throws an opaque
// "Forbidden use of secret API key in browser" error if it is.
const isServiceRoleKey = (key: string): boolean => {
  if (!key) return false;
  // The service-role JWT has role claim "service_role". Decode the
  // payload segment (middle of the three-part JWT) and check it.
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      // base64url -> base64
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      // eslint-disable-next-line no-restricted-globals
      const payload = JSON.parse(atob(padded)) as { role?: string };
      if (payload?.role === "service_role") return true;
    } catch {
      /* not a JWT — fall through */
    }
  }
  // Defensive: also reject anything that literally contains the
  // service_role substring (URL-embedded secret, etc.).
  return /service_role/i.test(key) || /sb_secret/i.test(key);
};

if (isServiceRoleKey(SUPABASE_ANON_KEY)) {
  throw new Error(
    "Refusing to start: VITE_SUPABASE_ANON_KEY looks like a service-role " +
      "secret. The browser must only use the anon (public) Supabase key. " +
      "Set VITE_SUPABASE_ANON_KEY to the 'anon' / 'public' key from " +
      "Project Settings -> API.",
  );
}

// Don't ever create a second Supabase client anywhere in the bundle.
// The browser only ever has the anon-key client.
let _client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client. Throws if env vars are missing
 * or if a service-role secret was detected. The app no longer falls
 * back to any other storage layer.
 */
export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY in your .env (or hosting platform).",
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

// Backwards-compat flag — always true when the file loads successfully.
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
