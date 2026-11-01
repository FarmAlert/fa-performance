import { authenticateAppRequest } from "@/lib/perf/app-auth";
import { HANDLERS } from "@/lib/perf/app-api";

// Farm Alert Performance App API (build spec section 9):
// /api/app/<method>. Same-origin only — no CORS headers are ever sent,
// the session cookie is SameSite=Strict, and every POST must carry the
// x-perf-app header (a custom header a cross-site form can't add), so a
// third-party page can't drive these endpoints with the staff member's
// cookie. Auth and per-employee permission checks are server-side
// (lib/perf/app-auth.js, lib/db/perf-app-*.js).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 256 * 1024;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function handle(request, params, http) {
  const { method } = await params;
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, method) ? HANDLERS[method] : null;
  if (!handler) return json({ error: "Not found." }, 404);
  if (handler.http !== http) return json({ error: "Method not allowed." }, 405);

  let input = {};
  if (http === "POST") {
    if (request.headers.get("x-perf-app") !== "1") return json({ error: "Forbidden." }, 403);
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
      input = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Invalid request body." }, 400);
  } else {
    input = Object.fromEntries(new URL(request.url).searchParams.entries());
  }

  const auth = await authenticateAppRequest(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  try {
    const data = await handler.run(auth.staff, input);
    return json(data);
  } catch (err) {
    if (err.status && err.status < 500) return json({ error: err.message }, err.status);
    console.error("[api/app/" + method + "] failed: " + err.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

export async function GET(request, { params }) {
  return handle(request, params, "GET");
}

export async function POST(request, { params }) {
  return handle(request, params, "POST");
}
