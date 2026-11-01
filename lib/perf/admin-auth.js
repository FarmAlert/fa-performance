import "server-only";
import { authenticateAppRequest, isPerformanceAdmin, isViewer } from "@/lib/perf/app-auth";

// Admin access for /admin and /api/admin (build spec section 2):
//   Performance admin (VP Finance & Admin / HR, the CTO): view and change.
//   Viewer (CEO, VP AI & Digital Innovation, Chief Internal Auditor):
//   read-only, plus export.
// Same staff sign-in and session cookie as the phone app; no VetXpress
// admin account is involved. Decided on the server every request.
export async function requireAppAdmin(request, { write = false } = {}) {
  const auth = await authenticateAppRequest(request);
  if (auth.error) return { error: auth.error, status: auth.status };
  const staff = auth.staff;
  const canManage = isPerformanceAdmin(staff);
  const canView = canManage || isViewer(staff);
  if (!canView || (write && !canManage)) return { error: "You don't have access to Performance admin.", status: 403 };
  return { staff, canManage, canExport: canView, actor: staff.email || staff.name };
}
