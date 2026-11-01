import "server-only";
import { getServiceClient } from "@/lib/db/serviceClient";
import { getStaffById } from "@/lib/db/perf-staff";
import { updateTaskStatus, PerfTaskNotFoundError } from "@/lib/db/perf-tasks";
import { getMyDay, getTaskDetail, markTask, setTaskMuted } from "@/lib/db/perf-app-tasks";
import { partnersForVisit, visitContext, logVisit, approveFarVisit } from "@/lib/db/perf-app-visits";
import { getDailyReport, saveReportDraft, sendDailyReport } from "@/lib/db/perf-app-reports";
import { getMyRating, scoresFor } from "@/lib/db/perf-app-scores";
import { teamToday, personDay, nudge, ratingsDue, rateContext, rate } from "@/lib/db/perf-app-team";
import { submitIdea, myIdeas, ideasToDecide, decideIdea, scoreGrowthIdea, setIdeaOfMonth } from "@/lib/db/perf-app-ideas";
import { registerPushSubscription, pushPublicKey, listNotifications, markNotificationsRead } from "@/lib/db/perf-app-notify";
import { createMediaUpload } from "@/lib/db/perf-app-media";
import { isSupervisor, isViewer, isGrowthReviewer, isPerformanceAdmin } from "@/lib/perf/app-auth";
import { lagosDate, monthOf, isValidDate, isValidMonth, isFieldRole, monthPhase, centreLabel, BAND_LABELS, NOT_DONE_REASONS, VISIT_OUTCOMES } from "@/lib/perf/app-core";
import { outletLabel } from "@/lib/perf/scoring";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — the phone API (spec 9), one handler per
// method, served by app/api/app/[method]/route.js as
// /api/app/<method>. Every handler receives the server-authenticated
// staff record (lib/perf/app-auth.js), never an id from the client, and
// each lib/db/perf-app-*.js function re-checks that the caller may see or
// change the employee involved.
//
// `sync` replays the phone's offline queue through these same handlers, so
// there is exactly one code path per action whether it was sent live or
// hours later. Queued actions carry a client_id: visits and ideas are
// unique on it in their own tables; the rest are recorded in
// perf_app_sync_receipts so a retry returns the first result instead of
// acting twice.
// ---------------------------------------------------------------------------

export class AppInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppInputError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateParam(v) {
  if (!v) return lagosDate();
  if (!isValidDate(v)) throw new AppInputError("Invalid date.");
  return v;
}

function monthParam(v) {
  if (!v) return monthOf(lagosDate());
  if (!isValidMonth(v)) throw new AppInputError("Invalid month.");
  return v;
}

async function me(staff) {
  const month = monthOf(lagosDate());
  const [supervisor, scores, manager, unread] = await Promise.all([
    isSupervisor(staff),
    scoresFor([staff.id], month),
    staff.reportsTo ? getStaffById(staff.reportsTo) : null,
    getServiceClient().from("perf_notifications").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).is("read_at", null),
  ]);
  const sc = scores.get(staff.id);
  return {
    employee: staff.id,
    name: staff.name,
    firstName: String(staff.name || "").split(" ")[0],
    role: staff.role,
    cluster: staff.cluster,
    centre: centreLabel(outletLabel(staff.outlet)),
    reportsTo: manager ? { id: manager.id, name: manager.name } : null,
    isSupervisor: supervisor,
    isViewer: isViewer(staff) || isPerformanceAdmin(staff),
    isGrowthReviewer: isGrowthReviewer(staff),
    isFieldRole: isFieldRole(staff),
    erpLinked: !!(staff.erpUser || staff.erpSalesPerson),
    score: sc?.score ?? null,
    band: sc?.band || "no_data",
    bandLabel: BAND_LABELS[sc?.band || "no_data"],
    privacyAcked: !!staff.appPrivacyAckAt,
    mutedTemplateIds: staff.mutedTemplateIds || [],
    pushKey: pushPublicKey(),
    unread: unread.count || 0,
    today: lagosDate(),
    month,
    monthPhase: monthPhase(month),
    reasons: NOT_DONE_REASONS,
    outcomes: VISIT_OUTCOMES,
  };
}

async function privacyAck(staff) {
  const { error } = await getServiceClient().from("perf_staff").update({ app_privacy_ack_at: new Date().toISOString() }).eq("id", staff.id);
  if (error) throw error;
  return { ok: true };
}

// Tasks HQ assigned on the existing Tasks board (migration 110): the same
// staff-side status change the widget makes, so both stay in step.
async function hqTaskStatus(staff, { task, status }) {
  if (!UUID.test(String(task || ""))) throw new AppInputError("Task not found.", 404);
  try {
    const t = await updateTaskStatus(task, staff.id, status);
    return { ok: true, task: { id: t.id, status: t.status } };
  } catch (err) {
    if (err instanceof PerfTaskNotFoundError) throw new AppInputError("Task not found.", 404);
    if (/Invalid status|no longer be updated/.test(err.message)) throw new AppInputError(err.message);
    throw err;
  }
}

const QUEUEABLE = new Set(["mark_task", "log_visit", "save_report_draft", "send_daily_report", "submit_idea", "rate"]);

