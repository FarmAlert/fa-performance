import "server-only";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Unprivileged Supabase client — anon key, server-only, no session
// persistence. Distinct from serviceClient.js (service role, bypasses RLS):
// this one exists purely so a server route can verify a password the same
// way Supabase Auth itself does (auth.signInWithPassword), for a caller that
// has no browser/cookie session to act as (a public, cross-origin widget
// request from farmalert.com.ng, not a logged-in portal tab).
// persistSession/autoRefreshToken are both off — there is nowhere to persist
// to on the server, and the returned tokens are discarded by the caller
// immediately after reading the verified user id off the response.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cachedClient = null;

export function getAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase anon credentials are not configured (check .env)");
  }
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}
