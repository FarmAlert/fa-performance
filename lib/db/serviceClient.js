import "server-only";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Privileged Supabase client — service role key, server-only.
//
// SECURITY (CLAUDE.md Section 12 / SPEC.md Part B Section 5): the service
// role key bypasses Row Level Security entirely, so this file must never be
// imported by a Client Component. The "server-only" import above makes
// Next.js throw a build error if that ever happens, the same guard already
// used for lib/erpnext.js.
//
// Every function that uses this client is still responsible for its own
// explicit ownership filtering (e.g. `.eq("owner", ownerId)`) — bypassing
// RLS means the query layer itself is the only remaining enforcement, not a
// backstop on top of it. See lib/db/partners.js for that pattern.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedClient = null;

export function getServiceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are not configured (check .env)");
  }
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

// Postgres "undefined_column" (42703) — thrown when a query names a column
// that a migration hasn't actually been applied to this environment yet
// (e.g. migration 070's distribution_center/assigned_distribution_centers,
// live-reported 13 Aug 2026 as breaking the whole credit-application
// pipeline, not just its own admin display). Shared so callers can degrade
// gracefully — drop the not-yet-existing column/filter and retry — instead
// of failing the whole page or write outright while the migration is
// pending. Matched on the Postgrest error code first (reliable across
// Supabase client versions); the message regex is a fallback for the rare
// shape that doesn't surface `.code`.
export function isMissingColumnError(error) {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message || "");
}

// Pulls the bare column name out of a Postgrest 42703 message, e.g.
// `column credit_staff_users.role does not exist` or `column "role" does
// not exist` -> "role". Used by callers that fall back by dropping
// whichever specific column a not-yet-applied migration is missing (see
// listCreditStaffUsers), rather than assuming only one particular column
// can ever be absent.
export function extractMissingColumnName(error) {
  if (!error || !error.message) return null;
  const match = error.message.match(/column\s+(?:"?[\w]+"?\.)?"?(\w+)"?\s+does not exist/i);
  return match ? match[1] : null;
}

const DELETE_AUTH_USER_MAX_ATTEMPTS = 3;

// Bug fix (reported): deletePartnerAccount and deleteCustomerAccount
// (lib/db/partners.js, lib/db/customers.js) used to call
// supabase.auth.admin.deleteUser() once and just console.error on failure —
// a fire-and-forget external call, exactly what CLAUDE.md Section 10 says
// never to do. Any transient failure there left the Auth user (and its
// email/phone) permanently occupied with nothing surfaced to the admin, so
// re-registering with the same details kept failing "already exists" even
// though the seller/customer record itself was gone. Still non-throwing —
// by the time either caller reaches this, the row that actually blocks
// re-registration (partners/customers table) is already deleted, which is
// the part that mattered most — but now retries a few times first, so a
// transient failure doesn't leave the orphaned Auth user behind at all.
export async function deleteAuthUserWithRetry(supabase, ownerId, { context } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= DELETE_AUTH_USER_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.auth.admin.deleteUser(ownerId);
    if (!error) return;
    lastError = error;
    if (attempt < DELETE_AUTH_USER_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  console.error(
    "[db] failed to delete auth user " +
      ownerId +
      (context ? " (" + context + ")" : "") +
      " after " +
      DELETE_AUTH_USER_MAX_ATTEMPTS +
      " attempts: " +
      lastError.message
  );
}
