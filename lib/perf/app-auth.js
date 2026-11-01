import "server-only";
import { getServiceClient } from "@/lib/db/serviceClient";
import { getStaffById } from "@/lib/db/perf-staff";
import { issueWidgetToken, verifyWidgetToken } from "@/lib/perf/session-token";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — session + "who may see what" (spec 2, 3.2,
// 10.2, 10.4).
//
// Sign-in reuses the Performance System's own staff logins (Supabase Auth,
// verified once at /api/app/login, same lockout as the widget). The
// session is a signed token (lib/perf/widget-token.js, audience "app") in
// an httpOnly, Secure, SameSite=Strict cookie — never readable by page
// JavaScript, which is the browser equivalent of the spec's "token in the
// phone's secure storage". 30 days per spec 8.3/01; every call still
// re-reads perf_staff, so deactivating someone in Staff Accounts blocks
// the app at their next call.
//
// The server decides every permission here; the UI only hides what it
// knows the server will refuse anyway.
// ---------------------------------------------------------------------------

export const APP_SESSION_COOKIE = "perf_app_session";
export const APP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUD = "perf-app";

export function issueAppSession(staffId) {
  return issueWidgetToken(staffId, { ttlMs: APP_SESSION_TTL_MS, aud: AUD });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(APP_SESSION_TTL_MS / 1000),
  };
}

function readCookie(request, name) {
  const fromApi = request.cookies?.get?.(name)?.value;
  if (fromApi) return fromApi;
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Best-effort per-user rate limit (spec 10.2). Per server instance only —
// a real limit belongs at the edge (Cloudflare, CLAUDE.md Section 10); this
// just stops one runaway client hammering ERPNext through us.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;
const hits = new Map();
function rateLimited(staffId) {
  const now = Date.now();
  const entry = hits.get(staffId);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(staffId, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

// Returns { staff } or { error, status }.
export async function authenticateAppRequest(request) {
  const token = readCookie(request, APP_SESSION_COOKIE);
  const staffId = verifyWidgetToken(token, { aud: AUD });
  if (!staffId) return { error: "Please sign in again.", status: 401 };
  if (rateLimited(staffId)) return { error: "Too many requests. Wait a minute and try again.", status: 429 };
  const staff = await getStaffById(staffId);
  if (!staff) return { error: "Please sign in again.", status: 401 };
  if (!staff.active) return { error: "Your account is disabled. Ask HR.", status: 401 };
  return { staff };
}

// ---------------------------------------------------------------------------
// Roles (spec 2). Supervisor = has direct reports (perf_staff.reports_to).
// ---------------------------------------------------------------------------

export function isViewer(staff) {
  if (!staff) return false;
  if (staff.isAdmin || staff.accessLevel === "ceo" || staff.accessLevel === "admin") return true;
  return /chief internal auditor|ai\s*&\s*digital innovation/i.test(staff.role || "");
}

// Performance admin: VP Finance & Admin (HR) and the CTO.
export function isPerformanceAdmin(staff) {
  if (!staff) return false;
  if (staff.isAdmin || staff.accessLevel === "admin") return true;
  return /chief technology officer/i.test(staff.role || "");
}

// VP Sales & Marketing scores growth ideas at Gate 1.
export function isGrowthReviewer(staff) {
  if (!staff) return false;
  if (staff.accessLevel === "vp" && staff.functionScope === "Sales & Marketing") return true;
  return /vp,?\s*sales\s*&\s*marketing/i.test(staff.role || "");
}

export async function listDirectReports(staffId) {
  const { data, error } = await getServiceClient()
    .from("perf_staff")
    .select("id")
    .eq("reports_to", staffId)
    .eq("active", true);
  if (error) throw error;
  const ids = (data || []).map((r) => r.id);
  const people = await Promise.all(ids.map((id) => getStaffById(id)));
  return people.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export async function isSupervisor(staff) {
  const { count, error } = await getServiceClient()
    .from("perf_staff")
    .select("id", { count: "exact", head: true })
    .eq("reports_to", staff.id)
    .eq("active", true);
  if (error) throw error;
  return (count || 0) > 0;
}

export class AppForbiddenError extends Error {
  constructor(message = "You can't see this person's records.") {
    super(message);
    this.name = "AppForbiddenError";
    this.status = 403;
  }
}

// Self, a direct report, or a viewer role (spec 9: "Every method checks
// that the caller may see the requested employee").
export async function assertCanSee(me, targetId) {
  if (!targetId || targetId === me.id) return me;
  const target = await getStaffById(targetId);
  if (!target) throw new AppForbiddenError();
  if (target.reportsTo === me.id || isViewer(me) || isPerformanceAdmin(me)) return target;
  throw new AppForbiddenError();
}

// Only the line manager (or HR) may rate (spec 4, acceptance check 11.1).
export async function assertCanRate(me, targetId) {
  const target = await getStaffById(targetId);
  if (!target || !target.active) throw new AppForbiddenError("This person can't be rated.");
  if (target.id === me.id) throw new AppForbiddenError("You can't rate yourself.");
  if (target.reportsTo === me.id || isPerformanceAdmin(me)) return target;
  throw new AppForbiddenError("Only their line manager can rate this person.");
}
