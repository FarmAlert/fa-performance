import "server-only";
import { getServiceClient } from "./serviceClient";
import { getAnonClient } from "./anonClient";

// ---------------------------------------------------------------------------
// Staff roster — the SAME perf_staff / perf_logs / perf_monthly_inputs
// tables the VetXpress Performance System (admin dashboards, WordPress
// widget, Staff Accounts) reads and writes. This app shares that data; it
// does not keep a second roster. Creating logins, resetting passwords and
// editing a person's role/outlet stay in VetXpress → Admin → Performance →
// Staff Accounts; this file only reads them, plus the sign-in checks.
//
// Service-role client: RLS is bypassed, so every query filters explicitly.
// ---------------------------------------------------------------------------

export class PerfStaffAuthError extends Error {}

const FAILED_LOGIN_WINDOW_MS = 30 * 60 * 1000;
const FAILED_LOGIN_MAX = 10;

// Same lockout table and rules as the widget: only wrong passwords count,
// 10 in 30 minutes locks the email, a successful sign-in clears it.
export async function isPerfWidgetLoginLocked(identifier) {
  const normalized = (identifier || "").trim().toLowerCase();
  if (!normalized) return false;
  try {
    const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MS).toISOString();
    const { count, error } = await getServiceClient()
      .from("perf_widget_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier", normalized)
      .gte("created_at", since);
    if (error) throw error;
    return (count || 0) >= FAILED_LOGIN_MAX;
  } catch (err) {
    console.error("[db] lockout check failed, allowing by default: " + err.message);
    return false;
  }
}

export async function recordFailedPerfWidgetLogin(identifier) {
  const normalized = (identifier || "").trim().toLowerCase();
  if (!normalized) return;
  const { error } = await getServiceClient().from("perf_widget_login_attempts").insert({ identifier: normalized });
  if (error) console.error("[db] couldn't record failed login: " + error.message);
}

export async function clearPerfWidgetLoginAttempts(identifier) {
  const normalized = (identifier || "").trim().toLowerCase();
  if (!normalized) return;
  const { error } = await getServiceClient().from("perf_widget_login_attempts").delete().eq("identifier", normalized);
  if (error) console.error("[db] couldn't clear login attempts: " + error.message);
}

function rowToStaff(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    outlet: row.outlet,
    name: row.name,
    role: row.role,
    cluster: row.cluster,
    region: row.region,
    regionScope: row.region_scope,
    functionScope: row.function_scope,
    accessLevel: row.access_level,
    targets: row.targets || {},
    email: row.email,
    isAdmin: row.is_admin,
    active: row.active,
    mustChangePassword: row.must_change_password,
    reportsTo: row.reports_to || null,
    erpEmployee: row.erp_employee || null,
    erpUser: row.erp_user || null,
    erpSalesPerson: row.erp_sales_person || null,
    fieldRole: row.field_role === undefined ? null : row.field_role,
    mutedTemplateIds: row.muted_template_ids || [],
    appPrivacyAckAt: row.app_privacy_ack_at || null,
  };
}

// Real credential check against Supabase Auth with the anon client; the
// session Supabase returns is never kept, only the verified user id.
export async function verifyStaffCredentials(email, password) {
  const { data, error } = await getAnonClient().auth.signInWithPassword({ email: String(email || "").trim(), password });
  if (error || !data?.user) throw new PerfStaffAuthError("Invalid email or password.");
  const staff = await getStaffByOwnerId(data.user.id);
  if (!staff) throw new PerfStaffAuthError("No staff account found for this login.");
  if (!staff.active) throw new PerfStaffAuthError("Your account is inactive.");
  return staff;
}

export async function getStaffByOwnerId(ownerId) {
  const { data, error } = await getServiceClient().from("perf_staff").select("*").eq("owner", ownerId).maybeSingle();
  if (error) throw error;
  return rowToStaff(data);
}

export async function getStaffById(id) {
  const { data, error } = await getServiceClient().from("perf_staff").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return rowToStaff(data);
}

export async function listAllStaff() {
  const { data, error } = await getServiceClient().from("perf_staff").select("*").order("outlet", { ascending: true }).order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToStaff);
}

function nextMonthStart(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? y + 1 + "-01-01" : y + "-" + String(m + 1).padStart(2, "0") + "-01";
}

// Daily logs from the WordPress widget, reshaped for lib/perf/scoring.js
// (same shape VetXpress's own dashboard feeds it), so "cluster" scores here
// match the Performance dashboard exactly.
export async function getLogsForMonth(staffIds, month) {
  if (!staffIds || staffIds.length === 0) return [];
  const { data, error } = await getServiceClient()
    .from("perf_logs")
    .select("*")
    .in("staff_id", staffIds)
    .gte("log_date", month + "-01")
    .lt("log_date", nextMonthStart(month))
    .order("log_date", { ascending: false });
  if (error) throw error;
  const staffById = new Map((await listAllStaff()).map((s) => [s.id, s]));
  return (data || []).map((row) => {
    const staff = staffById.get(row.staff_id);
    return {
      id: row.id,
      personId: row.staff_id,
      personName: staff ? staff.name : null,
      outlet: staff ? staff.outlet : null,
      cluster: staff ? staff.cluster : null,
      date: row.log_date,
      lat: row.lat,
      lng: row.lng,
      locAccuracy: row.loc_accuracy,
      ...(row.fields || {}),
    };
  });
}

export async function getMonthlyInputsForMonth(staffIds, month) {
  if (!staffIds || staffIds.length === 0) return {};
  const { data, error } = await getServiceClient().from("perf_monthly_inputs").select("*").in("staff_id", staffIds).eq("month", month);
  if (error) throw error;
  const out = {};
  (data || []).forEach((row) => {
    out[row.staff_id + "|" + row.month] = row.fields || {};
  });
  return out;
}
