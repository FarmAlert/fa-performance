import { requireAppAdmin } from "@/lib/perf/admin-auth";
import { getSetup, updateStaffLink, saveRule, saveTemplate, saveScorecard, setTargetOverride, setManualActual, listManualActuals } from "@/lib/db/perf-app-config";
import { exportRows, rebuildScores, lockMonth, correctScore, setVerified, listCorrections, listMonths } from "@/lib/db/perf-app-scores";
import { listAllIdeas } from "@/lib/db/perf-app-ideas";
import { runTick } from "@/lib/perf/app-jobs";
import { isValidMonth, lagosDate, monthOf } from "@/lib/perf/app-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// /admin API. GET: Performance admins and viewers; every change:
// Performance admins only (lib/perf/admin-auth.js). Every POST needs the
// x-perf-app header (CSRF). Input is validated in lib/db/perf-app-config.js
// and perf-app-scores.js before any write.

const JOBS = new Set(["build_day_plans", "evaluate_auto_tasks", "reminders", "rebuild_scores"]);

export async function GET(request) {
  const admin = await requireAppAdmin(request);
  if (admin.error) return Response.json({ error: admin.error }, { status: admin.status });
  const url = new URL(request.url);
  if (url.searchParams.get("probe") === "1") return Response.json({ ok: true, me: { name: admin.staff.name, role: admin.staff.role }, canManage: admin.canManage });
  const month = url.searchParams.get("month") || monthOf(lagosDate());
  if (!isValidMonth(month)) return Response.json({ error: "Invalid month." }, { status: 400 });
  try {
    const [setup, scores, months, ideas, corrections, manual] = await Promise.all([getSetup(), exportRows(month), listMonths(), listAllIdeas(), listCorrections(month), listManualActuals(month)]);
    return Response.json({ month, ...setup, scores, months, ideas, corrections, manual, canManage: admin.canManage, canExport: admin.canExport, me: { name: admin.staff.name, role: admin.staff.role } });
  } catch (err) {
    console.error("[api/admin] GET failed: " + err.message);
    return Response.json({ error: "Couldn't load the app setup." }, { status: 500 });
  }
}

export async function POST(request) {
  if (request.headers.get("x-perf-app") !== "1") return Response.json({ error: "Forbidden." }, { status: 403 });
  const admin = await requireAppAdmin(request, { write: true });
  if (admin.error) return Response.json({ error: admin.error }, { status: admin.status });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const actor = admin.actor;
  try {
    switch (body.action) {
      case "update_staff_link":
        return Response.json(await updateStaffLink(body));
      case "save_rule":
        return Response.json(await saveRule(body.rule || {}));
      case "save_template":
        return Response.json(await saveTemplate(body.template || {}));
      case "save_scorecard":
        return Response.json(await saveScorecard(body.scorecard || {}));
      case "set_target_override":
        return Response.json(await setTargetOverride(body));
      case "set_manual_actual":
        return Response.json(await setManualActual({ ...body, actor }));
      case "rebuild_scores":
        if (!isValidMonth(body.month)) return Response.json({ error: "Invalid month." }, { status: 400 });
        return Response.json(await rebuildScores(body.month));
      case "lock_month":
        if (!isValidMonth(body.month)) return Response.json({ error: "Invalid month." }, { status: 400 });
        if (body.month >= monthOf(lagosDate())) return Response.json({ error: "Only a finished month can be locked." }, { status: 400 });
        return Response.json(await lockMonth(body.month, actor));
      case "correct_score":
        return Response.json(await correctScore({ staffId: body.staffId, month: body.month, newScore: body.newScore, reason: body.reason, actor }));
      case "set_verified":
        return Response.json(await setVerified({ staffId: body.staffId, month: body.month, verified: body.verified, actor }));
      case "run_job":
        if (!JOBS.has(body.job)) return Response.json({ error: "Unknown job." }, { status: 400 });
        return Response.json(await runTick(new Date(), { force: body.job }));
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    if (err.status && err.status < 500) return Response.json({ error: err.message }, { status: err.status });
    console.error("[api/admin] " + body.action + " failed: " + err.message);
    return Response.json({ error: "Couldn't save. Please try again." }, { status: 500 });
  }
}