async function sync(staff, body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const sb = getServiceClient();
  const results = [];
  for (const item of items) {
    const clientId = String(item?.client_id || "");
    const type = String(item?.type || "");
    if (!UUID.test(clientId) || !QUEUEABLE.has(type)) {
      results.push({ client_id: clientId, ok: false, status: 400, error: "Unknown queued action." });
      continue;
    }
    const usesReceipt = type !== "log_visit" && type !== "submit_idea";
    if (usesReceipt) {
      const { data: prior } = await sb.from("perf_app_sync_receipts").select("staff_id, result").eq("client_id", clientId).maybeSingle();
      if (prior) {
        results.push(prior.staff_id === staff.id ? { client_id: clientId, ...prior.result, duplicate: true } : { client_id: clientId, ok: false, status: 409, error: "Already used." });
        continue;
      }
    }
    const payload = { ...(item.payload || {}), client_id: clientId };
    if (type === "send_daily_report" && item.created_at) payload.confirmedAt = item.created_at;
    let result;
    try {
      const data = await HANDLERS[type].run(staff, payload);
      result = { ok: true, status: 200, data };
    } catch (err) {
      result = { ok: false, status: err.status || 500, error: err.status ? err.message : "Couldn't save this. It will be retried." };
      if (!err.status) console.error("[perf-app sync] " + type + " failed: " + err.message);
    }
    // Only final outcomes are remembered; a server error stays retryable.
    if (usesReceipt && result.status < 500) {
      await sb.from("perf_app_sync_receipts").insert({ client_id: clientId, staff_id: staff.id, action: type, result });
    }
    results.push({ client_id: clientId, ...result });
  }
  return { results };
}

// method -> { http, run(staff, params) }. GET params come from the query
// string, POST params from the JSON body.
export const HANDLERS = {
  me: { http: "GET", run: (s) => me(s) },
  my_day: { http: "GET", run: (s, p) => getMyDay(s, dateParam(p.date), { refresh: p.refresh === "1" }) },
  task_detail: { http: "GET", run: (s, p) => getTaskDetail(s, p.name || p.id) },
  mark_task: { http: "POST", run: (s, p) => markTask(s, p) },
  hq_task_status: { http: "POST", run: (s, p) => hqTaskStatus(s, p) },
  mute_task: { http: "POST", run: (s, p) => setTaskMuted(s, { templateId: p.template, muted: !!p.muted }) },
  customers_for_visit: { http: "GET", run: (s, p) => partnersForVisit(s, p.q) },
  visit_context: { http: "GET", run: (s, p) => visitContext(s, { customer: p.customer, date: p.date ? dateParam(p.date) : null }) },
  log_visit: { http: "POST", run: (s, p) => logVisit(s, p) },
  approve_visit: { http: "POST", run: (s, p) => approveFarVisit(s, p.visit) },
  // anonKey is the public Supabase key Storage's signed-upload endpoint
  // expects alongside the one-path signed URL (same as the widget's
  // upload-url route); it grants nothing on its own (RLS, private bucket).
  upload_url: { http: "POST", run: async (s, p) => ({ ...(await createMediaUpload(s.id, { purpose: p.purpose, contentType: p.contentType, size: p.size })), anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" }) },
  daily_report: { http: "GET", run: (s, p) => getDailyReport(s, dateParam(p.date)) },
  save_report_draft: { http: "POST", run: (s, p) => saveReportDraft(s, { date: dateParam(p.date), notes: p.notes, reasons: p.reasons }) },
  send_daily_report: { http: "POST", run: (s, p) => sendDailyReport(s, { date: dateParam(p.date), notes: p.notes, reasons: p.reasons, confirmedAt: p.confirmedAt }) },
  my_rating: { http: "GET", run: (s, p) => getMyRating(s, monthParam(p.month)) },
  submit_idea: { http: "POST", run: (s, p) => submitIdea(s, p) },
  my_ideas: { http: "GET", run: (s) => myIdeas(s) },
  team_today: { http: "GET", run: (s, p) => teamToday(s, { filter: p.filter, date: p.date ? dateParam(p.date) : null }) },
  person_day: { http: "GET", run: (s, p) => personDay(s, p.employee, p.date ? dateParam(p.date) : null) },
  nudge: { http: "POST", run: (s, p) => nudge(s, p) },
  ratings_due: { http: "GET", run: (s) => ratingsDue(s) },
  rate_context: { http: "GET", run: (s, p) => rateContext(s, { employee: p.employee, month: p.month ? monthParam(p.month) : null }) },
  rate: { http: "POST", run: (s, p) => rate(s, { ...p, month: monthParam(p.month) }) },
  ideas_to_decide: { http: "GET", run: (s) => ideasToDecide(s) },
  decide_idea: { http: "POST", run: (s, p) => decideIdea(s, p) },
  score_idea: { http: "POST", run: (s, p) => scoreGrowthIdea(s, p) },
  idea_of_month: { http: "POST", run: (s, p) => setIdeaOfMonth(s, p) },
  register_device: { http: "POST", run: (s, p) => registerPushSubscription(s.id, { endpoint: p.endpoint, keys: p.keys, platform: p.platform }) },
  notifications: { http: "GET", run: (s) => listNotifications(s.id) },
  mark_notifications_read: { http: "POST", run: (s) => markNotificationsRead(s.id) },
  privacy_ack: { http: "POST", run: (s) => privacyAck(s) },
  sync: { http: "POST", run: (s, p) => sync(s, p) },
};
