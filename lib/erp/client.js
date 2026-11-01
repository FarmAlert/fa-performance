import "server-only";

// ---------------------------------------------------------------------------
// Read-only ERPNext REST client for the Farm Alert Performance App. Taken
// from VetXpress's lib/erp/client.js with every write path removed: there
// is no create or update function here at all, and only the read API key
// is used (ERPNEXT_API_KEY / ERPNEXT_API_SECRET). VetXpress CLAUDE.md
// Addendum D/F: nothing ever writes to ERPNext from this integration.
//
// 10 s timeout and 2 retries on GET (VetXpress CLAUDE.md Section 10);
// 4xx other than 429 is not retried.
// ---------------------------------------------------------------------------

const ERPNEXT_URL = process.env.ERPNEXT_URL;
const READ_KEY = process.env.ERPNEXT_API_KEY;
const READ_SECRET = process.env.ERPNEXT_API_SECRET;


const REQUEST_TIMEOUT_MS = 10000; // Section 10: sensible timeouts on external calls
const MAX_RETRIES = 2; // Section 10: retry logic on external calls, GET only, never retry a write blind

// Readable "which sync/action" label for erpHealth alerts — the resource
// path without the ERPNext base URL or query string (credentials/filters
// never belong in an alert email).
function endpointLabel(endpoint) {
  try {
    return new URL(endpoint).pathname.replace(/^\/api\/resource\//, "");
  } catch {
    return endpoint;
  }
}

function authHeader() {
  const key = READ_KEY;
  const secret = READ_SECRET;
  if (!ERPNEXT_URL || !key || !secret) {
    throw new Error("ERPNext credentials are not configured (check .env)");
  }
  return "token " + key + ":" + secret;
}

async function erpFetch(endpoint, { method = "GET", body, mode = "read", cacheSeconds } = {}) {
  const maxAttempts = method === "GET" ? MAX_RETRIES + 1 : 1; // never blind-retry a write
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: authHeader(mode),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        // Writes and per-partner reads must never be cached by Next's Data
        // Cache — this is live warehouse/order state, not the storefront's
        // cacheable catalogue reads. `cacheSeconds` is an explicit opt-in
        // (SPEC.md Part P.1) for the one caller that genuinely needs a short
        // TTL instead of live-every-time (the public storefront's warehouse
        // authorization check) — every existing caller omits it and keeps
        // this exact no-store behaviour, unchanged.
        ...(cacheSeconds != null ? { next: { revalidate: cacheSeconds } } : { cache: "no-store" }),
      });

      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      if (!response.ok) {
        const err = new Error(
          "ERPNext " + method + " " + endpoint + " returned HTTP " + response.status + ": " +
            (json?.exception || json?._server_messages || text).toString().slice(0, 500)
        );
        err.status = response.status;
        throw err;
      }

      // SPEC.md Part CC — every successful call reports in, so a prior
      // failure/outage is detected as recovered the moment ERPNext starts
      // responding again (see lib/db/erpHealth.js; cheap no-op in the
      // common already-healthy case).
      
      return json;
    } catch (err) {
      lastError = err;
      console.error("[erp] " + method + " " + endpoint + " failed (attempt " + attempt + "/" + maxAttempts + "): " + err.message);
      if (err.status && err.status < 500 && err.status !== 429) break; // client error, retrying won't help
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.error("[erp] " + method + " " + endpointLabel(endpoint) + " gave up after retries: " + (lastError && lastError.message));
  throw lastError;
}

function buildUrl(resource, params) {
  const base = ERPNEXT_URL.replace(/\/$/, "") + "/api/resource/" + encodeURIComponent(resource);
  if (!params) return base;
  const query = new URLSearchParams(params).toString();
  return query ? base + "?" + query : base;
}

// Lists documents of a doctype/resource — read-scoped by default.
export async function erpList(resource, { filters, fields, limit = 100, orderBy, mode = "read", cacheSeconds } = {}) {
  const params = { limit_page_length: String(limit) };
  if (filters) params.filters = JSON.stringify(filters);
  if (fields) params.fields = JSON.stringify(fields);
  if (orderBy) params.order_by = orderBy;
  const body = await erpFetch(buildUrl(resource, params), { mode, cacheSeconds });
  return body.data || [];
}

// Real pagination via `limit_start` — for callers that genuinely need
// EVERY matching document (e.g. the bulk customer-import screen), not a
// single capped page like erpList's plain `limit`. Loops pageSize-sized
// requests, appending results, until a page comes back shorter than
// pageSize (the standard "that was the last page" signal for this API) —
// maxPages is a hard safety cap so a runaway loop can never hang forever
// against a doctype with an unexpectedly huge or ever-growing row count.
// `cacheSeconds` is omitted by default (every page fetched live, no-store)
// — an explicit opt-in for a caller like the bulk import screen, which
// re-runs this exact fetch a second time moments later at submit time
// (lib/db/partner-import.js's "never trust the client" re-derivation) and
// doesn't need a second live round trip through ERPNext for that.
export async function erpListAll(resource, { filters, fields, orderBy, mode = "read", pageSize = 100, maxPages = 50, cacheSeconds } = {}) {
  const results = [];
  for (let page = 0; page < maxPages; page++) {
    const params = { limit_page_length: String(pageSize), limit_start: String(page * pageSize) };
    if (filters) params.filters = JSON.stringify(filters);
    if (fields) params.fields = JSON.stringify(fields);
    if (orderBy) params.order_by = orderBy;
    const body = await erpFetch(buildUrl(resource, params), { mode, cacheSeconds });
    const rows = body.data || [];
    results.push(...rows);
    if (rows.length < pageSize) break;
    if (page === maxPages - 1) {
      console.error(
        "[erp] erpListAll(" + resource + ") hit its " + maxPages + "-page safety cap (" +
          results.length + " rows fetched), there may be more real records beyond this; raise maxPages if so."
      );
    }
  }
  return results;
}

// Fetches a single named document. Returns null on 404 rather than throwing.
// `cacheSeconds` is omitted by default (live, no-store) — every existing
// caller (a write-time lookup, where a stale answer could mean the wrong
// pack size gets saved) keeps that unchanged; it's an explicit opt-in for a
// caller reading this repeatedly on every storefront page render instead
// (lib/erpnext.js's display-time piece-price fallback), same "explicit
// opt-in for a cacheable read path" convention erpList/erpListAll already
// use above.
export async function erpGet(resource, name, { mode = "read", cacheSeconds } = {}) {
  try {
    const body = await erpFetch(buildUrl(resource, null) + "/" + encodeURIComponent(name), { mode, cacheSeconds });
    return body.data || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function isErpConfigured() {
  return !!(ERPNEXT_URL && READ_KEY && READ_SECRET);
}
